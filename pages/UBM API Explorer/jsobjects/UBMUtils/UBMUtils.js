export default {
	// ----- Static config -----
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
			label: "Bills",
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
			label: "Monthly Feed",
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

	// ----- Join graph -----
	// Defines how endpoints can be joined. Reverse direction is auto-derived.
	// from = field on left endpoint, to = field on right endpoint.
	joinGraph: {
		bills: {
			vendors: { from: "vendorCode", to: "vendorCode" },
			accounts: { from: "virtualAccountId", to: "virtualAccountId" },
			billErrors: { from: "billId", to: "ubmId" }
		},
		monthlyFeed: {
			vendors: { from: "vendor", to: "vendorName" },
			accounts: { from: "virtualAccountId", to: "virtualAccountId" }
		},
		accounts: {
			vendors: { from: "vendorId", to: "pearVendorId" },
			billErrors: { from: "billingId", to: "billingId" }
		}
	},

	// ----- Selection helpers -----
	endpointOptions: () => {
		const eps = UBMUtils.endpoints;
		return Object.keys(eps).map(k => ({ label: eps[k].label, value: k }));
	},

	selectedKeys: () => {
		const v = (typeof EndpointSelect !== "undefined") ? EndpointSelect.selectedOptionValues : null;
		if (Array.isArray(v) && v.length > 0) return v;
		return ["accounts"];
	},

	primaryKey: () => UBMUtils.selectedKeys()[0],

	selectedSpecs: () => {
		return UBMUtils.selectedKeys()
			.map(k => UBMUtils.endpoints[k])
			.filter(Boolean);
	},

	requiresDates: () => UBMUtils.selectedSpecs().some(s => s.requiresDates),
	isPaginated: () => UBMUtils.selectedSpecs().some(s => s.paginated),

	// ----- Field options -----
	// Single endpoint → unprefixed (clean). Multi → prefixed "endpoint__field" with
	// pretty label "Endpoint · field" so AG Grid columns are unambiguous.
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

	// ----- Row extraction -----
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

		// Single endpoint: pass through unchanged (unprefixed keys).
		if (keys.length === 1) return primaryRows;

		// Multi endpoint: build lookup maps for each non-primary, then enrich.
		const lookups = keys.slice(1);
		const lookupMaps = {};
		for (const lk of lookups) {
			const join = UBMUtils.findJoin(primary, lk);
			if (!join) continue; // Unsupported pair — silently skip; status/run() warns.
			const rows = UBMUtils.endpointRawRows(lk);
			const m = new Map();
			for (const r of rows) {
				const k = r[join.to];
				if (k === undefined || k === null) continue;
				const ks = String(k).toLowerCase();
				if (!m.has(ks)) m.set(ks, r);
			}
			lookupMaps[lk] = { join, map: m };
		}

		return primaryRows.map(p => {
			const out = {};
			for (const k in p) out[primary + "__" + k] = p[k];
			for (const lk of lookups) {
				const lm = lookupMaps[lk];
				if (!lm) continue;
				const v = p[lm.join.from];
				const ks = (v === undefined || v === null) ? "" : String(v).toLowerCase();
				const matched = lm.map.get(ks) || {};
				for (const k in matched) out[lk + "__" + k] = matched[k];
			}
			return out;
		});
	},

	// ----- Status -----
	statusText: () => {
		const r = UBMUtils.rows() || [];
		const keys = UBMUtils.selectedKeys();
		if (r.length === 0) return "No data loaded — click Run to fetch.";
		const picked = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues.length + " columns selected"
			: "all returned columns shown";
		const epLabel = keys.length > 1 ? " (" + keys.join(" + ") + ")" : "";
		return r.length.toLocaleString() + " rows" + epLabel + " · " + picked;
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
		const customer = CustomerSelect.selectedOptionValue;
		if (!customer) throw new Error("Pick a customer first");
		const cached = appsmith.store.ubm_customer;
		if (customer !== cached || !UBMUtils.tokenIsFresh()) {
			await UBMUtils.loginFor(customer);
		}
		return appsmith.store.ubm_token;
	},

	// ----- Run / export -----
	run: async () => {
		await UBMUtils.ensureToken();
		const keys = UBMUtils.selectedKeys();
		const specs = UBMUtils.selectedSpecs();
		if (specs.length === 0) {
			showAlert("Pick at least one endpoint", "warning");
			return;
		}

		// Date validation if any selected endpoint requires dates
		if (UBMUtils.requiresDates()) {
			if (!StartDate.selectedDate || !EndDate.selectedDate) {
				showAlert("Start and end dates are required for the selected endpoints", "warning");
				return;
			}
			const start = moment(StartDate.selectedDate);
			const end = moment(EndDate.selectedDate);
			if (end.isBefore(start)) {
				showAlert("End date must be on or after the start date", "error");
				return;
			}
			if (end.diff(start, "days") > 31) {
				showAlert("Date range can't exceed 31 days (this endpoint is rate-limited)", "error");
				return;
			}
		}

		// Warn about un-joinable lookups
		if (keys.length > 1) {
			const primary = keys[0];
			const broken = keys.slice(1).filter(k => !UBMUtils.findJoin(primary, k));
			if (broken.length > 0) {
				showAlert("No join path from " + primary + " to: " + broken.join(", ") + " — those columns will be empty", "warning");
			}
		}

		const queries = { getAccounts, getVendors, getBills, getMonthlyFeed, getBillErrors };
		const promises = specs.map(spec => queries[spec.query].run());
		await Promise.all(promises);
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

		const customer = CustomerSelect.selectedOptionLabel || "customer";
		const eps = UBMUtils.selectedKeys();
		const endpoint = eps.length === 1 ? eps[0] : eps.join("+");
		const stamp = moment().format("YYYYMMDD-HHmmss");
		const filename = `${customer.replace(/\s+/g, "_")}-${endpoint}-${stamp}.csv`;

		download(csv, filename, "text/csv");
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	}
}
