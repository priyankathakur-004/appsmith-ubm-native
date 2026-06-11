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

	/* the 12 completed months ending LAST month (current month excluded) for the %Last12Mo metric.
	   Matches the UBM app: e.g. in Jun 2026 the window is Jun 2025 … May 2026. */
	_last12() {
		return this._window(13).slice(1);
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
					months: {},
					monthDays: {}
				};
			}
			const mk = this._monthKey(r.time_period);
			if (mk.length === 7) {
				map[key].months[mk] = (map[key].months[mk] || 0) + 1;
				// real billed days for the month (from analytics_monthly_feed.days_of_service)
				map[key].monthDays[mk] = Math.max(map[key].monthDays[mk] || 0, Number(r.days_of_service) || 0);
			}
		});

		// Merge the full account/meter roster (all-time, lightweight) so combos with no bills in
		// the current window still appear — with their Account / Meter / Utility / Bill Type filled in.
		const roster = (typeof fetch_bill_accounts !== 'undefined' && Array.isArray(fetch_bill_accounts.data)) ? fetch_bill_accounts.data : [];
		roster.forEach(r => {
			const key = [r.location_description, r.service_account, r.meter, r.utility_type, r.bill_type].join('||');
			if (!map[key]) {
				map[key] = {
					location: r.location_description || '',
					account: r.service_account || '',
					meter: r.meter || '',
					utility: r.utility_type || '',
					billType: r.bill_type || '',
					vendor: r.vendor_name || '',
					months: {},
					monthDays: {}
				};
			}
		});

		// %Last12Mo = actual billed service days in the last 12 months / 365 (matches the UBM app).
		// days come from analytics_monthly_feed.days_of_service (real bill service period, may be < a full month).
		const last12 = this._last12();
		const rows = Object.keys(map).sort().map(k => map[k]);
		rows.forEach(r => {
			let days = 0;
			last12.forEach(ym => { days += (r.monthDays[ym] || 0); });
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

		const acct = this._multi('BHAcctStatusSelect');

		// Show every location for the customer (from fetch_locations), even those with no bill
		// data — as empty 0%/all-red rows. Only when no value-filter is narrowing the set;
		// the Location filter is still honoured.
		if (!vend.length && !util.length && !pct.length && !acct.length) {
			const present = {};
			rows.forEach(r => { present[r.location] = true; });
			const locs = (typeof fetch_locations !== 'undefined' && Array.isArray(fetch_locations.data)) ? fetch_locations.data : [];
			locs.forEach(l => {
				const name = l && l.name;
				if (!name || present[name]) return;
				if (loc.length && !loc.includes(name)) return;
				rows.push({ location: name, account: '', meter: '', utility: '', billType: '', vendor: '', months: {}, pct: 0 });
				present[name] = true;
			});
			rows.sort((a, b) => (a.location + '|' + a.account + '|' + a.meter).localeCompare(b.location + '|' + b.account + '|' + b.meter));
		}

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

	/* One row per Location / Billing ID (account) / Vendor. For each month, coverage is based on the
	   bill's actual service days (analytics_monthly_feed.days_of_service) vs the days in that month:
	     full    = days_of_service >= days-in-month   (no missing invoice)
	     partial = 0 < days_of_service < days-in-month (rendered "Mon*")
	     none    = no bill that month                  (rendered "Mon" — fully missing)
	   The MissingInvoiceTable widget then lists only partial + missing months. */
	getMissingInvoiceRows() {
		const data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		const groups = {};
		const ensure = (loc, acct, vend) => {
			const gkey = [loc, acct, vend].join('||');
			if (!groups[gkey]) groups[gkey] = { location: loc, billingId: acct, vendor: vend, maxDays: {} };
			return groups[gkey];
		};

		data.forEach(r => {
			const g = ensure(r.location_description || '', r.service_account || '', r.vendor_name || '');
			const mk = this._monthKey(r.time_period);
			if (mk.length === 7) {
				const d = Number(r.days_of_service) || 0;
				g.maxDays[mk] = Math.max(g.maxDays[mk] || 0, d);
			}
		});

		// include accounts with no bills in the window (from the roster) so they show as fully missing
		const roster = (typeof fetch_bill_accounts !== 'undefined' && Array.isArray(fetch_bill_accounts.data)) ? fetch_bill_accounts.data : [];
		roster.forEach(r => ensure(r.location_description || '', r.service_account || '', r.vendor_name || ''));

		let rows = Object.keys(groups).sort().map(k => {
			const g = groups[k];
			const cover = {};
			Object.keys(g.maxDays).forEach(mk => {
				const dim = new Date(parseInt(mk.slice(0, 4), 10), parseInt(mk.slice(5, 7), 10), 0).getDate();
				const d = g.maxDays[mk];
				cover[mk] = d >= dim ? 'full' : (d > 0 ? 'partial' : 'none');
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

	/* ── Notifications tab ───────────────────── */

	/* Rows for the Notifications table (bill chat / workflow). Reads fetch_notifications once it
	   exists (guarded so the tab renders "No data" until the query is added). Adjust the field
	   mapping below to the query's actual column names. */
	getNotificationRows() {
		const data = (typeof fetch_notifications !== 'undefined' && Array.isArray(fetch_notifications.data)) ? fetch_notifications.data : [];
		return data.map(r => ({
			location: r.location || r.location_description || '',
			billId: r.bill_id || r.billId || '',
			workflow: r.workflow_state || r.workflow || '',
			markedDate: r.marked_for_payment || r.markedDate || '',
			chatDate: r.last_chat_date || r.chatDate || '',
			chatUser: r.last_chat_user || r.chatUser || '',
			chatTags: r.last_chat_tags || r.chatTags || '',
			chatHistory: r.chat_history || r.chatHistory || ''
		}));
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
