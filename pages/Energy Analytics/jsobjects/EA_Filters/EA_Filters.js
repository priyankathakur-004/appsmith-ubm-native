export default {

	/* Read a multi-select widget's values as an array (guarded). */
	_multiVals(w) {
		try {
			const v = w && w.selectedOptionValues;
			return Array.isArray(v) ? v : [];
		} catch (e) { return []; }
	},

	/* View-scoped WHERE clause for fetch_analytics_data on the Energy Analytics page.

	   This page carries the five prototype views. Portfolio / Energy Performance /
	   Cost & Forecast share ONE filter bar (the EA* widgets), because the prototype
	   draws them as one global bar. Bill Health and Exceptions narrow the same rows
	   further with their own extra selectors, so a selection made on a triage screen
	   never widens the analytics screens.

	   IMPORTANT: this JSObject must NOT read fetch_analytics_data.data — that query
	   references this method, so reading it back would create a cyclic dependency.
	   The same rule applies to every fetch_* on this page. */
	analyticsWhere() {
		const view = (typeof EAViewSelect !== 'undefined' && EAViewSelect.selectedOptionValue) || 'Portfolio';
		const q = s => `'${String(s).replace(/'/g, "''")}'`;
		const c = [];

		/* ---- shared filter bar: applies to every view ---- */

		const dates = (typeof EADateSelect !== 'undefined' && Array.isArray(EADateSelect.selectedOptionValues))
			? EADateSelect.selectedOptionValues.filter(d => d.includes('-')) : [];

		if (dates.length) {
			c.push(`AND m.time_period IN (${dates.map(q).join(',')})`);
		} else {
			/* No explicit month list. Bound the pull to the rolling window the Date
			   widgets describe, so a customer with years of history cannot blow past
			   Appsmith's 5 MB response cap the way an unbounded SELECT would. */
			c.push(`AND m.time_period >= '${this._rollingCutoff()}'`);
		}

		if (typeof EAUtilityTypeSelect !== 'undefined' && EAUtilityTypeSelect.selectedOptionValue && EAUtilityTypeSelect.selectedOptionValue !== 'All')
			c.push(`AND m.utility_type = ${q(EAUtilityTypeSelect.selectedOptionValue)}`);

		if (typeof EABillTypeSelect !== 'undefined' && EABillTypeSelect.selectedOptionValue && EABillTypeSelect.selectedOptionValue !== 'All')
			c.push(`AND m.bill_type = ${q(EABillTypeSelect.selectedOptionValue)}`);

		if (typeof EALocationSelect !== 'undefined' && EALocationSelect.selectedOptionValue && EALocationSelect.selectedOptionValue !== 'All')
			c.push(`AND m.location_id = ${EALocationSelect.selectedOptionValue}`);

		if (typeof EALocationAttrSelect !== 'undefined' && EALocationAttrSelect.selectedOptionValue && EALocationAttrSelect.selectedOptionValue !== 'All') {
			const choice = (typeof EAAttrChoiceSelect !== 'undefined' && EAAttrChoiceSelect.selectedOptionValue && EAAttrChoiceSelect.selectedOptionValue !== 'All')
				? EAAttrChoiceSelect.selectedOptionValue : null;
			c.push(`AND EXISTS (\n    SELECT 1\n    FROM jsonb_array_elements(m.location_attributes->'custom_attributes') attr\n    WHERE attr->>'id' = ${q(EALocationAttrSelect.selectedOptionValue)}\n    ${choice ? `AND attr->>'value' = ${q(choice)}` : ''}\n)`);
		}

		/* ---- per-view narrowing ---- */

		if (view === 'Bill Health') {
			/* Account status is the only Bill Health selector pushed into SQL. Vendor and
			   utility stay client-side (EA_BillHealth) so their option lists keep showing
			   every value in the account, not just the ones surviving the current filter. */
			const acct = (typeof EAAcctStatusSelect !== 'undefined') ? this._multiVals(EAAcctStatusSelect) : [];
			if (acct.length) c.push(`AND m.account_status IN (${acct.map(q).join(',')})`);
		}

		return c.join('\n');
	},

	/* Month bound for the two queries that carry their own SQL rather than going through
	   analyticsWhere(): the utility tree and the demand/load-factor pull.

	   Both were copied from the Analytics page, where the only date filter is an explicit
	   month list — so with no months picked they fetched the customer's ENTIRE history.
	   The demand query joins bill items and calculations, which is the heaviest path on
	   the page, and it blew past Appsmith's 5 MB response cap. These emit the same rolling
	   window analyticsWhere() falls back to, so every screen covers the same period.

	   Two zero-argument variants rather than one taking a column name, because the two
	   queries date off different expressions. */
	_monthsPicked() {
		try {
			return (typeof EADateSelect !== 'undefined' && Array.isArray(EADateSelect.selectedOptionValues))
				? EADateSelect.selectedOptionValues.filter(d => d.includes('-')) : [];
		} catch (e) { return []; }
	},

	_boundOn(col) {
		const q = s => `'${String(s).replace(/'/g, "''")}'`;
		const picked = this._monthsPicked();
		if (picked.length) return `AND ${col} IN (${picked.map(q).join(',')})`;
		return `AND ${col} >= '${this._rollingCutoff()}'`;
	},

	/* m.time_period, on the utility tree. */
	treeMonthSql() { return this._boundOn('m.time_period'); },

	/* The statement month, on the demand and load-factor pull. */
	demandMonthSql() { return this._boundOn("date_trunc('month', br.statement_date)::date"); },

	/* First day of the month that starts the rolling window described by the Date widgets.
	   Defaults to 13 months, the window the Bill Health coverage matrix renders. */
	_rollingCutoff() {
		let n = 13;
		try {
			const pn = (typeof EADateNumInput !== 'undefined') ? parseInt(EADateNumInput.text, 10) : NaN;
			if (pn) n = pn;
			if (typeof EADateUnitSelect !== 'undefined' && /Year/.test(EADateUnitSelect.selectedOptionValue || '')) n = n * 12;
		} catch (e) { n = 13; }
		n = Math.max(1, Math.min(60, n));

		const now = new Date();
		let y = now.getFullYear();
		let mo = now.getMonth() - (n - 1);
		while (mo < 0) { mo += 12; y -= 1; }
		return `${y}-${String(mo + 1).padStart(2, '0')}-01`;
	}
}
