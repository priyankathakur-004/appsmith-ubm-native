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
