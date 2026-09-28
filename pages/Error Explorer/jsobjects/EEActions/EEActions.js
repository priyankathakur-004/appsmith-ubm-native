export default {
	// The explorer widget is the only consumer of this page's queries, and
	// Appsmith does not run on-load queries for a custom widget's model, so the
	// small on-mount init widget calls this.
	defaultCustomer: 76013,

	// Flip to true once the backend exposes the acknowledge / reopen /
	// escalate endpoints; until then nothing is sent and nothing is saved.
	apiReady: false,

	async initPage() {
		ee_customers.run();
		ee_operators.run();
		if (!Number(appsmith.store.eeCustomer)) {
			await storeValue('eeCustomer', this.defaultCustomer);
			await storeValue('eeLocation', 0);
		}
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

	// One entry point for Acknowledge, Re-flag and Flag. The widget already
	// shows the change for this session; this is where the call to the backend
	// goes. Contract the endpoint needs, per action:
	//   acknowledge / reopen: errorIds, code, recordId, billId, customerId, locationId
	//   escalate:             the same, plus assigneeId (null = customer default) and note
	// The acting user must come from the session, never from this payload.
	errorAction(payload) {
		const p = payload ?? ErrorExplorer.model.errorAction;
		if (!p || !p.action) return { saved: false };
		if (!this.apiReady) return { saved: false, reason: 'no backend endpoint yet', request: p };
		return { saved: false, reason: 'endpoint not wired', request: p };
	},

	openBill(picked) {
		const id = picked ?? ErrorExplorer.model.pickedBill;
		if (id) navigateTo('Full Bill', { bill_id: id }, 'NEW_WINDOW');
	}
}
