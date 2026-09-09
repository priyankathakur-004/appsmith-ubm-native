export default {

	/* On-load bootstrap.

	   The five views are custom widgets fed through defaultModel. Appsmith does not always
	   treat a defaultModel binding as an on-load dependency, so an AUTOMATIC query can sit
	   unrun until something else touches it. Calling the fetches explicitly here — from a
	   widget's onMount — is what makes the page populate on first paint. */

	async initPage() {
		/* Option lists first: the filter bar has to be able to render before the heavy pulls. */
		await Promise.all([
			fetch_customers.run(),
			fetch_locations.run(),
			fetch_utility_types.run(),
			fetch_bill_types.run(),
			fetch_account_status.run(),
			fetch_building_types.run(),
			fetch_bill_accounts.run()
		]);

		await this.loadView();
	},

	/* Run only the queries the current view needs. Portfolio / Energy / Cost share the
	   monthly usage pull; Bill Health and Exceptions each add their own sources. */
	async loadView() {
		const view = (typeof EAViewSelect !== 'undefined' && EAViewSelect.selectedOptionValue) || 'Portfolio';

		if (view === 'Bill Health') {
			await Promise.all([
				fetch_analytics_data.run(),
				fetch_received_bills.run(),
				fetch_late_bills.run()
			]);
			return;
		}

		if (view === 'Exceptions') {
			await Promise.all([
				fetch_warnings.run(),
				fetch_late_fees.run(),
				fetch_notifications.run()
			]);
			return;
		}

		if (view === 'Portfolio') {
			await Promise.all([
				fetch_analytics_data.run(),
				fetch_utility_tree_data.run()
			]);
			return;
		}

		if (view === 'Energy Performance') {
			await Promise.all([
				fetch_analytics_data.run(),
				fetch_demand_loadfactor.run()
			]);
			return;
		}

		/* Cost & Forecast */
		await fetch_analytics_data.run();
	},

	/* Called by the filter bar. The filters are baked into the SQL through
	   EA_Filters.analyticsWhere(), so a filter change means re-running the view's queries. */
	async applyFilters() {
		await this.loadView();
	}
}
