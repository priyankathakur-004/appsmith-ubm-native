export default {

	/* ── helpers ─────────────────────────────── */

	_monthKey(tp) {
		// time_period comes back as "2025-10-01T00:00:00.000Z" or "2025-10-01"
		return String(tp || '').slice(0, 7); // "YYYY-MM"
	},

	/* read a SELECT value, treating "All"/empty as "no filter" (guarded for import order) */
	_sel(name) {
		try {
			const w = this._widget(name);
			const v = w && w.selectedOptionValue;
			return (v && v !== 'All') ? v : null;
		} catch (e) { return null; }
	},

	_widget(name) {
		// the Date filter inputs may not exist on first import; resolve safely
		const reg = {
			BHVendorSelect: typeof BHVendorSelect !== 'undefined' ? BHVendorSelect : null,
			BHUtilitySelect: typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null,
			BHLocationSelect: typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null,
			BHPctSelect: typeof BHPctSelect !== 'undefined' ? BHPctSelect : null
		};
		return reg[name];
	},

	/* Trailing window of N months ending at the current calendar month, newest first.
	   N comes from the Date filter (BHDateNumInput), default 12. */
	getMonthAxis() {
		let n = 12;
		try {
			if (typeof BHDateNumInput !== 'undefined') {
				const parsed = parseInt(BHDateNumInput.text, 10);
				if (parsed) n = parsed;
			}
			if (typeof BHDateUnitSelect !== 'undefined' && BHDateUnitSelect.selectedOptionValue === 'Years') {
				n = n * 12;
			}
		} catch (e) { /* keep default */ }
		n = Math.max(1, Math.min(60, n));

		const now = new Date();
		let y = now.getFullYear();
		let m = now.getMonth(); // 0-11
		const axis = [];
		for (let i = 0; i < n; i++) {
			axis.push(y + '-' + String(m + 1).padStart(2, '0'));
			m--;
			if (m < 0) { m = 11; y--; }
		}
		return axis;
	},

	/* One row per location / account / meter / utility / bill type, with the set of covered months.
	   Consumed by the IPHeatmapTable custom widget via its defaultModel. */
	getRows() {
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

		const axis = this.getMonthAxis();
		let rows = Object.keys(map).sort().map(k => map[k]);
		rows.forEach(r => {
			const cov = axis.filter(ym => r.months[ym]).length;
			r.pct = axis.length ? (cov / axis.length * 100) : 0;
		});

		/* client-side filters from the Bill Health filter bar */
		const vend = this._sel('BHVendorSelect');
		if (vend) rows = rows.filter(r => r.vendor === vend);
		const util = this._sel('BHUtilitySelect');
		if (util) rows = rows.filter(r => r.utility === util);
		const loc = this._sel('BHLocationSelect');
		if (loc) rows = rows.filter(r => r.location === loc);
		const pctSel = this._sel('BHPctSelect');
		if (pctSel) {
			rows = rows.filter(r => {
				const p = r.pct;
				if (pctSel === '0') return p === 0;
				if (pctSel === '1-50') return p > 0 && p <= 50;
				if (pctSel === '51-99') return p > 50 && p < 100;
				if (pctSel === '100') return p >= 100;
				return true;
			});
		}

		return rows;
	},

	/* ── legend (small enough for a Text widget) ── */

	getLegendHtml() {
		const sw = (color) => '<span style="display:inline-block;width:26px;height:15px;border-radius:3px;background:' + color + ';vertical-align:middle; margin-left:2px"></span>';
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
