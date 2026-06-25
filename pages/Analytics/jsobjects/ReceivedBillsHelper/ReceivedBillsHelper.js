export default {

	/* ── Received Bills Details ──────────────────────────────────────────────
	   Source: fetch_received_bills (reports_customer_monthly_usage — one row per
	   received bill). The matrix counts bills by Location > Utility > Meter >
	   Bill Type across invoice months; the chart counts bills by Utility per
	   month. The invoice-date window is applied in SQL (shared Bill-Health date
	   filter via LFDateHelper); the categorical Account Status / Utility /
	   Location filters are applied here so they react live.                    */

	/* Month palette shared with the rest of the app (Late Fees donut). */
	_utilColors() {
		return {
			NATURALGAS: '#6BA644', ELECTRIC: '#3E6FB5', WATER: '#3AAFA9', SEWER: '#8E6E53',
			LIGHTING: '#E0B93C', OIL2: '#C0584B', STEAM: '#9B6FB0', SOLARPV: '#1F9E89',
			PROPANE: '#E07B39', STORMWATER: '#5B9BD5', TELEPHONE: '#7F8C8D', INTERNET: '#B5495B',
			FIREPROTECTION: '#1F4E8C'
		};
	},

	_monthNames() { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; },

	/* Raw bills mapped to a stable shape. invoice_month is "YYYY-MM". */
	_rawBills() {
		const data = (typeof fetch_received_bills !== 'undefined' && Array.isArray(fetch_received_bills.data)) ? fetch_received_bills.data : [];
		return data.map(r => ({
			location: r.location || '(no location)',
			utility: (r.utility_type || '(none)'),
			meterId: r.meter_id || '(no meter)',
			billType: r.bill_type || '(no type)',
			accountStatus: r.account_status || '',
			vendor: r.vendor || '',
			month: r.invoice_month || ''
		})).filter(r => r.month);
	},

	/* Read a multi-select's values as an array (guarded for import order). */
	_multi(w) {
		try { const v = w && w.selectedOptionValues; return Array.isArray(v) ? v : []; }
		catch (e) { return []; }
	},

	/* Apply the shared Bill-Health categorical filters (Account Status / Utility / Location). */
	_applyFilters(rows) {
		const acct = this._multi(typeof BHAcctStatusSelect !== 'undefined' ? BHAcctStatusSelect : null);
		const util = this._multi(typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null);
		const loc = this._multi(typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null);
		return rows.filter(r => {
			if (acct.length && acct.indexOf(r.accountStatus) === -1) return false;
			if (util.length && util.indexOf(r.utility) === -1) return false;
			if (loc.length && loc.indexOf(r.location) === -1) return false;
			return true;
		});
	},

	_allBills() { return this._applyFilters(this._rawBills()); },

	/* "YYYY-MM" → "Mon YYYY" */
	_monthLabel(m) {
		const p = String(m).split('-');
		if (p.length < 2) return m;
		const idx = parseInt(p[1], 10) - 1;
		return (this._monthNames()[idx] || p[1]) + ' ' + p[0];
	},

	/* Distinct months present, sorted DESCending (newest first) — matrix columns. */
	getMonths() {
		const set = {};
		this._allBills().forEach(r => { set[r.month] = true; });
		return Object.keys(set).sort().reverse();
	},

	/* tree[location][utility][meter][billType][month] = count */
	_buildTree() {
		const tree = {};
		this._allBills().forEach(r => {
			const L = tree[r.location] || (tree[r.location] = {});
			const U = L[r.utility] || (L[r.utility] = {});
			const M = U[r.meterId] || (U[r.meterId] = {});
			const B = M[r.billType] || (M[r.billType] = {});
			B[r.month] = (B[r.month] || 0) + 1;
		});
		return tree;
	},

	/* ── Matrix: Bill Counts by Month of Invoice dates, Meter ID and Bill Types ── */
	getMatrixHtml() {
		const months = this.getMonths();
		if (!months.length) {
			return '<div style="padding:24px;color:#94A3B8;font-size:13px;">No received bills for the current filters.</div>';
		}
		const tree = this._buildTree();
		const mn = this._monthNames();

		/* Group invoice months into years (descending order preserved) for the two-row header. */
		const yearGroups = [];
		months.forEach(m => {
			const y = m.split('-')[0];
			let g = yearGroups[yearGroups.length - 1];
			if (!g || g.year !== y) { g = { year: y, months: [] }; yearGroups.push(g); }
			g.months.push(m);
		});

		/* Flat column model: each year's months, a per-year subtotal, then a grand total. */
		const cols = [];
		yearGroups.forEach(g => {
			g.months.forEach(m => cols.push({ kind: 'm', month: m }));
			cols.push({ kind: 'yt', months: g.months });
		});
		cols.push({ kind: 'gt' });

		/* Aggregate month -> count for any subtree (leaves carry numbers, groups carry children). */
		const aggOf = (node) => {
			const out = {};
			for (const k in node) {
				const v = node[k];
				if (typeof v === 'number') { out[k] = (out[k] || 0) + v; }
				else { const sub = aggOf(v); for (const mm in sub) out[mm] = (out[mm] || 0) + sub[mm]; }
			}
			return out;
		};
		const colVal = (agg, c) => {
			if (c.kind === 'm') return agg[c.month] || 0;
			if (c.kind === 'yt') return c.months.reduce((s, m) => s + (agg[m] || 0), 0);
			let s = 0; for (const m in agg) s += agg[m]; return s;
		};

		const th = 'padding:6px 9px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:center;white-space:nowrap;';
		const thL = 'padding:6px 12px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:left;white-space:nowrap;';
		const sep = 'border-left:1px solid #475569;';
		const tdBase = 'padding:5px 9px;font-size:12px;border-bottom:1px solid #2B3A4F;text-align:center;white-space:nowrap;';
		const lvlPad = [12, 28, 44, 60];
		const lvlColor = ['color:#F8FAFC;font-weight:700;', 'color:#CBD5E1;font-weight:600;', 'color:#E2E8F0;', 'color:#CBD5E1;'];
		const lvlBg = ['background:#243043;', '', '', 'background:#1B2738;'];
		const labelStyle = (lvl) => 'padding:5px 10px 5px ' + lvlPad[lvl] + 'px;font-size:12px;border-bottom:1px solid #2B3A4F;text-align:left;white-space:nowrap;' + lvlColor[lvl] + lvlBg[lvl];
		const cellStyle = (c, lvl) => tdBase + (lvl <= 1 ? 'color:#F1F5F9;font-weight:600;' : 'color:#E2E8F0;') + lvlBg[lvl] + (c.kind !== 'm' ? sep + 'font-weight:700;color:#F8FAFC;' : '');

		let h = '<div style="width:100%;max-height:840px;overflow:auto;"><table style="border-collapse:collapse;background:#1E293B;min-width:100%;">\n';
		/* header row 1: Service Year + year spans (each spans its months + its subtotal) + grand Total */
		h += '<tr style="background:#334155;"><th style="' + thL + '">Service Year</th>';
		yearGroups.forEach(g => { h += '<th style="' + th + sep + '" colspan="' + (g.months.length + 1) + '">' + g.year + '</th>'; });
		h += '<th style="' + th + sep + '" rowspan="2">Total</th></tr>\n';
		/* header row 2: Location + month abbreviations + per-year Total */
		h += '<tr style="background:#334155;"><th style="' + thL + '">Location</th>';
		yearGroups.forEach(g => {
			g.months.forEach(m => { const idx = parseInt(m.split('-')[1], 10) - 1; h += '<th style="' + th + '">' + (mn[idx] || m) + '</th>'; });
			h += '<th style="' + th + sep + '">Total</th>';
		});
		h += '</tr>\n';

		const sortK = (o) => Object.keys(o).sort();
		const renderRow = (label, lvl, agg) => {
			let r = '<tr><td style="' + labelStyle(lvl) + '">' + label + '</td>';
			cols.forEach(c => { const v = colVal(agg, c); r += '<td style="' + cellStyle(c, lvl) + '">' + (v ? v : '') + '</td>'; });
			return r + '</tr>\n';
		};

		/* Every level shows its rolled-up counts (Location > Utility > Meter > Bill Type). */
		sortK(tree).forEach(loc => {
			h += renderRow(loc, 0, aggOf(tree[loc]));
			const U = tree[loc];
			sortK(U).forEach(util => {
				h += renderRow(util, 1, aggOf(U[util]));
				const M = U[util];
				sortK(M).forEach(meter => {
					h += renderRow(meter, 2, aggOf(M[meter]));
					const B = M[meter];
					sortK(B).forEach(bt => { h += renderRow(bt, 3, B[bt]); });
				});
			});
		});
		/* Grand Total row. */
		h += renderRow('Total', 0, aggOf(tree)).replace('<tr>', '<tr style="background:#334155;border-top:2px solid #475569;">');
		h += '</table></div>';
		return h;
	},

	/* Flat matrix rows for "Show as a Table" / Export — one row per leaf, a column per month. */
	getMatrixTableData() {
		const months = this.getMonths();
		const tree = this._buildTree();
		const out = [];
		Object.keys(tree).sort().forEach(loc => {
			const U = tree[loc];
			Object.keys(U).sort().forEach(util => {
				const M = U[util];
				Object.keys(M).sort().forEach(meter => {
					const B = M[meter];
					Object.keys(B).sort().forEach(bt => {
						const row = { Location: loc, 'Utility Type': util, 'Meter ID': meter, 'Bill Type': bt };
						let total = 0;
						months.forEach(m => { const c = B[bt][m] || 0; row[this._monthLabel(m)] = c || ''; total += c; });
						row.Total = total;
						out.push(row);
					});
				});
			});
		});
		return out;
	},

	/* ── Chart: Count of Bills by Utility Types (line, month X-axis) ── */
	getUtilityChartConfig() {
		const monthsAsc = this.getMonths().slice().reverse();   // oldest → newest for the X-axis
		const bills = this._allBills();
		const utils = {};
		bills.forEach(r => {
			const u = r.utility || '(none)';
			if (!utils[u]) utils[u] = {};
			utils[u][r.month] = (utils[u][r.month] || 0) + 1;
		});
		const utilKeys = Object.keys(utils).sort();
		const palette = ['#3E6FB5', '#6BA644', '#3AAFA9', '#E0B93C', '#9B6FB0', '#C0584B', '#5B9BD5', '#1F9E89'];
		const utilColors = this._utilColors();
		const colorOf = (u, i) => utilColors[String(u).toUpperCase()] || palette[i % palette.length];

		const series = utilKeys.map((u, i) => ({
			name: u,
			type: 'line',
			smooth: false,
			showSymbol: true,
			symbolSize: 6,
			lineStyle: { width: 2, color: colorOf(u, i) },
			itemStyle: { color: colorOf(u, i) },
			data: monthsAsc.map(m => utils[u][m] || 0)   // 0 (never null) so the line renders
		}));

		const self = this;
		const labels = monthsAsc.map(m => self._monthLabel(m));
		return {
			backgroundColor: '#1E293B',
			title: { text: 'Count of Bills by Utility Types', left: 12, top: 8, textStyle: { color: '#F1F5F9', fontSize: 14, fontWeight: 600 } },
			tooltip: {
				trigger: 'axis',
				backgroundColor: '#0F172A', borderColor: '#334155', textStyle: { color: '#E2E8F0' }
			},
			legend: { type: 'scroll', orient: 'vertical', right: 8, top: 40, textStyle: { color: '#E2E8F0' }, data: utilKeys },
			grid: { left: 48, right: 150, top: 56, bottom: 64 },
			xAxis: {
				type: 'category',
				data: labels,
				axisLabel: { color: '#94A3B8', rotate: 45, fontSize: 10 },
				axisLine: { lineStyle: { color: '#475569' } }
			},
			yAxis: {
				type: 'value', name: 'Count of Bills',
				nameTextStyle: { color: '#94A3B8' },
				axisLabel: { color: '#94A3B8' },
				splitLine: { lineStyle: { color: '#2B3A4F' } }
			},
			series: series
		};
	},

	/* Chart data as plain rows for "Show as a Table" / Export: one row per invoice month
	   (newest first), one column per utility — matching the Power BI "Count of Bills by
	   Utility Types" tabular view. */
	getUtilityChartTableData() {
		const months = this.getMonths();               // YYYY-MM, newest first
		const mn = this._monthNames();
		const bills = this._allBills();
		const utilSet = {};
		const byMonthUtil = {};
		bills.forEach(r => {
			const u = r.utility || '(none)';
			utilSet[u] = true;
			const mu = byMonthUtil[r.month] || (byMonthUtil[r.month] = {});
			mu[u] = (mu[u] || 0) + 1;
		});
		const utils = Object.keys(utilSet).sort();
		return months.map(m => {
			const idx = parseInt(m.split('-')[1], 10) - 1;
			const row = { 'Service Year, Service Month': m.split('-')[0] + ', ' + (mn[idx] || m) };
			const mu = byMonthUtil[m] || {};
			utils.forEach(u => { row[u] = mu[u] || ''; });
			return row;
		});
	}
}
