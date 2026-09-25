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

	// The widget writes the picked value into its model and then fires the
	// event, so each handler reads it straight away, before anything resets it.
	async pickCustomer() {
		const id = Number(ErrorExplorer.model.pickCustomer) || 0;
		await storeValue('eeCustomer', id);
		await storeValue('eeLocation', 0);
		if (!id) return;
		ee_locations.run();
		ee_location_summary.run();
	},

	async pickLocation() {
		const id = Number(ErrorExplorer.model.pickLocation) || 0;
		await storeValue('eeLocation', id);
		if (id) this.loadLocation();
	},

	async pickMonths() {
		await storeValue('eeMonths', Number(ErrorExplorer.model.pickMonths) || 12);
		if (!appsmith.store.eeCustomer) return;
		ee_location_summary.run();
		if (appsmith.store.eeLocation) this.loadLocation();
	},

	openBill() {
		const id = ErrorExplorer.model.openBillId;
		if (id) navigateTo('Full Bill', { bill_id: id }, 'NEW_WINDOW');
	}
}
