export default {
	// ----- Endpoint catalog -----
	// Each entry: {label, query, dataPath, fields, requiresDates, paginated}
	// `fields` is the seed list shown in the multi-select. The user can add custom
	// keys at runtime — the grid will surface every key present on rows anyway.
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

	// ----- Computed convenience props -----
	get endpointOptions() {
		return Object.entries(this.endpoints).map(([k, v]) => ({ label: v.label, value: k }));
	},

	get currentSpec() {
		const sel = EndpointSelect.selectedOptionValue || "accounts";
		return this.endpoints[sel] || this.endpoints.accounts;
	},

	get fieldOptions() {
		return (this.currentSpec.fields || []).map(f => ({ label: f, value: f }));
	},

	get rows() {
		const map = {
			getAccounts: getAccounts.data,
			getVendors: getVendors.data,
			getBills: getBills.data,
			getMonthlyFeed: getMonthlyFeed.data,
			getBillErrors: getBillErrors.data
		};
		const raw = map[this.currentSpec.query];
		// Bills returns {data:[...]}; others {data:[...], pagination:{...}}.
		if (!raw) return [];
		if (Array.isArray(raw)) return raw;
		if (Array.isArray(raw.data)) return raw.data;
		return [];
	},

	// ----- Auth -----
	tokenIsFresh: () => {
		const t = appsmith.store.ubm_token;
		const exp = appsmith.store.ubm_token_expires_at;
		return Boolean(t && exp && Date.now() < exp - 30000); // 30s safety margin
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

	ensureTokenForSelectedCustomer: async function () {
		const customer = CustomerSelect.selectedOptionValue;
		if (!customer) throw new Error("Pick a customer first");
		const cached = appsmith.store.ubm_customer;
		if (customer !== cached || !this.tokenIsFresh()) {
			await this.loginFor(customer);
		}
		return appsmith.store.ubm_token;
	},

	// ----- Run / export -----
	run: async function () {
		await this.ensureTokenForSelectedCustomer();
		const spec = this.currentSpec;
		if (spec.requiresDates) {
			if (!StartDate.selectedDate || !EndDate.selectedDate) {
				showAlert("Start and end dates are required for this endpoint", "warning");
				return;
			}
		}
		const queryName = spec.query;
		const queries = { getAccounts, getVendors, getBills, getMonthlyFeed, getBillErrors };
		await queries[queryName].run();
	},

	exportCsv: function () {
		const rows = this.rows;
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
		const endpoint = this.currentSpec.label.split(" ")[0].toLowerCase();
		const stamp = moment().format("YYYYMMDD-HHmmss");
		const filename = `${customer.replace(/\s+/g, "_")}-${endpoint}-${stamp}.csv`;

		// Trigger browser download
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
}
