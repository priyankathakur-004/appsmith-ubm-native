export default {
	// Row "Map" click from the Unmapped / Unpaired custom widgets. The widget calls
	// updateModel({selectedRow}) then fires onRowAction -> this method with the row.
	// TODO: wire to the real mapping flow (modal / dedicated mapping screen) once known.
	async mapAccount(row) {
		if (!row) return;
		await storeValue("mapVirtualAccount", row);
		showAlert("Mapping VA " + (row.va_id || "") + " — connect this to the mapping flow", "info");
	},

	// Row "View" click from the Unprocessed Bills widget: open the bill in Full Bill.
	viewBill(row) {
		if (!row || !row.bill_id) return;
		navigateTo("Full Bill", { bill_id: row.bill_id }, "SAME_WINDOW");
	},

	// "Bulk Map" header link. TODO: wire to the real bulk-mapping screen once known.
	bulkMap() {
		showAlert("Bulk Map — connect this to the bulk-mapping flow", "info");
	}
}
