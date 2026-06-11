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
				BHAcctStatusSelect: typeof BHAcctStatusSelect !== 'undefined' ? BHAcctStatusSelect : null,
				BHUtilitySelect: typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null,
				BHLocationSelect: typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null
			};
			const w = reg[name];
			const v = w && w.selectedOptionValues;
			return Array.isArray(v) ? v : [];
		} catch (e) { return []; }
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
		// %Last12Mo = service days covered by bills in the last 12 months / 365 (matches the UBM app).
		// NOTE: the monthly feed has no per-bill service dates, so a covered month contributes its full
		// calendar days. This matches UBM for full-month bills; partial-month bills need service start/end.
		const last12 = this._last12();
		const rows = Object.keys(map).sort().map(k => map[k]);
		rows.forEach(r => {
			let days = 0;
			last12.forEach(ym => {
				if (r.months[ym]) {
					const y = parseInt(ym.slice(0, 4), 10);
					const mo = parseInt(ym.slice(5, 7), 10);
					days += new Date(y, mo, 0).getDate(); // days in that month
				}
			});
			r.pct = days / 365 * 100;
		});
		return rows;
	},

	/* Rows after applying the Bill Health filter bar. Consumed by IPHeatmapTable's defaultModel. */
	getRows() {
		let rows = this._buildRows();

		const vend = this._multi('BHVendorSelect');
		if (vend.length) rows = rows.filter(r => vend.includes(r.vendor));

		const util = this._multi('BHUtilitySelect');
		if (util.length) rows = rows.filter(r => util.includes(r.utility));

		const loc = this._multi('BHLocationSelect');
		if (loc.length) rows = rows.filter(r => loc.includes(r.location));

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

	/* ── Missing Invoice Data tab ────────────── */

	/* One row per Location / Billing ID (account) / Vendor. For each month, coverage across all
	   the account's meter+utility+billType combos: 'full' (all present), 'partial' (some), else absent.
	   Consumed by the MissingInvoiceTable custom widget. */
	getMissingInvoiceRows() {
		const data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		const groups = {};
		data.forEach(r => {
			const loc = r.location_description || '';
			const acct = r.service_account || '';
			const vend = r.vendor_name || '';
			const gkey = [loc, acct, vend].join('||');
			if (!groups[gkey]) {
				groups[gkey] = { location: loc, billingId: acct, vendor: vend, subkeys: {}, monthSub: {} };
			}
			const sub = [r.meter, r.utility_type, r.bill_type].join('|');
			groups[gkey].subkeys[sub] = true;
			const mk = this._monthKey(r.time_period);
			if (mk.length === 7) {
				if (!groups[gkey].monthSub[mk]) groups[gkey].monthSub[mk] = {};
				groups[gkey].monthSub[mk][sub] = true;
			}
		});

		let rows = Object.keys(groups).sort().map(k => {
			const g = groups[k];
			const total = Object.keys(g.subkeys).length || 1;
			const cover = {};
			Object.keys(g.monthSub).forEach(mk => {
				const c = Object.keys(g.monthSub[mk]).length;
				cover[mk] = c >= total ? 'full' : (c > 0 ? 'partial' : 'none');
			});
			return { location: g.location, billingId: g.billingId, vendor: g.vendor, cover: cover };
		});

		/* honour the shared filter bar where it maps to this grouping */
		const vend = this._multi('BHVendorSelect');
		if (vend.length) rows = rows.filter(r => vend.includes(r.vendor));
		const loc = this._multi('BHLocationSelect');
		if (loc.length) rows = rows.filter(r => loc.includes(r.location));

		return rows;
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
