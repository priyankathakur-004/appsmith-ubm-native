export default {
	// The explorer widget is the only consumer of this page's queries, and
	// Appsmith does not run on-load queries for a custom widget's model, so the
	// small on-mount init widget calls this.
	initPage() {
		ee_customers.run();
		if (appsmith.store.eeCustomer) {
			ee_locations.run();
			ee_location_summary.run();
			if (appsmith.store.eeLocation) this.loadLocation();
		}
	},

	loadLocation() {
		ee_location_accounts.run();
		ee_location_bills.run();
		ee_location_errors.run();
	},

	// Each handler gets the picked value from the event payload. The widget
	// also writes it into its model, used only when the payload is missing.
	async pickCustomer(picked) {
		const id = Number(picked ?? ErrorExplorer.model.pickedCustomer) || 0;
		await storeValue('eeCustomer', id);
		await storeValue('eeLocation', 0);
		if (!id) return;
		ee_locations.run();
		ee_location_summary.run();
	},

	async pickLocation(picked) {
		const id = Number(picked ?? ErrorExplorer.model.pickedLocation) || 0;
		await storeValue('eeLocation', id);
		if (id) this.loadLocation();
	},

	async pickMonths(picked) {
		await storeValue('eeMonths', Number(picked ?? ErrorExplorer.model.pickedMonths) || 12);
		if (!appsmith.store.eeCustomer) return;
		ee_location_summary.run();
		if (appsmith.store.eeLocation) this.loadLocation();
	},

	openBill(picked) {
		const id = picked ?? ErrorExplorer.model.pickedBill;
		if (id) navigateTo('Full Bill', { bill_id: id }, 'NEW_WINDOW');
	}
}
