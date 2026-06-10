export default {

	/* ── helpers ─────────────────────────────── */

	_monthKey(tp) {
		// time_period comes back as "2025-10-01T00:00:00.000Z" or "2025-10-01"
		return String(tp || '').slice(0, 7); // "YYYY-MM"
	},

	/* a trailing window of n months ending at the current calendar month, newest first */
	_window(n) {
		const now = new Date();
		let y = now.getFullYear();
		let m = now.getMonth(); // 0-11
		const a = [];
		for (let i = 0; i < n; i++) {
			a.push(y + '-' + String(m + 1).padStart(2, '0'));
			m--;
			if (m < 0) { m = 11; y--; }
		}
		return a;
	},

	/* fixed 12-month window for the %Last12Mo metric (independent of the Date display filter) */
	_last12() {
		return this._window(12);
	},

	/* display columns — driven by the Date filter (BHDateNumInput / BHDateUnitSelect) */
	getMonthAxis() {
		let n = 13;
		try {
			if (typeof BHDateNumInput !== 'undefined') {
				const p = parseInt(BHDateNumInput.text, 10);
				if (p) n = p;
			}
			if (typeof BHDateUnitSelect !== 'undefined' && BHDateUnitSelect.selectedOptionValue === 'Years') {
				n = n * 12;
			}
		} catch (e) { /* keep default */ }
		n = Math.max(1, Math.min(60, n));
		return this._window(n);
	},

	/* read a multi-select's values as an array (guarded for import order) */
	_multi(name) {
		try {
			const reg = {
				BHVendorSelect: typeof BHVendorSelect !== 'undefined' ? BHVendorSelect : null,
				BHPctSelect: typeof BHPctSelect !== 'undefined' ? BHPctSelect : null,
				BHAcctStatusSelect: typeof BHAcctStatusSelect !== 'undefined' ? BHAcctStatusSelect : null
			};
			const w = reg[name];
			const v = w && w.selectedOptionValues;
			return Array.isArray(v) ? v : [];
		} catch (e) { return []; }
	},

	/* read a single-select value, treating "All"/empty as "no filter" */
	_single(name) {
		try {
			const reg = {
				BHUtilitySelect: typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null,
				BHLocationSelect: typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null
			};
			const w = reg[name];
			const v = w && w.selectedOptionValue;
			return (v && v !== 'All') ? v : null;
		} catch (e) { return null; }
	},

	/* ── data ────────────────────────────────── */

	/* One row per location / account / meter / utility / bill type, with covered months + %Last12Mo.
	   No filters applied (used to build filter option lists too). */
	_buildRows() {
		const data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		const map = {};
		data.forEach(r => {
			const key = [r.location_description, r.service_account, r.meter, r.utility_type, r.bill_type].join('||');
			if (!map[key]) {
				map[key] = {
					location: r.location_description || '',
					account: r.service_account || '',
					meter: r.meter || '',
					utility: r.utility_type || '',
					billType: r.bill_type || '',
					vendor: r.vendor_name || '',
					months: {}
				};
			}
			const mk = this._monthKey(r.time_period);
			if (mk.length === 7) {
				map[key].months[mk] = (map[key].months[mk] || 0) + 1;
			}
		});
		const last12 = this._last12();
		const rows = Object.keys(map).sort().map(k => map[k]);
		rows.forEach(r => {
			const cov = last12.filter(ym => r.months[ym]).length;
			r.pct = cov / 12 * 100;
		});
		return rows;
	},

	/* Rows after applying the Bill Health filter bar. Consumed by IPHeatmapTable's defaultModel. */
	getRows() {
		let rows = this._buildRows();

		const vend = this._multi('BHVendorSelect');
		if (vend.length) rows = rows.filter(r => vend.includes(r.vendor));

		const util = this._single('BHUtilitySelect');
		if (util) rows = rows.filter(r => r.utility === util);

		const loc = this._single('BHLocationSelect');
		if (loc) rows = rows.filter(r => r.location === loc);

		const pct = this._multi('BHPctSelect');
		if (pct.length) rows = rows.filter(r => pct.includes(r.pct.toFixed(2) + '%'));

		return rows;
	},

	/* ── filter option providers ─────────────── */

	getVendorOptions() {
		const data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		return [...new Set(data.map(d => d.vendor_name).filter(Boolean))]
			.sort()
			.map(v => ({ label: String(v), value: String(v) }));
	},

	/* distinct %Last12Mo values present in the data, highest first */
	getPctOptions() {
		const vals = [...new Set(this._buildRows().map(r => r.pct.toFixed(2) + '%'))];
		vals.sort((a, b) => parseFloat(b) - parseFloat(a));
		return vals.map(v => ({ label: v, value: v }));
	},

	/* ── legend (small enough for a Text widget) ── */

	getLegendHtml() {
		const sw = (color) => '<span style="display:inline-block;width:26px;height:15px;border-radius:3px;background:' + color + ';vertical-align:middle;margin-left:2px;"></span>';
		// small white "document" glyph for the invoice-received marker
		const invoice = '<span style="display:inline-block;width:20px;height:16px;border:1px solid #CBD5E1;border-radius:2px;background:repeating-linear-gradient(#ffffff,#ffffff 2px,#cbd5e1 3px,#ffffff 4px);vertical-align:middle;"></span>';
		// inline-block items flow left-to-right and wrap as a group (avoids flex justify gaps)
		const item = (inner, label) => '<span style="display:inline-block;white-space:nowrap;margin-right:36px;color:#E2E8F0;font-size:13px;vertical-align:middle;">' + inner + '<span style="vertical-align:middle;margin-left:8px;">' + label + '</span></span>';
		return '<div style="color:#E2E8F0;font-size:13px;line-height:32px;padding:4px 0;">'
			+ item(sw('#15803d'), 'denotes the service period is fully covered by at least 1 bill')
			+ item(sw('#86efac') + sw('#E76D5F'), 'denotes the service period is partially/not covered')
			+ item(invoice, 'denotes invoice received')
			+ '</div>';
	},

	/* Called from BillHealthTabs.onTabSelected — placeholder for per-tab defaults */
	setDefaults() {
		return;
	}
}
