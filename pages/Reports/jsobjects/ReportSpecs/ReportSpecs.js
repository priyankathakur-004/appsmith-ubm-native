export default {
	// One entry per dropdown option. Each spec is { label, from, select,
	// customerCol, dateCol }. from + select are spliced into runReport's
	// templated body, so SELECT and FROM stay co-located with their column
	// mapping. customerCol/dateCol drive the WHERE clause built by clauses()
	// — keeping all filters SQL-side per [[feedback-sql-side-filters]].
	reports: {
		accounts: {
			label: "Accounts",
			from: "bill_management_v2.reports_customer_accounts_view",
			select: "*",
			customerCol: "customer_id",
			dateCol: null
		},
		vendors: {
			label: "Vendors",
			from: "bill_management_v2.reports_vendors",
			select: "*",
			customerCol: "customer_id",
			dateCol: null
		},
		bills: {
			// Mirrors the join graph from pages/Bills/queries/getBills/getBills.txt,
			// aliased to the API's camelCase shape. DISTINCT ON collapses the join fan-out;
			// orderBy is required to make the picked row deterministic.
			label: "Bills",
			from: `bill_management_v2.bill_metas bm
				LEFT JOIN bill_management_v2.bill_metas_bill_records bmbr
					ON bmbr.bill_meta_id = bm.id AND bmbr.status = 'active'
				LEFT JOIN bill_management_v2.bill_records br ON br.id = bmbr.bill_record_id
				LEFT JOIN bill_management_v2.bill_items bi ON bi.bill_record_id = br.id
				LEFT JOIN bill_management_v2.customers_providers_pretty_name cvn
					ON cvn.code = br.vendor_code AND cvn.customer_id = br.customer_id
				LEFT JOIN bill_management_v2.analytics_bills_items abi ON br.id = abi.bill_record_id
				LEFT JOIN bill_management_v2.bills_total_amount_charges_prior btac
					ON abi.bill_id = btac.bill_id`,
			select: `DISTINCT ON (abi.bill_id, br.client_account)
				abi.bill_id AS "billId",
				COALESCE(cvn.pretty_name, br.vendor_code) AS "vendor",
				br.vendor_code AS "vendorCode",
				br.client_account AS "billingId",
				TO_CHAR(br.statement_date, 'YYYY-MM-DD') AS "invoiceDate",
				TO_CHAR(bi.start_date, 'YYYY-MM-DD') AS "serviceStartDate",
				TO_CHAR(bi.end_date, 'YYYY-MM-DD') AS "serviceEndDate",
				bi.commodity AS "virtacctUtilityType",
				btac.total_charges AS "currentCharges",
				btac.total_amount AS "totalPayAmount",
				bm.marked_for_payment AS "markedForPayment",
				TO_CHAR(br.created_at, 'YYYY-MM-DD') AS "createdAt"`,
			customerCol: "br.customer_id",
			dateCol: "br.statement_date",
			orderBy: "abi.bill_id DESC, br.client_account"
		},
		monthlyFeed: {
			label: "Monthly Feed",
			from: "bill_management_v2.analytics_monthly_feed",
			select: "*",
			customerCol: "customer_id",
			dateCol: "start_date"
		},
		billErrors: {
			// bill_errors has no customer_id directly — scope via bill_records.
			label: "Bill Errors",
			from: `bill_management_v2.bill_errors be
				LEFT JOIN bill_management_v2.bill_records br ON br.id = be.bill_record_id`,
			select: `be.id AS "billErrorId",
				TO_CHAR(be.created_at, 'YYYY-MM-DD') AS "importDate",
				br.id AS "pearId",
				br.client_account AS "billingId",
				TO_CHAR(br.statement_date, 'YYYY-MM-DD') AS "invoiceDate"`,
			customerCol: "br.customer_id",
			dateCol: "be.created_at"
		}
	},

	options: () => {
		return Object.entries(ReportSpecs.reports).map(([value, v]) => ({
			label: v.label,
			value
		}));
	},

	selectedTable: () => {
		const v = EndpointSelect.selectedOptionValues;
		const picked = Array.isArray(v) && v.length > 0 ? v[0] : null;
		return picked || Object.keys(ReportSpecs.reports)[0];
	},

	selectedSpec: () => {
		return ReportSpecs.reports[ReportSpecs.selectedTable()]
			|| ReportSpecs.reports[Object.keys(ReportSpecs.reports)[0]];
	},

	customerId: () => {
		const v = CustomerSelect && CustomerSelect.selectedOptionValue;
		if (v == null || v === "") return null;
		const n = parseInt(v, 10);
		return isNaN(n) ? null : n;
	},

	hasDateFilter: () => !!ReportSpecs.selectedSpec().dateCol,

	// Returns the full WHERE clause ("WHERE 1=1 AND ...") so runReport stays
	// a clean one-liner. All filters land here so pagination operates on the
	// filtered set, not a JS post-filter.
	clauses: () => {
		const spec = ReportSpecs.selectedSpec();
		const parts = ["WHERE 1=1"];
		const cid = ReportSpecs.customerId();
		if (spec.customerCol && cid != null) {
			parts.push(`AND ${spec.customerCol} = ${cid}`);
		}
		if (spec.dateCol && StartDate.selectedDate) {
			const d = moment(StartDate.selectedDate).format("YYYY-MM-DD");
			parts.push(`AND ${spec.dateCol} >= '${d}'`);
		}
		if (spec.dateCol && EndDate.selectedDate) {
			const d = moment(EndDate.selectedDate).format("YYYY-MM-DD");
			parts.push(`AND ${spec.dateCol} <= '${d}'`);
		}
		return parts.join(" ");
	},

	columnOptions: () => {
		const rows = runReport.data;
		if (!Array.isArray(rows) || rows.length === 0) return [];
		return Object.keys(rows[0]).map(k => ({ label: k, value: k }));
	},

	status: () => {
		if (runReport.isLoading) return "Running...";
		const rows = runReport.data;
		if (!Array.isArray(rows)) return "Pick a report and click Run";
		const t = ReportSpecs.selectedSpec().label || "report";
		return `${rows.length} rows · ${t}`;
	},

	filenameStem: () => {
		const customer = (CustomerSelect && CustomerSelect.selectedOptionLabel || "customer")
			.toString().replace(/\s+/g, "_");
		const report = ReportSpecs.selectedTable();
		const stamp = moment().format("YYYYMMDD-HHmmss");
		return `${customer}-${report}-${stamp}`;
	},

	exportCsv: () => {
		const rows = runReport.data || [];
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		const fields = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues
			: Object.keys(rows[0]);
		const escape = v => {
			if (v === null || v === undefined) return "";
			if (typeof v === "object") v = JSON.stringify(v);
			const s = String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const csv = [fields.join(","), ...rows.map(r => fields.map(f => escape(r[f])).join(","))].join("\n");
		const filename = `${ReportSpecs.filenameStem()}.csv`;
		download(csv, filename, "text/csv");
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	exportXlsx: () => {
		const rows = runReport.data || [];
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		const fields = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues
			: Object.keys(rows[0]);
		const flat = rows.map(r => {
			const o = {};
			for (const f of fields) {
				const v = r[f];
				o[f] = (v && typeof v === "object") ? JSON.stringify(v) : v;
			}
			return o;
		});
		const ws = XLSX.utils.json_to_sheet(flat, { header: fields });
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "Report");
		const filename = `${ReportSpecs.filenameStem()}.xlsx`;
		const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
		download({ data: b64, name: filename, type: "xlsx" }, filename);
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	reset: () => {
		if (typeof FieldsSelect !== "undefined" && FieldsSelect.clearValue) FieldsSelect.clearValue();
		if (typeof StartDate !== "undefined" && StartDate.reset) StartDate.reset();
		if (typeof EndDate !== "undefined" && EndDate.reset) EndDate.reset();
		resetWidget("LimitInput", false);
		resetWidget("OffsetInput", false);
		resetWidget("EndpointSelect", false);
		runReport.run();
		showAlert("Filters reset", "success");
	}
};
