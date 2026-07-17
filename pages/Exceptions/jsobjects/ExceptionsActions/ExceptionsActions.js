export default {
	// Row "Map" click from the Unmapped custom widget. The widget calls
	// updateModel({selectedRow}) then fires onRowAction -> this method with the row.
	// Stash the row so MapAccountModal's body can read it, then open the modal.
	async mapAccount(row) {
		if (!row) return;
		await storeValue("mapVirtualAccount", row);
		showModal("MapAccountModal");
	},

	// Row "View" click from the Unprocessed Bills widget: open the bill in Full Bill.
	// (Unprocessed Bills has no row action in the current design; kept for reuse.)
	viewBill(row) {
		if (!row || !row.record_id) return;
		navigateTo("Full Bill", { bill_id: row.record_id }, "SAME_WINDOW");
	},

	// "Bulk Map" header link -> open the bulk-map modal (read-only in this view).
	bulkMap() {
		showModal("BulkMapModal");
	}
}
