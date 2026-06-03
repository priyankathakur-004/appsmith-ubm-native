export default {
	// Per-table reporting spec. customerCol/dateCol drive the WHERE clause that
	// runReport builds. Add a new table here to expose it in the dropdown.
	tables: {
		reports_customer_monthly_usage: {
			label: "Customer Monthly Usage",
			customerCol: "customer_id",
			dateCol: "start_date"
		},
		reports_customer_bill_chains: {
			label: "Customer Bill Chains",
			customerCol: "customer_id",
			dateCol: "statement_date"
		},
		reports_customer_vendors_spend: {
			label: "Customer Vendor Spend",
			customerCol: "customer_id",
			dateCol: "statement_date"
		},
		reports_customer_accounts_view: {
			label: "Customer Accounts",
			customerCol: "customer_id",
			dateCol: null
		},
		reports_vendors: {
			label: "Vendors",
			customerCol: "customer_id",
			dateCol: null
		},
		analytics_monthly_feed: {
			label: "Analytics Monthly Feed",
			customerCol: "customer_id",
			dateCol: "start_date"
		},
		user_bills: {
			label: "User Bills",
			customerCol: "customer_id",
			dateCol: "created_at"
		},
		bill_errors: {
			label: "Bill Errors",
			customerCol: null,
			dateCol: "created_at"
		}
	},

	// UBMUtils.activeCustomer() returns a code ("ppg" / "simon"); map to the
	// integer customer_id used in the reporting DB. PPG is TBD per project memo.
	customerIds: {
		ppg: null,
		simon: 94512
	},

	options: () => {
		return Object.entries(ReportSpecs.tables).map(([value, v]) => ({
			label: v.label,
			value
		}));
	},

	selectedTable: () => {
		const v = EndpointSelect.selectedOptionValues;
		const picked = Array.isArray(v) && v.length > 0 ? v[0] : null;
		return picked || Object.keys(ReportSpecs.tables)[0];
	},

	selectedSpec: () => ReportSpecs.tables[ReportSpecs.selectedTable()] || {},

	customerId: () => {
		const code = UBMUtils.activeCustomer();
		const id = ReportSpecs.customerIds[code];
		return id == null ? null : id;
	},

	// Returns the full WHERE clause (including "WHERE 1=1") so the query body
	// stays a clean one-liner. All filters are pushed to SQL so pagination /
	// limits operate on the filtered set, not a JS post-filter.
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
	}
};
