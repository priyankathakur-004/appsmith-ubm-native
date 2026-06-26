export default {

	/* read a multi-select widget's values as an array (guarded) */
	_multiVals(w) {
		try {
			const v = w && w.selectedOptionValues;
			return Array.isArray(v) ? v : [];
		} catch (e) { return []; }
	},

	/* Report-scoped WHERE clause for fetch_analytics_data, so one report's filters never
	   leak into the other. Returns the AND conditions that follow the shared customer filter.

	   IMPORTANT: this JSObject must NOT read fetch_analytics_data.data — fetch_analytics_data
	   references this method, so reading the query back would create a cyclic dependency. */
	analyticsWhere() {
		const report = (typeof ReportSelect !== 'undefined' && ReportSelect.selectedOptionValue) || 'Main Analytics Report';
		const q = s => `'${String(s).replace(/'/g, "''")}'`;
		const c = [];

		if (report === 'Bill Health Report') {
			// Bound the data to the displayed window (Date filter: Last N months/years).
			// The heatmap only renders this window, so this is both correct and avoids fetching
			// years of history (which blows past Appsmith's 5 MB response limit).
			let n = 13;
			const pn = (typeof BHDateNumInput !== 'undefined') ? parseInt(BHDateNumInput.text, 10) : NaN;
			if (pn) n = pn;
			if (typeof BHDateUnitSelect !== 'undefined' && BHDateUnitSelect.selectedOptionValue === 'Years') n = n * 12;
			n = Math.max(1, Math.min(60, n));
			const now = new Date();
			let y = now.getFullYear();
			let mo = now.getMonth() - (n - 1); // 0-indexed month, n-1 months back
			while (mo < 0) { mo += 12; y -= 1; }
			const cutoff = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
			c.push(`AND m.time_period >= '${cutoff}'`);

			// Bill Health: only Account Status is SQL-side; Vendor/Utility/Location/%Last12Mo
			// are applied client-side in BillHealthHelper.getRows so their option lists stay complete.
			const acct = (typeof BHAcctStatusSelect !== 'undefined') ? this._multiVals(BHAcctStatusSelect) : [];
			if (acct.length) c.push(`AND m.account_status IN (${acct.map(q).join(',')})`);
		} else {
			// Main Analytics Report filters (ported verbatim from the original query)
			const dates = (typeof DateSelect !== 'undefined' && Array.isArray(DateSelect.selectedOptionValues))
				? DateSelect.selectedOptionValues.filter(d => d.includes('-')) : [];
			if (dates.length) c.push(`AND m.time_period IN (${dates.map(q).join(',')})`);

			if (typeof UtilityTypeSelect !== 'undefined' && UtilityTypeSelect.selectedOptionValue)
				c.push(`AND m.utility_type = ${q(UtilityTypeSelect.selectedOptionValue)}`);

			if (typeof BillTypeSelect !== 'undefined' && BillTypeSelect.selectedOptionValue)
				c.push(`AND m.bill_type = ${q(BillTypeSelect.selectedOptionValue)}`);

			if (typeof LocationSelect !== 'undefined' && LocationSelect.selectedOptionValue)
				c.push(`AND m.location_id = ${LocationSelect.selectedOptionValue}`);

			if (typeof LocationAttrSelect !== 'undefined' && LocationAttrSelect.selectedOptionValue && LocationAttrSelect.selectedOptionValue !== 'All') {
				const choice = (typeof AttrChoiceSelect !== 'undefined' && AttrChoiceSelect.selectedOptionValue && AttrChoiceSelect.selectedOptionValue !== 'All')
					? AttrChoiceSelect.selectedOptionValue : null;
				c.push(`AND EXISTS (\n    SELECT 1\n    FROM jsonb_array_elements(m.location_attributes->'custom_attributes') attr\n    WHERE attr->>'id' = ${q(LocationAttrSelect.selectedOptionValue)}\n    ${choice ? `AND attr->>'value' = ${q(choice)}` : ''}\n)`);
			}
		}
		return c.join('\n');
	}
}
