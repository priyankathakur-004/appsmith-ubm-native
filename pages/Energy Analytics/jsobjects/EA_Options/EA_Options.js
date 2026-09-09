export default {

	/* Option lists that must NOT read a query.

	   fetch_analytics_data's WHERE clause is built by EA_Filters, which reads the Date
	   widget. So anything feeding that widget's options has to be pure: sourcing the
	   month list from fetch_analytics_data.data closes the loop
	     fetch_analytics_data.body -> EA_Filters -> EADateSelect -> fetch_analytics_data.data
	   and Appsmith refuses the page with a cyclical dependency error.

	   This mirrors _FilterActions.getDates() on the Analytics page, which exists as its
	   own JSObject for exactly this reason. Keep this file free of query reads. */

	/* Months, newest first, as YYYY-MM-01 — the form m.time_period is compared against. */
	getDates() {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const thisYear = new Date().getFullYear();
		const out = [];
		for (let y = thisYear; y >= thisYear - 6; y--) {
			for (let m = 11; m >= 0; m--) {
				out.push({
					label: `${months[m]} ${y}`,
					value: `${y}-${String(m + 1).padStart(2, '0')}-01`
				});
			}
		}
		return out;
	}
}
