export default {
	// Runs on page load (this function is flagged run-on-load) so every table and
	// the customer dropdown populate without relying on Appsmith's on-load
	// inference, which doesn't fire the AUTOMATIC queries when only custom-widget
	// models consume them. Mirrors the CustomerSelect.onOptionChange fetch set.
	initPage() {
		getCustomers.run();
		fetch_unmapped_vas.run();
		fetch_unpaired_vas.run();
		fetch_unprocessed_bills.run();
	},

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
	},

	// "Virtual Accounts" link on an Unpaired site header: load every VA mapped to
	// that location, then open the Location Details modal. Await the store + fetch
	// so the modal body reads the right location's data.
	async openLocation(locationId, site) {
		if (!locationId) return;
		await storeValue("selectedLocationId", locationId);
		await storeValue("selectedLocationSite", site || "");
		await fetch_location_vas.run();
		showModal("LocationDetailsModal");
	}
}
