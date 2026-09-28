export default {
	// The explorer widget is the only consumer of this page's queries, and
	// Appsmith does not run on-load queries for a custom widget's model, so the
	// small on-mount init widget calls this.
	defaultCustomer: 76013,

	// Flip to true once the backend exposes the acknowledge / reopen /
	// escalate endpoints; until then nothing is sent and nothing is saved.
	apiReady: false,

	async initPage() {
		// Acknowledge / Flag live for one page visit only: start every load clean
	// (the store would otherwise carry them over to the next visit).
		await storeValue('eeSession', { ack: {}, flag: {}, log: {}, to: {} });
		await storeValue('eePopup', null);
		ee_customers.run();
		ee_operators.run();
		if (!Number(appsmith.store.eeCustomer)) {
			await storeValue('eeCustomer', this.defaultCustomer);
			await storeValue('eeLocation', 0);
		}
		if (appsmith.store.eeCustomer) {
			ee_validation_setup.run();
			ee_customer_profile.run();
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
		ee_validation_setup.run();
		ee_customer_profile.run();
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

	// Opens the error popup in the page modal with what the explorer sent.
	async showError(payload) {
		const p = payload ?? ErrorExplorer.model.errorPopup;
		if (!p) return;
		await storeValue('eePopup', p);
		await showModal('ErrorModal');
	},

	closeError() {
		closeModal('ErrorModal');
	},

	// One entry point for Acknowledge, Re-flag and Flag from the modal.
	// It records the action for this page visit (in the store, cleared on load) so
	// both widgets show it, then is where the backend call goes. What the
	// endpoint needs, per action:
	//   acknowledge / reopen: errorIds (bill_errors.id, stable), code, recordId,
	//                         billId, customerId, locationId
	//   escalate: the same, plus assigneeId (null = current assignee / CSM) and
	//             note; UBM's own "Assign to user" on the bill plus a comment
	//             tagging the operator
	// The acting user must come from the session, never from this payload.
	async errorAction(payload) {
		const p = payload ?? ErrorDetail.model.errorAction;
		if (!p || !p.action) return { saved: false };
		const s = JSON.parse(JSON.stringify(appsmith.store.eeSession || {}));
		['ack', 'flag', 'log', 'to'].forEach(k => { s[k] = s[k] || {}; });
		const d = new Date();
		const when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toTimeString().slice(0, 5);
		const log = s.log[p.groupKey] = s.log[p.groupKey] || [];
		if (p.action === 'acknowledge') {
			p.errorIds.forEach(i => { s.ack[i] = true; });
			log.push('Acknowledged (muted) ' + when + ' · not saved');
		} else if (p.action === 'reopen') {
			p.errorIds.forEach(i => { delete s.ack[i]; });
			log.push('Re-flagged ' + when + ' · not saved');
		} else if (p.action === 'escalate') {
			p.errorIds.forEach(i => { s.flag[i] = true; delete s.ack[i]; });
			s.to[p.groupKey] = p.assigneeName || 'operator';
			log.push('Flagged to ' + (p.assigneeName || 'operator') + ' ' + when + (p.note ? ': "' + p.note + '"' : '') + ' · not saved');
		}
		await storeValue('eeSession', s);
		if (!this.apiReady) return { saved: false, reason: 'no backend endpoint yet', request: p };
		return { saved: false, reason: 'endpoint not wired', request: p };
	},

	openBill(picked) {
		const id = picked ?? ErrorExplorer.model.pickedBill;
		if (id) navigateTo('Full Bill', { bill_id: id }, 'NEW_WINDOW');
	}
}
