export default {

	/* ── helpers ─────────────────────────────── */

	_monthKey(tp) {
		// time_period comes back as "2025-10-01T00:00:00.000Z" or "2025-10-01"
		return String(tp || '').slice(0, 7); // "YYYY-MM"
	},

	_monthLabel(ym) {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const m = parseInt(ym.slice(5, 7), 10);
		return months[m - 1] || ym;
	},

	/* Distinct months present in the data, newest first, capped to last 13 */
	getMonthAxis() {
		const data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		const set = {};
		data.forEach(r => {
			const k = this._monthKey(r.time_period);
			if (k.length === 7) set[k] = true;
		});
		return Object.keys(set).sort().reverse().slice(0, 13);
	},

	/* One row per location / account / meter / utility / bill type, with the set of covered months */
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
		return Object.keys(map)
			.sort()
			.map(k => map[k]);
	},

	/* ── rendering ───────────────────────────── */

	getLegendHtml() {
		const sw = (color) => '<span style="display:inline-block;width:26px;height:15px;border-radius:3px;background:' + color + ';vertical-align:middle;"></span>';
		// small white "document" glyph for the invoice-received marker
		const invoice = '<span style="display:inline-block;width:20px;height:16px;border:1px solid #CBD5E1;border-radius:2px;background:repeating-linear-gradient(#ffffff,#ffffff 2px,#cbd5e1 3px,#ffffff 4px);vertical-align:middle;"></span>';
		const item = (inner, label) => '<span style="display:inline-flex;align-items:center;gap:8px;margin-right:32px;color:#E2E8F0;font-size:13px;">' + inner + '<span>' + label + '</span></span>';
		return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 0;padding:4px 0;">'
			+ item(sw('#15803d'), 'denotes the service period is fully covered by at least 1 bill')
			+ item('<span style="display:inline-flex;">' + sw('#86efac') + sw('#ef4444') + '</span>', 'denotes the service period is partially/not covered')
			+ item(invoice, 'denotes invoice received')
			+ '</div>';
	},

	getInvoiceParticipationHtml() {
		const rows = this.getRows();
		const axis = this.getMonthAxis();

		if (!rows.length || !axis.length) {
			return '<div style="padding:20px;color:#94A3B8;text-align:center;">No data available</div>';
		}

		// trailing 12 months for the %Last12Mo calculation
		const last12 = axis.slice(0, 12);

		// group month columns by year for the two-row header
		const yearGroups = [];
		axis.forEach(ym => {
			const y = ym.slice(0, 4);
			const last = yearGroups[yearGroups.length - 1];
			if (last && last.year === y) last.months.push(ym);
			else yearGroups.push({ year: y, months: [ym] });
		});

		const fixedCols = ['Location', 'Account', 'Meter', 'Utility', 'Bill Type', '%Last12Mo'];
		const th = 'padding:8px 10px;font-size:12px;font-weight:700;color:#F1F5F9;border-bottom:2px solid #475569;white-space:nowrap;text-align:left;';
		const thMonth = 'padding:8px 6px;font-size:12px;font-weight:700;color:#F1F5F9;border-bottom:2px solid #475569;border-left:1px solid #475569;text-align:center;white-space:nowrap;';
		const td = 'padding:6px 10px;font-size:12px;color:#E2E8F0;border-bottom:1px solid #334155;white-space:nowrap;';
		const tdCell = 'border-bottom:1px solid #1E293B;border-left:1px solid #1E293B;width:42px;';

		// year header row
		let yearRow = '<tr><th colspan="' + fixedCols.length + '" style="' + th + 'background:#334155;border-bottom:none;"></th>';
		yearRow += '<th style="' + thMonth + 'border-bottom:none;">Service Year</th>';
		yearGroups.forEach(g => {
			yearRow += '<th colspan="' + g.months.length + '" style="' + thMonth + 'border-bottom:none;">' + g.year + '</th>';
		});
		yearRow += '</tr>';

		// column header row
		let headRow = '<tr>' + fixedCols.map(c => '<th style="' + th + '">' + c + '</th>').join('');
		headRow += '<th style="' + thMonth + '"></th>';
		axis.forEach(ym => { headRow += '<th style="' + thMonth + '">' + this._monthLabel(ym) + '</th>'; });
		headRow += '</tr>';

		// body
		const body = rows.map(r => {
			const covered12 = last12.filter(ym => r.months[ym]).length;
			const pct = last12.length ? Math.round((covered12 / last12.length) * 100 * 100) / 100 : 0;
			let tr = '<tr>'
				+ '<td style="' + td + '">' + r.location + '</td>'
				+ '<td style="' + td + '">' + r.account + '</td>'
				+ '<td style="' + td + '">' + r.meter + '</td>'
				+ '<td style="' + td + '">' + r.utility + '</td>'
				+ '<td style="' + td + '">' + r.billType + '</td>'
				+ '<td style="' + td + 'text-align:right;">' + pct.toFixed(2) + '%</td>'
				+ '<td style="' + tdCell + '"></td>';
			axis.forEach(ym => {
				const bg = r.months[ym] ? '#15803d' : '#ef4444';
				tr += '<td style="' + tdCell + 'background:' + bg + ';"></td>';
			});
			tr += '</tr>';
			return tr;
		}).join('');

		return '<div style="max-height:1150px;overflow:auto;border:1px solid #334155;border-radius:6px;">'
			+ '<table style="width:100%;border-collapse:collapse;background:#1E293B;">'
			+ '<thead style="position:sticky;top:0;background:#334155;">' + yearRow + headRow + '</thead>'
			+ '<tbody>' + body + '</tbody>'
			+ '</table></div>';
	},

	/* Called from BillHealthTabs.onTabSelected — placeholder for per-tab defaults */
	setDefaults() {
		return;
	}
}
