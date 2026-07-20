export default {
	// "Clear" link: wipe every filter store + reset the widgets, then reload.
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

	// Download icon: export the currently loaded rows to CSV.
	downloadCsv() {
		const rows = fetch_payment_errors.data || [];
		const cols = [
			["payment_date", "Payment Date"], ["creation_date", "Creation Date"],
			["customer", "Customer"], ["days_on_error_log", "Days on Error Log"],
			["format", "Format"], ["event", "Event"], ["type", "Type"],
			["bill_id", "Bill ID"], ["description", "Description"]
		];
		const esc = (v) => '"' + (v == null ? "" : String(v)).split('"').join('""') + '"';
		const header = cols.map(c => esc(c[1])).join(",");
		const lines = rows.map(r => cols.map(c => esc(r[c[0]])).join(","));
		download([header].concat(lines).join("\n"), "payment_error_log.csv", "text/csv");
	}
}
