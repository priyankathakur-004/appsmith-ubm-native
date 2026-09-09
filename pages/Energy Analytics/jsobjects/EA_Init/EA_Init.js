export default {

	/* Query orchestration.

	   Every fetch_* on this page is MANUAL and runs from here, so there is exactly one
	   caller and nothing fires twice. Appsmith would otherwise re-run each AUTOMATIC
	   query on its own the moment a binding changed, on top of these calls.

	   The page also only fetches what the screen in front of the user needs. Portfolio,
	   Energy Performance and Cost & Forecast share the monthly usage pull, so moving
	   between them costs nothing once it has loaded. */

	/* Which queries each view reads. The shared usage pull is listed first so it starts
	   before the view-specific ones. */
	_needs(view) {
		if (view === 'Bill Health')        return ['fetch_analytics_data', 'fetch_received_bills', 'fetch_late_bills'];
		if (view === 'Exceptions')         return ['fetch_warnings', 'fetch_late_fees', 'fetch_notifications'];
		if (view === 'Portfolio')          return ['fetch_analytics_data', 'fetch_utility_tree_data'];
		if (view === 'Energy Performance') return ['fetch_analytics_data', 'fetch_demand_loadfactor'];
		return ['fetch_analytics_data'];   // Cost & Forecast
	},

	_view() {
		try { return (typeof EAViewSelect !== 'undefined' && EAViewSelect.selectedOptionValue) || 'Portfolio'; }
		catch (e) { return 'Portfolio'; }
	},

	_query(name) {
		/* Named lookup, so _needs() can stay a list of strings. */
		const map = {
			fetch_analytics_data, fetch_utility_tree_data, fetch_demand_loadfactor,
			fetch_received_bills, fetch_late_bills, fetch_warnings,
			fetch_late_fees, fetch_notifications
		};
		return map[name];
	},

	/* Everything that changes what a data query would return. When this is unchanged and
	   a query already holds rows, re-running it would return exactly what is on screen. */
	_signature() {
		const v = w => {
			try {
				if (typeof w === 'undefined' || !w) return null;
				return w.selectedOptionValues !== undefined ? w.selectedOptionValues
				     : (w.selectedOptionValue !== undefined ? w.selectedOptionValue : w.text);
			} catch (e) { return null; }
		};
		return JSON.stringify([
			typeof CustomerSelect !== 'undefined' ? CustomerSelect.selectedOptionValue : null,
			v(typeof EADateSelect         !== 'undefined' ? EADateSelect         : null),
			v(typeof EADateNumInput       !== 'undefined' ? EADateNumInput       : null),
			v(typeof EADateUnitSelect     !== 'undefined' ? EADateUnitSelect     : null),
			v(typeof EADateModeSelect     !== 'undefined' ? EADateModeSelect     : null),
			v(typeof EAUtilityTypeSelect  !== 'undefined' ? EAUtilityTypeSelect  : null),
			v(typeof EABillTypeSelect     !== 'undefined' ? EABillTypeSelect     : null),
			v(typeof EALocationSelect     !== 'undefined' ? EALocationSelect     : null),
			v(typeof EALocationAttrSelect !== 'undefined' ? EALocationAttrSelect : null),
			v(typeof EAAttrChoiceSelect   !== 'undefined' ? EAAttrChoiceSelect   : null),
			v(typeof EAAcctStatusSelect   !== 'undefined' ? EAAcctStatusSelect   : null),
			v(typeof EASeveritySelect     !== 'undefined' ? EASeveritySelect     : null)
		]);
	},

	/* Run only what this view needs and does not already hold for the current filters.
	   `force` is for a filter change, where every result is stale by definition. */
	async _load(force) {
		const sig = this._signature();
		const stale = force || appsmith.store.eaSig !== sig;
		if (stale) await storeValue('eaSig', sig);

		const pending = this._needs(this._view()).filter(n => {
			if (stale) return true;
			const q = this._query(n);
			return !q || !Array.isArray(q.data);   // never fetched under these filters
		});

		if (!pending.length) return;
		await Promise.all(pending.map(n => this._query(n).run()));
	},

	/* Lookups that do not mention a customer. Fetched once per session, not per switch. */
	async _globalLookups() {
		if (appsmith.store.eaLookups) return;
		await Promise.all([
			fetch_customers.run(),
			fetch_account_status.run(),
			fetch_building_types.run()
		]);
		await storeValue('eaLookups', true);
	},

	/* Option lists scoped to the selected customer. */
	async _customerLookups() {
		await Promise.all([
			fetch_locations.run(),
			fetch_utility_types.run(),
			fetch_bill_types.run(),
			fetch_location_attributes.run(),
			fetch_bill_accounts.run()
		]);
	},

	/* First paint. The five views are custom widgets fed through defaultModel, and
	   Appsmith does not always treat that as an on-load dependency, so the page is
	   started explicitly from the PageInit widget's onReady. */
	async initPage() {
		/* Drop any cache from a previous session: the queries may have changed since. */
		await storeValue('eaSig', null);
		await this._globalLookups();
		await this._customerLookups();
		await this._load(true);
	},

	/* Customer switch. The global lookups do not depend on the customer, so they are
	   left alone; only the customer-scoped option lists and the view's data reload. */
	async onCustomerChange() {
		await this._customerLookups();
		await this._load(true);
	},

	/* View switch. Anything the new view shares with the old one is already loaded
	   under the same filters, so this usually runs only the queries unique to it —
	   and nothing at all when moving between Portfolio, Energy and Cost. */
	async loadView() {
		await this._load(false);
	},

	/* Filter change: every loaded result is stale. */
	async applyFilters() {
		await this._load(true);
	}
}
