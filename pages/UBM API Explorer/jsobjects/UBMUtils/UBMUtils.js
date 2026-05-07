export default {
	// ----- Static config -----
	customerOptions: [
		{ label: "PPG Industries", value: "ppg" },
		{ label: "Simon Property Group", value: "simon" }
	],

	// Each entry: {label, query, dataPath, fields, requiresDates, paginated}
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

	// ----- Methods (must be invoked with parens in bindings) -----
	endpointOptions: () => {
		const eps = UBMUtils.endpoints;
		return Object.keys(eps).map(k => ({ label: eps[k].label, value: k }));
	},

	currentSpec: () => {
		const sel = (typeof EndpointSelect !== "undefined" && EndpointSelect.selectedOptionValue) || "accounts";
		return UBMUtils.endpoints[sel] || UBMUtils.endpoints.accounts;
	},

	fieldOptions: () => {
		const fields = (UBMUtils.currentSpec().fields) || [];
		return fields.map(f => ({ label: f, value: f }));
	},

	requiresDates: () => {
		return Boolean(UBMUtils.currentSpec().requiresDates);
	},

	statusText: () => {
		const r = UBMUtils.rows() || [];
		if (r.length === 0) return "No data loaded — click Run to fetch.";
		const picked = (FieldsSelect.selectedOptionValues && FieldsSelect.selectedOptionValues.length > 0)
			? FieldsSelect.selectedOptionValues.length + " columns selected"
			: "all returned columns shown";
		return r.length.toLocaleString() + " rows loaded · " + picked;
	},

	rows: () => {
		const spec = UBMUtils.currentSpec();
		const map = {
			getAccounts: getAccounts.data,
			getVendors: getVendors.data,
			getBills: getBills.data,
			getMonthlyFeed: getMonthlyFeed.data,
			getBillErrors: getBillErrors.data
		};
		const raw = map[spec.query];
		if (!raw) return [];
		if (Array.isArray(raw)) return raw;
		if (Array.isArray(raw.data)) return raw.data;
		return [];
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
		const spec = UBMUtils.currentSpec();
		if (spec.requiresDates) {
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
				showAlert("Date range can't exceed 31 days (this endpoint is rate-limited)", "error");
				return;
			}
		}
		const queries = { getAccounts, getVendors, getBills, getMonthlyFeed, getBillErrors };
		await queries[spec.query].run();
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
		const endpoint = (UBMUtils.currentSpec().label || "data").split(" ")[0].toLowerCase();
		const stamp = moment().format("YYYYMMDD-HHmmss");
		const filename = `${customer.replace(/\s+/g, "_")}-${endpoint}-${stamp}.csv`;

		download(csv, filename, "text/csv");
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	}
}
