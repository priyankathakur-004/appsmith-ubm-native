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
			rateCode: r.rate_code || '(no rate)',
			billId: r.bill_id,
			customerId: r.customer_id,
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

		/* Column model: just the invoice months (totals live only in "Show as a Table"). */
		const cols = [];
		yearGroups.forEach(g => {
			g.months.forEach(m => cols.push({ kind: 'm', month: m }));
		});

		const sortK = (o) => Object.keys(o).sort();

		/* Mirror the UBM matrix exactly (dark theme): group rows (Location > Utility > Meter) show
		   a collapse icon + label with BLANK month cells; only the leaf (Bill Type) row carries the
		   underlined, click-style bill counts. */
		const th = 'padding:6px 9px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:center;white-space:nowrap;background:#334155;line-height:16px;';
		const thL = 'padding:6px 12px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:left;white-space:nowrap;background:#334155;line-height:16px;';
		const s1 = 'position:sticky;top:0;z-index:6;';
		const s2 = 'position:sticky;top:30px;z-index:6;';
		const sep = 'border-left:1px solid #475569;';
		const tdBlank = 'padding:5px 9px;border-bottom:1px solid #243140;';
		const tdNum = 'padding:5px 9px;font-size:12px;border-bottom:1px solid #243140;text-align:center;white-space:nowrap;';
		const lvlPad = [10, 26, 44, 66];
		const lvlBg = ['#2B3B53', '#24344A', '#1E2A3C', '#172131'];
		const lvlText = ['color:#FFFFFF;font-weight:700;', 'color:#E2E8F0;font-weight:600;', 'color:#C7D2E0;font-weight:600;', 'color:#D7DEE8;'];
		const icon = '<span style="display:inline-block;width:12px;height:12px;line-height:10px;text-align:center;border:1px solid #6B7A90;border-radius:2px;font-size:12px;color:#9FB0C4;margin-right:8px;vertical-align:middle;">-</span>';
		const labelStyle = (lvl) => 'padding:5px 10px 5px ' + lvlPad[lvl] + 'px;font-size:12px;border-bottom:1px solid #243140;text-align:left;white-space:nowrap;' + lvlText[lvl] + 'background:' + lvlBg[lvl] + ';';

		let h = '<div style="width:100%;height:100%;max-height:838px;overflow:auto;margin:0;"><table style="border-collapse:collapse;background:#172131;min-width:100%;margin:0;">\n';
		/* header row 1: Service Year + year spans (sticky to top of the scroll area) */
		h += '<tr><th style="' + thL + s1 + '">Service Year</th>';
		yearGroups.forEach(g => { h += '<th style="' + th + sep + s1 + '" colspan="' + g.months.length + '">' + g.year + '</th>'; });
		h += '</tr>\n';
		/* header row 2: Location + month abbreviations (sticky below row 1) */
		h += '<tr><th style="' + thL + s2 + '">Location</th>';
		yearGroups.forEach(g => {
			g.months.forEach(m => { const idx = parseInt(m.split('-')[1], 10) - 1; h += '<th style="' + th + s2 + '">' + (mn[idx] || m) + '</th>'; });
		});
		h += '</tr>\n';

		const groupRow = (label, lvl) => {
			let r = '<tr><td style="' + labelStyle(lvl) + '">' + icon + label + '</td>';
			cols.forEach(() => { r += '<td style="' + tdBlank + 'background:' + lvlBg[lvl] + ';"></td>'; });
			return r + '</tr>\n';
		};
		/* Hover tooltip on every leaf cell via the native title attribute (Appsmith's Text widget
		   strips <style>, so a themed CSS tooltip isn't possible — title is the only option). */
		const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
		const leafRow = (loc, util, meter, label, counts) => {
			let r = '<tr><td style="' + labelStyle(3) + '">' + label + '</td>';
			cols.forEach(c => {
				const v = counts[c.month] || 0;
				const idx = parseInt(c.month.split('-')[1], 10) - 1;
				const yr = c.month.split('-')[0];
				const tip = esc('Location: ' + loc + '\nUtility Type: ' + util + '\nMeter ID: ' + meter
					+ '\nBill Type: ' + label + '\nService Year Service Month: ' + yr + ' ' + (mn[idx] || c.month)
					+ '\nReceived Bills Count: ' + (v ? v : '(Blank)')).replace(/\n/g, '&#10;');
				r += '<td title="' + tip + '" style="' + tdNum + 'background:' + lvlBg[3] + ';">' + (v ? '<span style="color:#7FB2F0;text-decoration:underline;cursor:pointer;">' + v + '</span>' : '') + '</td>';
			});
			return r + '</tr>\n';
		};

		sortK(tree).forEach(loc => {
			h += groupRow(loc, 0);
			const U = tree[loc];
			sortK(U).forEach(util => {
				h += groupRow(util, 1);
				const M = U[util];
				sortK(M).forEach(meter => {
					h += groupRow(meter, 2);
					const B = M[meter];
					sortK(B).forEach(bt => { h += leafRow(loc, util, meter, bt, B[bt]); });
				});
			});
		});
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
	},

	/* ── Received Bills per Location ──────────────────────────────────────────
	   A flat per-Location matrix of received-bill counts by invoice month, WITH a
	   per-year Total column and a Total row (mirrors the UBM "Bill counts by months
	   for various locations" page). Same fetch_received_bills data + shared filters. */
	getLocationMatrixHtml() {
		const months = this.getMonths();
		if (!months.length) {
			return '<div style="padding:24px;color:#94A3B8;font-size:13px;">No received bills for the current filters.</div>';
		}
		const mn = this._monthNames();
		const byLoc = {};
		this._allBills().forEach(r => {
			const L = byLoc[r.location] || (byLoc[r.location] = {});
			L[r.month] = (L[r.month] || 0) + 1;
		});

		const yearGroups = [];
		months.forEach(m => {
			const y = m.split('-')[0];
			let g = yearGroups[yearGroups.length - 1];
			if (!g || g.year !== y) { g = { year: y, months: [] }; yearGroups.push(g); }
			g.months.push(m);
		});
		const cols = [];
		yearGroups.forEach(g => {
			g.months.forEach(m => cols.push({ kind: 'm', month: m }));
			cols.push({ kind: 'yt', months: g.months });
		});
		const colVal = (mc, c) => c.kind === 'm' ? (mc[c.month] || 0) : c.months.reduce((s, m) => s + (mc[m] || 0), 0);

		const th = 'padding:6px 9px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:center;white-space:nowrap;background:#334155;line-height:16px;';
		const thL = 'padding:6px 12px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:left;white-space:nowrap;background:#334155;line-height:16px;';
		const s1 = 'position:sticky;top:0;z-index:6;';
		const s2 = 'position:sticky;top:30px;z-index:6;';
		const sep = 'border-left:1px solid #475569;';
		const tdL = 'padding:5px 12px;font-size:12px;border-bottom:1px solid #243140;text-align:left;white-space:nowrap;color:#E2E8F0;';
		const tdC = 'padding:5px 9px;font-size:12px;border-bottom:1px solid #243140;text-align:center;white-space:nowrap;color:#E2E8F0;';

		let h = '<div style="width:100%;height:100%;max-height:838px;overflow:auto;margin:0;"><table style="border-collapse:collapse;background:#172131;min-width:100%;margin:0;">\n';
		h += '<tr><th style="' + thL + s1 + '">Service Year</th>';
		yearGroups.forEach(g => { h += '<th style="' + th + sep + s1 + '" colspan="' + (g.months.length + 1) + '">' + g.year + '</th>'; });
		h += '</tr>\n';
		h += '<tr><th style="' + thL + s2 + '">Location</th>';
		yearGroups.forEach(g => {
			g.months.forEach(m => { const idx = parseInt(m.split('-')[1], 10) - 1; h += '<th style="' + th + s2 + '">' + (mn[idx] || m) + '</th>'; });
			h += '<th style="' + th + sep + s2 + '">Total</th>';
		});
		h += '</tr>\n';

		const locs = Object.keys(byLoc).sort();
		const grand = {};
		locs.forEach((loc, i) => {
			const mc = byLoc[loc];
			for (const m in mc) grand[m] = (grand[m] || 0) + mc[m];
			const bg = (i % 2) ? 'background:#1B2738;' : 'background:#172131;';
			let r = '<tr><td style="' + tdL + bg + '">' + loc + '</td>';
			cols.forEach(c => {
				const v = colVal(mc, c);
				const st = tdC + bg + (c.kind === 'yt' ? 'font-weight:700;color:#F8FAFC;' + sep : '');
				r += '<td style="' + st + '">' + (v ? v : '') + '</td>';
			});
			h += r + '</tr>\n';
		});
		const sb = 'position:sticky;bottom:0;z-index:6;';
		let tr = '<tr><td style="' + tdL + 'background:#334155;font-weight:700;color:#F8FAFC;border-top:2px solid #475569;' + sb + '">Total</td>';
		cols.forEach(c => {
			const v = colVal(grand, c);
			tr += '<td style="' + tdC + 'background:#334155;font-weight:700;color:#F8FAFC;border-top:2px solid #475569;' + (c.kind === 'yt' ? sep : '') + sb + '">' + (v ? v : '') + '</td>';
		});
		h += tr + '</tr>\n</table></div>';
		return h;
	},

	/* Per-location rows for "Show as a Table" / Export (one row per location, a column per month + Total). */
	getLocationMatrixTableData() {
		const months = this.getMonths();
		const byLoc = {};
		this._allBills().forEach(r => {
			const L = byLoc[r.location] || (byLoc[r.location] = {});
			L[r.month] = (L[r.month] || 0) + 1;
		});
		return Object.keys(byLoc).sort().map(loc => {
			const row = { Location: loc };
			let total = 0;
			months.forEach(m => { const c = byLoc[loc][m] || 0; row[this._monthLabel(m)] = c || ''; total += c; });
			row.Total = total;
			return row;
		});
	},

	/* ── Rate Codes ───────────────────────────────────────────────────────────
	   Same Location > Utility > Meter > Bill Type hierarchy as the Details matrix,
	   but each month cell shows the bill's RATE CODE as a link to the bill in
	   Constellation Navigator. Plus a treemap decomposing bill counts by utility
	   type and rate code. Same fetch_received_bills data + shared filters. */
	_billUrl(customerId, billId) {
		if (billId == null) return '';
		return 'https://ubm.constellationnavigator.com/' + (customerId != null ? customerId : '') + '/bills/' + billId;
	},

	getRateMatrixHtml() {
		const months = this.getMonths();
		if (!months.length) {
			return '<div style="padding:24px;color:#94A3B8;font-size:13px;">No received bills for the current filters.</div>';
		}
		const mn = this._monthNames();
		const self = this;

		/* tree[loc][util][meter][bt][month] = { code, url } */
		const tree = {};
		this._allBills().forEach(r => {
			const L = tree[r.location] || (tree[r.location] = {});
			const U = L[r.utility] || (L[r.utility] = {});
			const M = U[r.meterId] || (U[r.meterId] = {});
			const B = M[r.billType] || (M[r.billType] = {});
			if (!B[r.month]) B[r.month] = { code: r.rateCode, url: self._billUrl(r.customerId, r.billId) };
			else if (B[r.month].code.indexOf(r.rateCode) === -1) B[r.month].code += ', ' + r.rateCode;
		});

		const yearGroups = [];
		months.forEach(m => {
			const y = m.split('-')[0];
			let g = yearGroups[yearGroups.length - 1];
			if (!g || g.year !== y) { g = { year: y, months: [] }; yearGroups.push(g); }
			g.months.push(m);
		});
		const cols = [];
		yearGroups.forEach(g => { g.months.forEach(m => cols.push({ month: m })); });

		const th = 'padding:6px 9px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:center;white-space:nowrap;background:#334155;line-height:16px;';
		const thL = 'padding:6px 12px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:left;white-space:nowrap;background:#334155;line-height:16px;';
		const s1 = 'position:sticky;top:0;z-index:6;';
		const s2 = 'position:sticky;top:30px;z-index:6;';
		const sep = 'border-left:1px solid #475569;';
		const tdBlank = 'padding:5px 9px;border-bottom:1px solid #243140;';
		const tdC = 'padding:5px 9px;font-size:12px;border-bottom:1px solid #243140;text-align:center;white-space:nowrap;';
		const lvlPad = [10, 26, 44, 66];
		const lvlBg = ['#2B3B53', '#24344A', '#1E2A3C', '#172131'];
		const lvlText = ['color:#FFFFFF;font-weight:700;', 'color:#E2E8F0;font-weight:600;', 'color:#C7D2E0;font-weight:600;', 'color:#D7DEE8;'];
		const icon = '<span style="display:inline-block;width:12px;height:12px;line-height:10px;text-align:center;border:1px solid #6B7A90;border-radius:2px;font-size:12px;color:#9FB0C4;margin-right:8px;vertical-align:middle;">-</span>';
		const labelStyle = (lvl) => 'padding:5px 10px 5px ' + lvlPad[lvl] + 'px;font-size:12px;border-bottom:1px solid #243140;text-align:left;white-space:nowrap;' + lvlText[lvl] + 'background:' + lvlBg[lvl] + ';';
		const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

		let h = '<div style="width:100%;height:100%;max-height:838px;overflow:auto;margin:0;"><table style="border-collapse:collapse;background:#172131;min-width:100%;margin:0;">\n';
		h += '<tr><th style="' + thL + s1 + '">Service Year</th>';
		yearGroups.forEach(g => { h += '<th style="' + th + sep + s1 + '" colspan="' + g.months.length + '">' + g.year + '</th>'; });
		h += '</tr>\n';
		h += '<tr><th style="' + thL + s2 + '">Location</th>';
		yearGroups.forEach(g => { g.months.forEach(m => { const idx = parseInt(m.split('-')[1], 10) - 1; h += '<th style="' + th + s2 + '">' + (mn[idx] || m) + '</th>'; }); });
		h += '</tr>\n';

		const sortK = (o) => Object.keys(o).sort();
		const groupRow = (label, lvl) => {
			let r = '<tr><td style="' + labelStyle(lvl) + '">' + icon + label + '</td>';
			cols.forEach(() => { r += '<td style="' + tdBlank + 'background:' + lvlBg[lvl] + ';"></td>'; });
			return r + '</tr>\n';
		};
		const leafRow = (loc, util, meter, label, cells) => {
			let r = '<tr><td style="' + labelStyle(3) + '">' + label + '</td>';
			cols.forEach(c => {
				const cell = cells[c.month];
				const idx = parseInt(c.month.split('-')[1], 10) - 1;
				const yr = c.month.split('-')[0];
				const tip = esc('Location: ' + loc + '\nUtility Type: ' + util + '\nMeter ID: ' + meter
					+ '\nBill Type: ' + label + '\nService Year Service Month: ' + yr + ' ' + (mn[idx] || c.month)
					+ '\nRate Code: ' + (cell ? cell.code : '(Blank)')).replace(/\n/g, '&#10;');
				const inner = cell
					? '<a href="' + esc(cell.url) + '" target="_blank" rel="noopener" style="color:#7FB2F0;text-decoration:underline;">' + cell.code + '</a>'
					: '';
				r += '<td title="' + tip + '" style="' + tdC + 'background:' + lvlBg[3] + ';">' + inner + '</td>';
			});
			return r + '</tr>\n';
		};

		sortK(tree).forEach(loc => {
			h += groupRow(loc, 0);
			const U = tree[loc];
			sortK(U).forEach(util => {
				h += groupRow(util, 1);
				const M = U[util];
				sortK(M).forEach(meter => {
					h += groupRow(meter, 2);
					const B = M[meter];
					sortK(B).forEach(bt => { h += leafRow(loc, util, meter, bt, B[bt]); });
				});
			});
		});
		h += '</table></div>';
		return h;
	},

	/* Rate-code matrix rows for "Show as a Table" / Export (leaf rows, a column per month). */
	getRateMatrixTableData() {
		const months = this.getMonths();
		const tree = {};
		this._allBills().forEach(r => {
			const L = tree[r.location] || (tree[r.location] = {});
			const U = L[r.utility] || (L[r.utility] = {});
			const M = U[r.meterId] || (U[r.meterId] = {});
			const B = M[r.billType] || (M[r.billType] = {});
			if (!B[r.month]) B[r.month] = r.rateCode;
			else if (B[r.month].indexOf(r.rateCode) === -1) B[r.month] += ', ' + r.rateCode;
		});
		const out = [];
		Object.keys(tree).sort().forEach(loc => {
			const U = tree[loc];
			Object.keys(U).sort().forEach(util => {
				const M = U[util];
				Object.keys(M).sort().forEach(meter => {
					const B = M[meter];
					Object.keys(B).sort().forEach(bt => {
						const row = { Location: loc, 'Utility Type': util, 'Meter ID': meter, 'Bill Type': bt };
						months.forEach(m => { row[this._monthLabel(m)] = B[bt][m] || ''; });
						out.push(row);
					});
				});
			});
		});
		return out;
	},

	/* ── Treemap: bill counts by Utility Type, drillable to Rate Code ── */
	getRateTreemapConfig() {
		const utilColors = this._utilColors();
		const palette = ['#3E6FB5', '#6BA644', '#3AAFA9', '#E0B93C', '#9B6FB0', '#C0584B', '#5B9BD5', '#1F9E89'];
		const tree = {};
		const locTree = {};
		this._allBills().forEach(r => {
			const u = r.utility || '(none)';
			const rc = r.rateCode || '(no rate)';
			const loc = r.location || '(none)';
			(tree[u] = tree[u] || {}); tree[u][rc] = (tree[u][rc] || 0) + 1;
			(locTree[u] = locTree[u] || {}); locTree[u][loc] = (locTree[u][loc] || 0) + 1;
		});
		const data = Object.keys(tree).sort().map((u, i) => {
			const color = utilColors[String(u).toUpperCase()] || palette[i % palette.length];
			/* per-location breakdown stashed on EVERY node (parent + children) so the tooltip can
			   draw the utility's location pie whether you hover the title strip OR the colored body
			   — the body is occupied by the rate-code children. Data survives serialization. */
			const locs = Object.keys(locTree[u]).map(l => ({ name: l, value: locTree[u][l] })).sort((a, b) => b.value - a.value);
			const children = Object.keys(tree[u]).sort().map(rc => ({ name: rc, value: tree[u][rc], _locs: locs, _util: u }));
			const total = children.reduce((s, c) => s + c.value, 0);
			return { name: u, value: total, itemStyle: { color: color }, children: children, _locs: locs, _util: u };
		});
		return {
			backgroundColor: '#1E293B',
			title: { text: 'Decomposition of bill numbers by utility type and rate codes', left: 12, top: 8, textStyle: { color: '#F1F5F9', fontSize: 14, fontWeight: 600 } },
			tooltip: {
				backgroundColor: '#0F172A', borderColor: '#334155', textStyle: { color: '#E2E8F0' },
				enterable: true,
				extraCssText: 'max-width:none;box-shadow:0 8px 20px rgba(0,0,0,0.55);',
				formatter: function (p) {
					var d = p.data || {};
					var locs = d._locs;
					if (!locs || !locs.length) {
						return '<b>' + p.name + '</b><br/>Bills: ' + p.value;
					}
					var palette2 = ['#3E6FB5', '#6BA644', '#3AAFA9', '#E0B93C', '#9B6FB0', '#C0584B', '#5B9BD5', '#1F9E89', '#E07B39', '#7F8C8D', '#B5495B', '#4DB6AC', '#C084FC', '#FACC15', '#22D3EE', '#F472B6'];
					var total = 0, i; for (i = 0; i < locs.length; i++) total += locs[i].value;
					var cx = 70, cy = 70, R = 60, ang = -Math.PI / 2, paths = '';
					for (i = 0; i < locs.length; i++) {
						var frac = total ? locs[i].value / total : 0;
						var col = palette2[i % palette2.length];
						if (locs.length === 1) { paths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + col + '"/>'; break; }
						var a2 = ang + frac * 2 * Math.PI;
						var x1 = (cx + R * Math.cos(ang)).toFixed(2), y1 = (cy + R * Math.sin(ang)).toFixed(2);
						var x2 = (cx + R * Math.cos(a2)).toFixed(2), y2 = (cy + R * Math.sin(a2)).toFixed(2);
						var large = frac > 0.5 ? 1 : 0;
						paths += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + col + '"/>';
						ang = a2;
					}
					var leg = '', top = locs.slice(0, 10);
					for (i = 0; i < top.length; i++) {
						var pct = total ? (top[i].value / total * 100).toFixed(1) : '0';
						leg += '<div style="display:flex;align-items:center;margin:1px 0;white-space:nowrap;"><span style="width:9px;height:9px;background:' + palette2[i % palette2.length] + ';display:inline-block;margin-right:5px;border-radius:2px;"></span>' + top[i].name + ': ' + top[i].value + ' (' + pct + '%)</div>';
					}
					if (locs.length > 10) leg += '<div style="color:#94A3B8;margin-top:2px;">+' + (locs.length - 10) + ' more…</div>';
					var hdr = d._util || p.name;
					return '<div style="display:flex;align-items:flex-start;">'
						+ '<div style="text-align:center;"><div style="font-weight:700;color:#F1F5F9;margin-bottom:2px;">' + hdr + '</div><svg width="140" height="140" viewBox="0 0 140 140">' + paths + '</svg></div>'
						+ '<div style="margin-left:10px;font-size:11px;color:#E2E8F0;max-height:140px;overflow:auto;"><div style="color:#94A3B8;font-weight:700;margin-bottom:3px;">Location</div>' + leg + '</div></div>';
				}
			},
			series: [{
				type: 'treemap',
				top: 40, left: 6, right: 6, bottom: 6,
				roam: false,
				nodeClick: false,
				breadcrumb: { show: false },
				visibleMin: 1,
				label: { show: true, position: 'insideBottomLeft', color: '#FFFFFF', fontSize: 11, formatter: '{b}' },
				upperLabel: { show: true, height: 20, color: '#FFFFFF', fontSize: 12, fontWeight: 700, align: 'left' },
				levels: [
					{ itemStyle: { borderColor: '#0F172A', borderWidth: 2, gapWidth: 2 } },
					{ itemStyle: { borderColor: '#1E293B', borderWidth: 1, gapWidth: 1 }, colorSaturation: [0.35, 0.6] }
				],
				data: data
			}]
		};
	},

	/* Treemap data as plain rows for "Show as a Table" / Export (Utility Type, Rate Code, Bills). */
	getRateTreemapTableData() {
		const tree = {};
		this._allBills().forEach(r => {
			const u = r.utility || '(none)';
			const rc = r.rateCode || '(no rate)';
			(tree[u] = tree[u] || {});
			tree[u][rc] = (tree[u][rc] || 0) + 1;
		});
		const out = [];
		Object.keys(tree).sort().forEach(u => {
			Object.keys(tree[u]).sort().forEach(rc => {
				out.push({ 'Utility Type': u, 'Rate Code': rc, 'Bills': tree[u][rc] });
			});
		});
		return out;
	}
}
