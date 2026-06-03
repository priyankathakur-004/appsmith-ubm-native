export default {
	// ----- Static config -----
	// Known customers and their display labels. To add a new customer, also add
	// a login query (loginXxx) with their credentials and extend loginFor() below.
	customerOptions: [
		{ label: "PPG Industries", value: "ppg" },
		{ label: "Simon Property Group", value: "simon" }
	],

	endpoints: {
		accounts: {
			label: "Accounts",
			query: "getAccounts",
			fields: [
				"id", "billingId", "serviceAccountId", "meterId", "utilityType",
				"billType", "status", "vendor", "vendorId",
				"location", "locationAddress", "locationZip",
				"serviceAddress", "serviceZip",
				"virtualAccountId", "virtualAccountGroup",
				"dateOfLastBill", "vendorContact", "meterCombo", "importDate"
			],
			requiresDates: false,
			paginated: true
		},
		vendors: {
			label: "Vendors",
			query: "getVendors",
			fields: [
				"pearVendorId", "pearVendorCode", "vendorCode", "vendorName",
				"customPrettyName", "globalPrettyName", "remittanceName", "remittanceAddress",
				"mainPhone", "customerServicePhone", "priorityPhone", "emergencyPhone",
				"webAddress", "providerId", "importDate", "ERP Vendor ID", "Vendor Name AP"
			],
			requiresDates: false,
			paginated: true
		},
		bills: {
			label: "Bills (date range required)",
			query: "getBills",
			fields: [
				"billId", "billingId", "vendor", "vendorCode", "providerId",
				"invoiceDate", "dateDue", "billReceivedDate",
				"serviceStartDate", "serviceEndDate", "daysOfService",
				"adjServiceEndDate", "adjDaysOfService",
				"billType", "ratePlan", "estimated",
				"currentCharges", "priorBalance", "lateFees", "totalPayAmount",
				"consumptionUom", "totalConsumption", "generationConsumption",
				"demandKw", "billedDemand",
				"subcharges", "usageSubcharges", "consumptionSubcharges",
				"demandSubcharges", "billedUsageSubcharges", "taxesSubcharges",
				"customerSubcharges", "commoditySubcharges", "generationCharges",
				"otherSubcharges",
				"totalHdd", "totalCdd", "totalDegreeDays",
				"virtualAccountId", "virtualAccountGroup",
				"virtacctServiceAccountId", "virtacctMeterId", "virtacctUtilityType",
				"virtacctLocationAddress", "virtacctLocationZip",
				"paymentFileCreated", "markedForPayment", "createdAt"
			],
			requiresDates: true,
			paginated: false
		},
		monthlyFeed: {
			label: "Monthly Feed (date range required)",
			query: "getMonthlyFeed",
			fields: [
				"calendarMonth", "location", "number", "locationAddress", "locationZip",
				"vendor", "billingId",
				"virtualAccountId", "virtualAccountGroup",
				"virtacctServiceAccountId", "virtacctMeterId", "virtacctUtilityType",
				"billType", "consumptionUom", "totalConsumption", "maximumDemandKw",
				"charges", "usageCharges", "consumptionCharges", "demandCharges",
				"billedUsageSubcharges", "taxesCharges", "customerCharges",
				"generationCharges", "otherCharges",
				"totalHdd", "totalCdd", "totalDegreeDays",
				"importDate"
			],
			requiresDates: true,
			paginated: false
		},
		billErrors: {
			label: "Bill Errors",
			query: "getBillErrors",
			fields: ["billErrorId", "billingId", "ubmId", "invoiceDate", "importDate"],
			requiresDates: false,
			paginated: true
		}
	},

	joinGraph: {
		bills: {
			vendors: { from: "providerId", to: "providerId" },
			accounts: { from: "virtualAccountId", to: "virtualAccountId" },
			billErrors: { from: "billId", to: "pearId" }
		},
		monthlyFeed: {
			accounts: { from: "virtualAccountId", to: "virtualAccountId" }
		},
		accounts: {
			vendors: { from: "vendorId", to: "providerId" },
			billErrors: { from: "billingId", to: "billingId" }
		}
	},

	// ----- Customer resolution -----
	// Priority: CustomerSelect (only when visible — standalone use) → ?customer= URL param (embedded use) → "ppg".
	activeCustomer: () => {
		const known = UBMUtils.customerOptions.map(o => o.value);
		const dropdownActive = (typeof CustomerSelect !== "undefined") && CustomerSelect.isVisible;
		const picked = dropdownActive ? CustomerSelect.selectedOptionValue : null;
		if (picked && known.includes(String(picked).toLowerCase().trim())) {
			return String(picked).toLowerCase().trim();
		}
		const raw = (appsmith.URL && appsmith.URL.queryParams && appsmith.URL.queryParams.customer) || "";
		const code = String(raw).toLowerCase().trim();
		return known.includes(code) ? code : "ppg";
	},

	activeCustomerLabel: () => {
		const code = UBMUtils.activeCustomer();
		const opt = UBMUtils.customerOptions.find(o => o.value === code);
		return opt ? opt.label : code;
	},

	activeCustomerRaw: () => {
		const raw = (appsmith.URL && appsmith.URL.queryParams && appsmith.URL.queryParams.customer);
		return raw ? String(raw) : null;
	},

	bannerText: () => {
		const code = UBMUtils.activeCustomer();
		const label = UBMUtils.activeCustomerLabel();
		const raw = UBMUtils.activeCustomerRaw();
		if (raw && raw.toLowerCase().trim() !== code) {
			return `Unknown customer "${raw}" — defaulting to ${label}`;
		}
		return `Viewing as ${label}`;
	},

	// ----- Endpoints / fields -----
	endpointOptions: () => {
		const eps = UBMUtils.endpoints;
		return Object.keys(eps).map(k => ({ label: eps[k].label, value: k }));
	},

	selectedKeys: () => {
		const v = (typeof EndpointSelect !== "undefined") ? EndpointSelect.selectedOptionValues : null;
		if (Array.isArray(v) && v.length > 0) return v;
		return ["accounts"];
	},

	selectedSpecs: () => {
		return UBMUtils.selectedKeys()
			.map(k => UBMUtils.endpoints[k])
			.filter(Boolean);
	},

	currentSpec: () => {
		return UBMUtils.selectedSpecs()[0] || UBMUtils.endpoints.accounts;
	},

	requiresDates: () => {
		return UBMUtils.selectedSpecs().some(s => s.requiresDates);
	},

	isPaginated: () => {
		return UBMUtils.selectedSpecs().some(s => s.paginated);
	},

	fieldOptions: () => {
		const keys = UBMUtils.selectedKeys();
		if (keys.length === 1) {
			const fields = (UBMUtils.endpoints[keys[0]] && UBMUtils.endpoints[keys[0]].fields) || [];
			return fields.map(f => ({ label: f, value: f }));
		}
		const opts = [];
		for (const k of keys) {
			const ep = UBMUtils.endpoints[k];
			if (!ep) continue;
			for (const f of (ep.fields || [])) {
				opts.push({ label: ep.label + " · " + f, value: k + "__" + f });
			}
		}
		return opts;
	},

	statusText: () => {
		const r = UBMUtils.rows() || [];
		if (r.length === 0) return "No data loaded — click Run to fetch.";
		const picked = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues.length + " columns selected"
			: "all returned columns shown";
		return r.length.toLocaleString() + " rows loaded · " + picked;
	},

	// ----- Row extraction & join -----
	endpointRawRows: (key) => {
		const ep = UBMUtils.endpoints[key];
		if (!ep) return [];
		const map = {
			getAccounts: getAccounts.data,
			getVendors: getVendors.data,
			getBills: getBills.data,
			getMonthlyFeed: getMonthlyFeed.data,
			getBillErrors: getBillErrors.data
		};
		const raw = map[ep.query];
		if (!raw) return [];
		if (Array.isArray(raw)) return raw;
		if (Array.isArray(raw.data)) return raw.data;
		return [];
	},

	findJoin: (a, b) => {
		const direct = UBMUtils.joinGraph[a] && UBMUtils.joinGraph[a][b];
		if (direct) return direct;
		const reverse = UBMUtils.joinGraph[b] && UBMUtils.joinGraph[b][a];
		if (reverse) return { from: reverse.to, to: reverse.from };
		return null;
	},

	rows: () => {
		const keys = UBMUtils.selectedKeys();
		if (keys.length === 0) return [];
		const primary = keys[0];
		const primaryRows = UBMUtils.endpointRawRows(primary);
		if (keys.length === 1) return primaryRows;

		const lookups = keys.slice(1);
		const lookupMaps = {};
		for (const lk of lookups) {
			const join = UBMUtils.findJoin(primary, lk);
			if (!join) continue;
			const lkRows = UBMUtils.endpointRawRows(lk);
			const m = new Map();
			for (const r of lkRows) {
				const k = r[join.to];
				if (k === undefined || k === null) continue;
				const ks = String(k).toLowerCase();
				if (!m.has(ks)) m.set(ks, r);
			}
			lookupMaps[lk] = { join, map: m };
		}

		const joined = primaryRows.map(p => {
			const out = {};
			for (const k in p) out[primary + "__" + k] = p[k];
			for (const lk of lookups) {
				const lm = lookupMaps[lk];
				if (!lm) continue;
				const v = p[lm.join.from];
				const ks = (v === undefined || v === null) ? "" : String(v).toLowerCase();
				const matched = lm.map.get(ks);
				if (matched) {
					for (const k in matched) out[lk + "__" + k] = matched[k];
				}
			}
			return out;
		});

		// Normalize: every row exposes the same key set, seeded from actual data,
		// each endpoint's catalog, and a sample raw row per lookup.
		const allKeys = new Set();
		for (const r of joined) for (const k in r) allKeys.add(k);
		for (const k of keys) {
			const ep = UBMUtils.endpoints[k];
			if (ep && ep.fields) for (const f of ep.fields) allKeys.add(k + "__" + f);
		}
		for (const lk of lookups) {
			const sample = UBMUtils.endpointRawRows(lk)[0];
			if (sample) for (const f in sample) allKeys.add(lk + "__" + f);
		}
		for (const r of joined) {
			for (const k of allKeys) if (!(k in r)) r[k] = null;
		}
		return joined;
	},

	// ----- Auth -----
	tokenIsFresh: () => {
		const t = appsmith.store.ubm_token;
		const exp = appsmith.store.ubm_token_expires_at;
		return Boolean(t && exp && Date.now() < exp - 30000);
	},

	loginFor: async (customer) => {
		const action = customer === "simon" ? loginSimon : loginPPG;
		const res = await action.run();
		if (!res || !res.accessToken) {
			throw new Error("Login failed: no accessToken in response");
		}
		const expiresAt = Date.now() + ((res.expiresIn || 3600) * 1000);
		await storeValue("ubm_customer", customer);
		await storeValue("ubm_token", res.accessToken);
		await storeValue("ubm_token_expires_at", expiresAt);
		return res.accessToken;
	},

	ensureToken: async () => {
		const customer = UBMUtils.activeCustomer();
		const cached = appsmith.store.ubm_customer;
		if (customer !== cached || !UBMUtils.tokenIsFresh()) {
			await UBMUtils.loginFor(customer);
		}
		return appsmith.store.ubm_token;
	},

	// ----- Run / export -----
	run: async () => {
		await UBMUtils.ensureToken();
		const specs = UBMUtils.selectedSpecs();
		if (specs.length === 0) {
			showAlert("Pick at least one endpoint", "warning");
			return;
		}
		if (UBMUtils.requiresDates()) {
			if (!StartDate.selectedDate || !EndDate.selectedDate) {
				showAlert("Start and end dates are required for this endpoint", "warning");
				return;
			}
			const start = moment(StartDate.selectedDate);
			const end = moment(EndDate.selectedDate);
			if (end.isBefore(start)) {
				showAlert("End date must be on or after the start date", "error");
				return;
			}
			if (end.diff(start, "days") > 31) {
				showAlert("Date range can't exceed 31 days", "error");
				return;
			}
		}
		const queries = { getAccounts, getVendors, getBills, getMonthlyFeed, getBillErrors };
		const broken = UBMUtils.selectedKeys().slice(1).filter(k => !UBMUtils.findJoin(UBMUtils.selectedKeys()[0], k));
		if (broken.length > 0) {
			showAlert("No join path from " + UBMUtils.selectedKeys()[0] + " to: " + broken.join(", ") + " — those columns will be empty", "warning");
		}
		await Promise.all(specs.map(spec => queries[spec.query].run()));
	},

	exportCsv: () => {
		const rows = UBMUtils.rows();
		const fields = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues
			: (rows[0] ? Object.keys(rows[0]) : []);
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		const escape = (v) => {
			if (v === null || v === undefined) return "";
			if (typeof v === "object") v = JSON.stringify(v);
			const s = String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const header = fields.join(",");
		const body = rows.map(r => fields.map(f => escape(r[f])).join(",")).join("\n");
		const csv = header + "\n" + body;

		const customer = UBMUtils.activeCustomerLabel().replace(/\s+/g, "_");
		const keys = UBMUtils.selectedKeys().join("+");
		const stamp = moment().format("YYYYMMDD-HHmmss");
		const filename = `${customer}-${keys}-${stamp}.csv`;

		download(csv, filename, "text/csv");
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	exportXlsx: () => {
		const rows = UBMUtils.rows();
		const fields = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues
			: (rows[0] ? Object.keys(rows[0]) : []);
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		// Flatten objects to strings; project only selected fields, in selected order
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

		const customer = UBMUtils.activeCustomerLabel().replace(/\s+/g, "_");
		const keys = UBMUtils.selectedKeys().join("+");
		const stamp = moment().format("YYYYMMDD-HHmmss");
		const filename = `${customer}-${keys}-${stamp}.xlsx`;

		// Write workbook to base64 string and download as binary
		const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
		download({ data: b64, name: filename, type: "xlsx" }, filename);
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	reset: () => {
		// Clear filters and rerun with defaults
		if (typeof FieldsSelect !== "undefined" && FieldsSelect.clearValue) FieldsSelect.clearValue();
		if (typeof StartDate !== "undefined" && StartDate.reset) StartDate.reset();
		if (typeof EndDate !== "undefined" && EndDate.reset) EndDate.reset();
		resetWidget("LimitInput", false);
		resetWidget("OffsetInput", false);
		resetWidget("EndpointSelect", false);
		showAlert("Filters reset", "success");
	}
}
