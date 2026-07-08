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
				BHLocationSelect: typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null,
				/* WOSeveritySelect is intentionally NOT here: it is read directly by warnSeveritySql()
				   and its onOptionChange runs fetch_warnings. Referencing it from a generic data
				   helper (which also reads fetch_warnings.data) trips Appsmith's reactive-misuse check. */
				WOWarningSelect: typeof WOWarningSelect !== 'undefined' ? WOWarningSelect : null,
				WOResolvedSelect: typeof WOResolvedSelect !== 'undefined' ? WOResolvedSelect : null,
				WOUtilitySelect: typeof WOUtilitySelect !== 'undefined' ? WOUtilitySelect : null,
				WOLocationSelect: typeof WOLocationSelect !== 'undefined' ? WOLocationSelect : null
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

		/* Page filters applied JS-side (the query returns all chats, customer-scoped):
		   Account Status / Utility / Location (shared BHSetBox multi-selects) + Last Chat Date year. */
		const multi = (w) => { try { const v = w && w.selectedOptionValues; return Array.isArray(v) ? v : []; } catch (e) { return []; } };
		const acct = multi(typeof BHAcctStatusSelect !== 'undefined' ? BHAcctStatusSelect : null);
		const util = multi(typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null);
		const loc = multi(typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null);
		let year = ''; try { year = (typeof NTChatYearSelect !== 'undefined' && NTChatYearSelect.selectedOptionValue) || ''; } catch (e) { }
		const inSet = (sel, agg) => { if (!sel.length) return true; const set = String(agg || '').split(', '); return sel.some(s => set.indexOf(s) !== -1); };

		const filtered = data.filter(r => {
			if (!inSet(acct, r.statuses_all)) return false;
			if (!inSet(util, r.utilities_all)) return false;
			if (!inSet(loc, r.locations_all)) return false;
			if (year && year !== 'All' && String(r.last_chat_date || '').slice(-4) !== String(year)) return false;
			return true;
		});

		return filtered.map(r => {
			// "Last Chat Tags" = the @mention at the start of the latest message (heuristic).
			const text = r.last_chat_text || '';
			const m = text.match(/@[^,\n]+/);
			return {
				location: r.location || '',
				billId: r.bill_id || '',
				workflow: r.workflow_state || '',
				markedDate: r.marked_for_payment || '',
				chatDate: r.last_chat_date || '',
				chatUser: r.last_chat_user || '',
				chatTags: m ? m[0].trim() : '',
				chatHistory: r.chat_history || ''
			};
		});
	},

	/* ── Warnings Overview tab ───────────────── */

	/* Normalise bill_warning_severity to a display label. The DB uses numeric codes
	   (10/20 = Low, 30 = Medium, 40/60 = High); also tolerate text/legacy 1-3 codes. */
	_warnSeverity(raw) {
		const s = String(raw == null ? '' : raw).trim();
		if (!s) return '';
		const n = parseInt(s, 10);
		if (!isNaN(n) && String(n) === s) {
			if (n >= 40 || n === 3) return 'High';
			if (n === 30 || n === 2) return 'Medium';
			if (n <= 20 || n === 1) return 'Low';
		}
		const low = s.toLowerCase();
		if (low === 'high') return 'High';
		if (low === 'medium' || low === 'med') return 'Medium';
		if (low === 'low') return 'Low';
		return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
	},

	/* Map a severity display label to its bill_warning_severity bucket (used by warnSeveritySql). */
	_warnSeverityClause(label) {
		if (label === 'Low') return 'w.bill_warning_severity <= 20';
		if (label === 'Medium') return 'w.bill_warning_severity = 30';
		if (label === 'High') return 'w.bill_warning_severity >= 40';
		return '';
	},

	/* Server-side severity filter for fetch_warnings. A bill is bucketed by its MAX warning
	   severity (Low ≤20 / Medium =30 / High ≥40) and we show that bill's top-severity warnings.
	   Reads the WOSeveritySelect slicer; defaults to Medium (the UBM "Medium" report view). */
	warnSeveritySql() {
		/* Read WOSeveritySelect DIRECTLY (not via _multi) — _multi references every other slicer
		   widget, several of which source their options from fetch_warnings.data, which would make
		   this query depend on itself (cyclic dependency). */
		let sel = [];
		try {
			if (typeof WOSeveritySelect !== 'undefined' && Array.isArray(WOSeveritySelect.selectedOptionValues)) {
				sel = WOSeveritySelect.selectedOptionValues;
			}
		} catch (e) { sel = []; }
		const labels = sel.length ? sel : ['Medium'];
		const parts = labels.map(l => this._warnSeverityClause(l)).filter(Boolean);
		if (!parts.length) return '';
		return 'AND (' + parts.join(' OR ') + ')';
	},

	/* Classify a warning message into the same buckets the UBM report uses for the "Warning" slicer. */
	_warnCategory(msg) {
		const m = String(msg || '');
		if (/unit cost/i.test(m) && /higher than/i.test(m)) return 'Unit cost > 10% higher than prior bill';
		if (/charge/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Charges are out of range (warning)';
		if (/(consumption|volume)/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Volume is out of range (warning)';
		return 'Other';
	},

	/* Utility type for a warning — prefer the commodity embedded in the message "[acct / meter / COMMODITY]",
	   fall back to the joined bill_items.commodity. */
	_warnUtility(msg, fallback) {
		const m = String(msg || '').match(/\[([^\]]+)\]/);
		if (m) {
			const parts = m[1].split('/').map(s => s.trim());
			const last = (parts[parts.length - 1] || '').toUpperCase();
			if (/^(NATURALGAS|NATURAL GAS|GAS|ELECTRIC|ELECTRICITY|WATER|SEWER|STEAM|SOLAR)$/.test(last)) return last;
		}
		return String(fallback || '').toUpperCase();
	},

	_parseDate(v) {
		if (!v) return null;
		const d = new Date(v);
		return isNaN(d.getTime()) ? null : d;
	},

	/* The Invoice Date relative window from WODateModeSelect / WODateNumInput / WODateUnitSelect.
	   Returns {start,end} or null when no usable filter is set. Mirrors the UBM "Last 6 Months" slicer. */
	_warnDateWindow() {
		try {
			if (typeof WODateNumInput === 'undefined' || typeof WODateUnitSelect === 'undefined') return null;
			const mode = (typeof WODateModeSelect !== 'undefined' && WODateModeSelect.selectedOptionValue) || 'Last';
			const n = parseInt(WODateNumInput.text, 10);
			const unit = WODateUnitSelect.selectedOptionValue || 'Months';
			if (!n || unit === 'Select') return null;
			const now = new Date();
			const start = new Date(now);
			const end = new Date(now);
			const shift = (d, sign) => {
				if (unit === 'Days') d.setDate(d.getDate() + sign * n);
				else if (unit === 'Weeks') d.setDate(d.getDate() + sign * 7 * n);
				else if (unit === 'Years') d.setFullYear(d.getFullYear() + sign * n);
				else d.setMonth(d.getMonth() + sign * n);
			};
			if (mode === 'Next') { shift(end, 1); }
			else if (mode === 'This') {
				start.setDate(1);
				end.setMonth(end.getMonth() + 1, 0);
			} else { shift(start, -1); } /* Last */
			start.setHours(0, 0, 0, 0);
			end.setHours(23, 59, 59, 999);
			return { start, end };
		} catch (e) { return null; }
	},

	/* Server-side date filter for fetch_warnings — pushes the Invoice Date slicer into the WHERE
	   clause (DB-backed report, so we never post-filter dates in JS). Returns "" when unset. */
	warnDateSql() {
		const win = this._warnDateWindow();
		if (!win) return '';
		const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
		return "AND w.invoice_date >= '" + fmt(win.start) + "' AND w.invoice_date <= '" + fmt(win.end) + "'";
	},

	/* Resolved (Yes/No) — from the definition view's `resolvable` column (yes/no), with a
	   workflow_state-style fallback. */
	_warnResolved(resolvable) {
		const w = String(resolvable == null ? '' : resolvable).toLowerCase().trim();
		if (w === 'yes' || w === 'true' || w === 'y' || w === '1') return 'Yes';
		if (w === 'no' || w === 'false' || w === 'n' || w === '0') return 'No';
		if (/resolv|clos|done|complete|paid|approved/.test(w)) return 'Yes';
		return 'No';
	},

	/* All warnings mapped to display rows, before slicer filtering.
	   Source: bill_management_v2.bill_warnings + bill_warning_definitions_view (see fetch_warnings). */
	_warnBase() {
		const data = (typeof fetch_warnings !== 'undefined' && Array.isArray(fetch_warnings.data)) ? fetch_warnings.data : [];
		return data.map(r => {
			const msg = r.bill_warning || '';
			return {
				totalAmount: r.total_amount,
				invoiceDate: r.invoice_date || '',
				invoiceDateRaw: r.invoice_date_raw || '',
				warning: msg,
				category: this._warnCategory(msg),
				pearId: r.pear_id || '',
				location: r.location || r.billing_id || '',
				vendor: r.vendor || '',
				utility: this._warnUtility(msg, r.utility_type),
				severity: this._warnSeverity(r.severity),
				resolved: this._warnResolved(r.resolvable),
				lat: parseFloat(r.latitude),
				lng: parseFloat(r.longitude)
			};
		});
	},

	/* Rows for the Warnings table after applying the slicer bar. Consumed by WarningsTable.defaultModel. */
	getWarningRows() {
		let rows = this._warnBase();

		/* Severity is filtered server-side (warnSeveritySql in fetch_warnings) — fetch_warnings.data
		   already holds only the selected bucket, so no JS severity re-filter is needed here. */

		const cat = this._multi('WOWarningSelect');
		if (cat.length) rows = rows.filter(r => cat.includes(r.category));

		const res = this._multi('WOResolvedSelect');
		if (res.length) rows = rows.filter(r => res.includes(r.resolved));

		const util = this._multi('WOUtilitySelect');
		if (util.length) rows = rows.filter(r => util.includes(r.utility));

		const loc = this._multi('WOLocationSelect');
		if (loc.length) rows = rows.filter(r => loc.includes(r.location));

		/* Invoice Date is filtered server-side via warnDateSql() in fetch_warnings — not here. */

		const rank = { High: 3, Medium: 2, Low: 1 };
		rows.sort((a, b) => {
			const sr = (rank[b.severity] || 0) - (rank[a.severity] || 0);
			if (sr) return sr;
			const da = this._parseDate(a.invoiceDateRaw), db = this._parseDate(b.invoiceDateRaw);
			return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
		});
		return rows;
	},

	/* ── Warnings slicer option providers ────── */

	getWarnSeverityOptions() {
		/* Fixed High/Medium/Low — the slicer drives the server-side bucket filter
		   (warnSeveritySql), so options can't be derived from the already-filtered rows. */
		return [
			{ label: 'High', value: 'High' },
			{ label: 'Medium', value: 'Medium' },
			{ label: 'Low', value: 'Low' }
		];
	},

	getWarnCategoryOptions() {
		/* Fixed analytical warning categories — matches the UBM "Warning" slicer. */
		return [
			{ label: 'Charges are out of range (warning)', value: 'Charges are out of range (warning)' },
			{ label: 'Unit cost > 10% higher than prior bill', value: 'Unit cost > 10% higher than prior bill' },
			{ label: 'Volume is out of range (warning)', value: 'Volume is out of range (warning)' }
		];
	},

	getWarnResolvedOptions() {
		const vals = [...new Set(this._warnBase().map(r => r.resolved).filter(Boolean))].sort();
		return vals.map(v => ({ label: v, value: v }));
	},

	getWarnUtilityOptions() {
		/* Full utility-type domain (matches the UBM "Utility Type" slicer), not just present types. */
		return ['ELECTRIC', 'INTERNET', 'LIGHTING', 'NATURALGAS', 'OIL2', 'PROPANE', 'SEWER', 'SOLARPV', 'STEAM', 'STORMWATER', 'TELEPHONE', 'WATER']
			.map(v => ({ label: v, value: v }));
	},

	getWarnLocationOptions() {
		const vals = [...new Set(this._warnBase().map(r => r.location).filter(Boolean))].sort();
		return vals.map(v => ({ label: v, value: v }));
	},

	/* Bubble-map points for WOMap — one per impacted location, sized by the largest bill impacted.
	   Honours the slicer bar (reads getWarningRows). */
	getWarningMapMarkers() {
		const rows = this.getWarningRows();
		const byLoc = {};
		rows.forEach(r => {
			if (isNaN(r.lat) || isNaN(r.lng) || (!r.lat && !r.lng)) return;
			const key = r.lat + ',' + r.lng;
			if (!byLoc[key]) byLoc[key] = { lat: r.lat, lng: r.lng, location: r.location, maxBill: 0, count: 0 };
			const amt = Number(r.totalAmount) || 0;
			if (amt > byLoc[key].maxBill) byLoc[key].maxBill = amt;
			byLoc[key].count += 1;
		});
		return Object.keys(byLoc).map(k => byLoc[k]);
	},

	/* ── Warnings over Time tab ──────────────── */

	/* "YYYY-MM" → "YYYY Month" (matches the UBM chart axis, e.g. "2025 December"). */
	_warnMonthLabel(mk) {
		const names = ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
		const mi = parseInt(mk.slice(5, 7), 10) - 1;
		return mk.slice(0, 4) + ' ' + (names[mi] || '');
	},

	/* Aggregate the slicer-filtered warnings (getWarningRows) by invoice month × warning category.
	   Returns { 'YYYY-MM': { category: { amount, count } } }. */
	_warnOverTime() {
		const rows = this.getWarningRows();
		const out = {};
		const seen = {};
		rows.forEach(r => {
			/* getWarningRows fans a warning out per utility (SEWER+WATER) for the table; collapse
			   those back to one warning here so the charts don't double-count amounts/counts. */
			const dk = (r.pearId || '') + '||' + (r.warning || '');
			if (seen[dk]) return;
			seen[dk] = true;
			const d = this._parseDate(r.invoiceDateRaw);
			if (!d) return;
			const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
			const cat = this._warnCategory(r.warning);
			if (!out[mk]) out[mk] = {};
			if (!out[mk][cat]) out[mk][cat] = { amount: 0, count: 0 };
			out[mk][cat].amount += Number(r.totalAmount) || 0;
			out[mk][cat].count += 1;
		});
		return out;
	},

	/* Best-effort "Auto-Generated Insights" narrative (mirrors the UBM/Power-BI smart-narrative
	   structure; the exact figures are computed from our data, so wording matches but numbers
	   may differ from Power BI's algorithm). */
	_warnInsight(metric) {
		const data = this._warnOverTime();
		const keys = Object.keys(data).sort();
		if (keys.length < 2) return '';
		const cats = ['Charges are out of range (warning)', 'Unit cost > 10% higher than prior bill', 'Volume is out of range (warning)'];
		const v = (mk, c) => { const x = data[mk] && data[mk][c]; return x ? (metric === 'amount' ? x.amount : x.count) : 0; };
		const first = keys[0], last = keys[keys.length - 1], span = keys.length - 1;
		const num = (x) => metric === 'amount'
			? Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
			: String(Math.round(x));
		let incCat = cats[0], incPct = -Infinity, decCat = cats[0], decPct = Infinity;
		cats.forEach(c => {
			const a = v(first, c), b = v(last, c);
			const pct = a > 0 ? (b - a) / a * 100 : (b > 0 ? 100 : 0);
			if (pct > incPct) { incPct = pct; incCat = c; }
			if (pct < decPct) { decPct = pct; decCat = c; }
		});
		const a = v(first, incCat), b = v(last, incCat), delta = b - a;
		const risePct = a > 0 ? (delta / a * 100) : 0;
		const label = metric === 'amount' ? 'Total Amount' : 'Count of Warnings';
		let s = '';
		if (metric === 'count') {
			s += 'Between ' + this._warnMonthLabel(first) + ' and ' + this._warnMonthLabel(last) + ', ' + incCat
				+ ' had the largest increase in Count of Warnings (' + incPct.toFixed(2) + '%) while ' + decCat
				+ ' had the largest decrease (' + Math.abs(decPct).toFixed(2) + '%).\n\n';
		}
		s += label + ' for ' + incCat + ' started trending up on ' + this._warnMonthLabel(first)
			+ ', rising by ' + risePct.toFixed(2) + '% (' + num(delta) + ') in ' + span + ' months.';
		return s;
	},

	/* Shared stacked-bar ECharts option for the two Warnings-over-Time charts.
	   metric = 'amount' (Bills Impacted $) or 'count' (Warning Count). Built as plain data
	   (no function expressions / nulls) per the CUSTOM_ECHART constraints. Layout mirrors the
	   UBM tab: bars on the left, vertical legend in the middle, insights text on the right. */
	_warnOverTimeConfig(metric, title) {
		const data = this._warnOverTime();
		const keys = Object.keys(data).sort();
		const labels = keys.map(k => this._warnMonthLabel(k));

		/* Known categories (fixed colours to match the UBM legend); any other category that
		   shows up (e.g. for High/Low buckets) is appended so the chart never hides data. */
		const known = [
			{ name: 'Charges are out of range (warning)', color: '#33A8F4' },
			{ name: 'Unit cost > 10% higher than prior bill', color: '#1F4E96' },
			{ name: 'Volume is out of range (warning)', color: '#8BC53F' }
		];
		const present = {};
		keys.forEach(k => Object.keys(data[k]).forEach(c => { present[c] = true; }));
		const cats = known.filter(c => present[c.name]);
		const extra = ['#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#64748B'];
		let ei = 0;
		Object.keys(present).sort().forEach(name => {
			if (!known.some(c => c.name === name)) cats.push({ name: name, color: extra[ei++ % extra.length] });
		});
		if (!cats.length) known.forEach(c => cats.push(c));

		const series = cats.map(c => ({
			name: c.name,
			type: 'bar',
			stack: 'total',
			emphasis: { focus: 'series' },
			itemStyle: { color: c.color },
			data: keys.map(k => {
				const cell = (data[k] && data[k][c.name]) || { amount: 0, count: 0 };
				return metric === 'amount' ? Number(cell.amount.toFixed(2)) : cell.count;
			})
		}));

		const insight = this._warnInsight(metric);

		return {
			backgroundColor: '#1E293B',
			title: [
				{ text: title, left: 8, top: 6, textStyle: { color: '#F1F5F9', fontSize: 15, fontWeight: 600 } },
				{ text: 'Warning', left: '46%', top: 34, textStyle: { color: '#E2E8F0', fontSize: 13, fontWeight: 600 } },
				{ text: 'Auto-Generated Insights', right: '2%', top: 6, textAlign: 'right', textStyle: { color: '#E2E8F0', fontSize: 14, fontWeight: 600 } },
				{ text: insight, right: '2%', top: 36, textAlign: 'left', textStyle: { color: '#94A3B8', fontSize: 12, fontWeight: 'normal', lineHeight: 18, width: 360, overflow: 'break' } }
			],
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			legend: { orient: 'vertical', left: '46%', top: 58, itemGap: 14, icon: 'circle', textStyle: { color: '#E2E8F0' }, data: cats.map(c => c.name) },
			grid: { left: 56, right: '62%', top: 44, bottom: 36, containLabel: false },
			xAxis: { type: 'category', data: labels, axisLabel: { color: '#94A3B8' }, axisLine: { lineStyle: { color: '#475569' } } },
			yAxis: { type: 'value', axisLabel: { color: '#94A3B8' }, splitLine: { lineStyle: { color: '#334155' } } },
			series: series
		};
	},

	getWarnImpactChartConfig() { return this._warnOverTimeConfig('amount', 'Bills Impacted ($)'); },

	getWarnCountChartConfig() { return this._warnOverTimeConfig('count', 'Warning Count'); },

	/* Note: the "Show as a Table" / Export data for these charts lives in the separate
	   BH_WarnTableHelper JSObject — keeping it out of BH_BillHealthHelper avoids a reactive-dependency
	   misuse (BH_BillHealthHelper reads both fetch_warnings.data and, via the SQL builders, the
	   slicer widgets that run fetch_warnings). */

	/* ── Impacted Locations tab ──────────────── */

	/* ISO date → "DD/MM/YYYY" (matches the UBM Impacted-Locations legend). */
	_ddmmyyyy(raw) {
		const d = this._parseDate(raw);
		if (!d) return '';
		return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
	},

	/* Horizontal bar: Total Amount per location, stacked/coloured by invoice date. One amount per
	   bill (dedupe by pear_id) so utility fan-out / multi-warning bills aren't double-counted.
	   Locations sorted so the highest total sits on top. */
	getImpactedLocationsConfig() {
		const rows = this.getWarningRows();
		const seen = {};
		const byLoc = {};
		const dateRaw = {};
		rows.forEach(r => {
			if (seen[r.pearId]) return;
			seen[r.pearId] = true;
			const loc = r.location || '(no location)';
			const dlabel = this._ddmmyyyy(r.invoiceDateRaw);
			const amt = Number(r.totalAmount) || 0;
			if (!byLoc[loc]) byLoc[loc] = { total: 0, byDate: {} };
			byLoc[loc].total += amt;
			byLoc[loc].byDate[dlabel] = (byLoc[loc].byDate[dlabel] || 0) + amt;
			if (!(dlabel in dateRaw)) dateRaw[dlabel] = r.invoiceDateRaw;
		});
		const locs = Object.keys(byLoc).sort((a, b) => byLoc[a].total - byLoc[b].total);
		const dates = Object.keys(dateRaw).sort((a, b) => (this._parseDate(dateRaw[b]) || 0) - (this._parseDate(dateRaw[a]) || 0));
		const palette = ['#33A8F4', '#1F4E96', '#8BC53F', '#0E7C66', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6'];
		const series = dates.map((d, i) => ({
			name: d,
			type: 'bar',
			stack: 'total',
			itemStyle: { color: palette[i % palette.length] },
			data: locs.map(l => Number((byLoc[l].byDate[d] || 0).toFixed(2)))
		}));
		return {
			backgroundColor: '#1E293B',
			title: { text: 'Impacted Locations', left: 8, top: 8, textStyle: { color: '#F1F5F9', fontSize: 15, fontWeight: 600 } },
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			legend: { data: dates, top: 40, right: 8, textStyle: { color: '#E2E8F0' } },
			grid: { left: 84, right: 24, top: 66, bottom: 44, containLabel: false },
			xAxis: { type: 'value', name: 'Total Amount', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: '#94A3B8' }, axisLabel: { color: '#94A3B8' }, splitLine: { lineStyle: { color: '#334155' } } },
			yAxis: { type: 'category', data: locs, axisLabel: { color: '#94A3B8' } },
			series: series
		};
	},

	/* Impacted-locations "Show as a Table" / Export rows (one amount per bill, by location). */
	getImpactedLocationsTable() {
		const rows = this.getWarningRows();
		const seen = {};
		const byLoc = {};
		rows.forEach(r => {
			if (seen[r.pearId]) return;
			seen[r.pearId] = true;
			const loc = r.location || '(no location)';
			byLoc[loc] = (byLoc[loc] || 0) + (Number(r.totalAmount) || 0);
		});
		return Object.keys(byLoc).sort((a, b) => byLoc[b] - byLoc[a])
			.map(l => ({ 'Location': l, 'Total Amount': byLoc[l].toFixed(2) }));
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
