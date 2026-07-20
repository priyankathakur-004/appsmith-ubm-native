export default {
	// --- Payments Error Log ---
	clearFilters() {
		storeValue("err_customerId", null);
		storeValue("err_types", []);
		storeValue("err_payFrom", null);
		storeValue("err_payTo", null);
		storeValue("err_createFrom", null);
		storeValue("err_createTo", null);
		resetWidget("CustomerSelect", true);
		resetWidget("ErrorTypeSelect", true);
		resetWidget("PayDateFrom", true);
		resetWidget("PayDateTo", true);
		resetWidget("CreateDateFrom", true);
		resetWidget("CreateDateTo", true);
		fetch_payment_errors.run();
	},

	downloadCsv() {
		this._csv(fetch_payment_errors.data || [], [
			["payment_date", "Payment Date"], ["creation_date", "Creation Date"],
			["customer", "Customer"], ["days_on_error_log", "Days on Error Log"],
			["format", "Format"], ["event", "Event"], ["type", "Type"],
			["bill_id", "Bill ID"], ["description", "Description"]
		], "payment_error_log.csv");
	},

	// --- Communication Error Log ---
	clearCommFilters() {
		storeValue("comm_customerId", null);
		storeValue("comm_status", null);
		storeValue("comm_types", []);
		storeValue("comm_module", null);
		storeValue("comm_email", null);
		storeValue("comm_initCreate", null);
		storeValue("comm_statusChange", null);
		resetWidget("CommCustomer", true);
		resetWidget("CommStatus", true);
		resetWidget("CommType", true);
		resetWidget("CommModule", true);
		resetWidget("CommEmail", true);
		resetWidget("CommInitDate", true);
		resetWidget("CommChangeDate", true);
		fetch_comm_errors.run();
	},

	downloadCommCsv() {
		this._csv(fetch_comm_errors.data || [], [
			["initial_creation_date", "Initial Creation Date"], ["status", "Status"],
			["type", "Type"], ["status_change_date", "Status Change Date"],
			["customer", "Customer"], ["module", "Module"], ["email_address", "Email Address"]
		], "communication_error_log.csv");
	},

	// "More Details" row link (read-only placeholder until a detail view is defined).
	commDetails(row) {
		if (!row) return;
		showAlert("Details for " + (row.email_address || "record") + " — read-only view", "info");
	},

	// shared CSV builder
	_csv(rows, cols, fname) {
		const esc = (v) => '"' + (v == null ? "" : String(v)).split('"').join('""') + '"';
		const header = cols.map(c => esc(c[1])).join(",");
		const lines = rows.map(r => cols.map(c => esc(r[c[0]])).join(","));
		download([header].concat(lines).join("\n"), fname, "text/csv");
	}
}
