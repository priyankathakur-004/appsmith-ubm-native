export default {
	// Runs on page load (this function is flagged run-on-load) so every table and
	// filter dropdown populates without relying on Appsmith's on-load inference.
	initPage() {
		getCustomers.run();
		fetch_error_types.run();
		fetch_comm_statuses.run();
		fetch_comm_types.run();
		fetch_comm_modules.run();
		fetch_comm_emails.run();
		fetch_payment_errors.run();
		fetch_comm_errors.run();
		fetch_validation_codes.run();
		fetch_validation_stats.run();
	},

	// --- Payments Error Log ---
	clearFilters() {
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

	// --- Bill Errors (validation codes) ---
	// Customer and the raised-date range are read straight off the widgets by the
	// two aggregate queries, so clearing them is enough to restore the defaults.
	clearValFilters() {
		resetWidget("ValCustomer", true);
		resetWidget("ValDateFrom", true);
		resetWidget("ValDateTo", true);
		resetWidget("ValStage", true);
		resetWidget("ValSeverity", true);
		resetWidget("ValCategory", true);
		resetWidget("ValSearch", true);
		fetch_validation_codes.run();
		fetch_validation_stats.run();
	},

	// Row link on the catalogue: stash which check was clicked, load its bills,
	// then open the modal. The code alone is not a key - the same number means
	// different checks under different categories - so both are stored.
	async valShowBills(row) {
		if (!row || row["Code"] == null) return;
		await storeValue("valCode", row["Code"]);
		await storeValue("valCategory", row["Category"] || "");
		await storeValue("valName", row["Check"] || "");
		await fetch_validation_bills.run();
		showModal("ValDetailModal");
	},

	downloadValCsv() {
		this._csv(fetch_validation_codes.data || [], [
			["Code", "Code"], ["Category", "Category"], ["Check", "Check"],
			["Stage", "Stage"], ["Severity", "Severity"],
			["Occurrences", "Occurrences"], ["Bills Affected", "Bills Affected"],
			["Open", "Open"], ["Resolved", "Resolved"], ["Resolved %", "Resolved %"],
			["Resolvable", "Resolvable"], ["Last Seen", "Last Seen"]
		], "bill_validation_codes.csv");
	},

	// "More Details" row link: load the full row, then open the detail modal.
	// The custom table already did updateModel({selectedRow}) before firing this,
	// so fetch_comm_detail's WHERE reads CommTable.model.selectedRow.id.
	async commDetails(row) {
		if (!row || row.id == null) return;
		await fetch_comm_detail.run();
		showModal("CommDetailModal");
	},

	// shared CSV builder
	_csv(rows, cols, fname) {
		const esc = (v) => '"' + (v == null ? "" : String(v)).split('"').join('""') + '"';
		const header = cols.map(c => esc(c[1])).join(",");
		const lines = rows.map(r => cols.map(c => esc(r[c[0]])).join(","));
		download([header].concat(lines).join("\n"), fname, "text/csv");
	}
}
