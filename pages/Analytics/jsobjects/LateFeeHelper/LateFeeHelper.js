export default {

	/* ── view / breakdown toggle state (store-backed) ── */

	getViewBy() { return appsmith.store.lfView || 'donut'; },        // 'donut' | 'tabular'
	getBreakdownBy() { return appsmith.store.lfBreakdown || 'utility'; }, // 'utility' | 'vendor' | 'location'
	setView(v) { return storeValue('lfView', v); },
	setBreakdown(b) { return storeValue('lfBreakdown', b); },

	/* ── data ── */

	/* Per-bill late-fee rows from fetch_late_fees, shaped for the bill table. */
	getBills() {
		const data = (typeof fetch_late_fees !== 'undefined' && Array.isArray(fetch_late_fees.data)) ? fetch_late_fees.data : [];
		return data.map(r => {
			const net = Number(r.net_late_fee) || 0;
			const tot = Number(r.total_charges) || 0;
			return {
				pearId: r.pear_id,
				netLateFee: net,
				lateFee: Number(r.late_fee) || 0,
				recoupedLateFee: Number(r.recouped_late_fee) || 0,
				totalCharges: tot,
				lateFeePct: tot ? (net / tot * 100) : 0,
				utility: r.utility_type || '',
				vendor: r.vendor || '',
				invoiceDate: r.invoice_date || '',
				invoiceDateRaw: r.invoice_date_raw || '',
				location: r.location || ''
			};
		});
	},

	/* Dimension value for the current "Breakdown by" choice. */
	_dimKey(r) {
		const b = this.getBreakdownBy();
		if (b === 'vendor') return r.vendor || '(none)';
		if (b === 'location') return r.location || '(none)';
		return r.utility || '(none)';
	},

	/* Aggregate by the selected dimension: net / lateFee / recouped / totalCharges. */
	_byDim() {
		const out = {};
		this.getBills().forEach(r => {
			const k = this._dimKey(r);
			if (!out[k]) out[k] = { net: 0, late: 0, recoup: 0, charges: 0 };
			out[k].net += r.netLateFee;
			out[k].late += r.lateFee;
			out[k].recoup += r.recoupedLateFee;
			out[k].charges += r.totalCharges;
		});
		return out;
	},

	/* ── Donut: Net Late Fee by dimension ── */
	getDonutConfig() {
		const agg = this._byDim();
		const keys = Object.keys(agg).filter(k => Math.abs(agg[k].net) > 0.0001).sort((a, b) => agg[b].net - agg[a].net);
		const palette = ['#33A8F4', '#1F4E96', '#8BC53F', '#0E7C66', '#1E3A8A', '#94A3B8', '#14B8A6', '#F59E0B', '#EF4444', '#8B5CF6', '#DB2777', '#0EA5E9'];
		const titleByDim = { utility: 'Utility Type', vendor: 'Vendor Name', location: 'Location' };
		const data = keys.map((k, i) => ({ name: k, value: Number(agg[k].net.toFixed(2)), itemStyle: { color: palette[i % palette.length] } }));
		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
			legend: { type: 'scroll', orient: 'vertical', right: 8, top: 20, textStyle: { color: '#E2E8F0' }, data: keys },
			title: { text: titleByDim[this.getBreakdownBy()] || '', right: 8, top: 0, textStyle: { color: '#E2E8F0', fontSize: 12, fontWeight: 600 } },
			series: [{
				type: 'pie', radius: ['45%', '72%'], center: ['38%', '52%'],
				avoidLabelOverlap: true,
				label: { color: '#E2E8F0', formatter: '{c} ({d}%)' },
				labelLine: { lineStyle: { color: '#64748B' } },
				data: data
			}]
		};
	},

	/* ── Tabular: matrix by dimension with a Total row ── */
	getMatrixHtml() {
		const agg = this._byDim();
		const dimLabel = { utility: 'Utility Type', vendor: 'Vendor Name', location: 'Location' }[this.getBreakdownBy()] || 'Group';
		const keys = Object.keys(agg).sort((a, b) => agg[b].net - agg[a].net);

		const money = (v) => {
			const n = Number(v) || 0;
			const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			return n < 0 ? '(' + s + ')' : s;
		};
		const pct = (num, den) => den ? (num / den * 100).toFixed(2) + '%' : '';

		const th = 'padding:8px 12px;color:#F1F5F9;font-size:12px;font-weight:700;border-bottom:2px solid #475569;text-align:right;white-space:nowrap;';
		const thL = th + 'text-align:left;';
		const td = 'padding:7px 12px;color:#E2E8F0;font-size:12px;border-bottom:1px solid #334155;text-align:right;white-space:nowrap;';
		const tdL = td + 'text-align:left;';

		let tot = { net: 0, late: 0, recoup: 0, charges: 0 };
		keys.forEach(k => { tot.net += agg[k].net; tot.late += agg[k].late; tot.recoup += agg[k].recoup; tot.charges += agg[k].charges; });

		let h = '<div style="max-height:560px;overflow:auto;"><table style="width:100%;border-collapse:collapse;background:#1E293B;">';
		h += '<tr style="background:#334155;"><th style="' + thL + '">' + dimLabel + '</th>'
			+ '<th style="' + th + '">Net Late Fee</th><th style="' + th + '">Late Fee</th>'
			+ '<th style="' + th + '">Recouped Late Fee</th><th style="' + th + '">Total Charges</th>'
			+ '<th style="' + th + '">Recouped/late fees</th><th style="' + th + '">Late fee/charges</th></tr>';
		keys.forEach(k => {
			const a = agg[k];
			h += '<tr><td style="' + tdL + '">' + k + '</td>'
				+ '<td style="' + td + '">' + money(a.net) + '</td>'
				+ '<td style="' + td + '">' + money(a.late) + '</td>'
				+ '<td style="' + td + '">' + money(a.recoup) + '</td>'
				+ '<td style="' + td + '">' + money(a.charges) + '</td>'
				+ '<td style="' + td + '">' + pct(Math.abs(a.recoup), a.late) + '</td>'
				+ '<td style="' + td + '">' + pct(a.net, a.charges) + '</td></tr>';
		});
		const tf = td + 'font-weight:700;border-top:2px solid #475569;color:#F1F5F9;';
		const tfL = tdL + 'font-weight:700;border-top:2px solid #475569;color:#F1F5F9;';
		h += '<tr><td style="' + tfL + '">Total</td>'
			+ '<td style="' + tf + '">' + money(tot.net) + '</td>'
			+ '<td style="' + tf + '">' + money(tot.late) + '</td>'
			+ '<td style="' + tf + '">' + money(tot.recoup) + '</td>'
			+ '<td style="' + tf + '">' + money(tot.charges) + '</td>'
			+ '<td style="' + tf + '">' + pct(Math.abs(tot.recoup), tot.late) + '</td>'
			+ '<td style="' + tf + '">' + pct(tot.net, tot.charges) + '</td></tr>';
		h += '</table></div>';
		return h;
	},

	/* Matrix rows as plain objects for "Show as a Table" / Export (includes a Total row). */
	getMatrixTableData() {
		const agg = this._byDim();
		const dimLabel = { utility: 'Utility Type', vendor: 'Vendor Name', location: 'Location' }[this.getBreakdownBy()] || 'Group';
		const keys = Object.keys(agg).sort((a, b) => agg[b].net - agg[a].net);
		const f = (v) => (Number(v) || 0).toFixed(2);
		const pct = (n, d) => d ? (n / d * 100).toFixed(2) + '%' : '';
		const mk = (label, a) => {
			const row = {};
			row[dimLabel] = label;
			row['Net Late Fee'] = f(a.net);
			row['Late Fee'] = f(a.late);
			row['Recouped Late Fee'] = f(a.recoup);
			row['Total Charges'] = f(a.charges);
			row['Recouped/late fees'] = pct(Math.abs(a.recoup), a.late);
			row['Late fee/charges'] = pct(a.net, a.charges);
			return row;
		};
		const rows = keys.map(k => mk(k, agg[k]));
		const tot = { net: 0, late: 0, recoup: 0, charges: 0 };
		keys.forEach(k => { tot.net += agg[k].net; tot.late += agg[k].late; tot.recoup += agg[k].recoup; tot.charges += agg[k].charges; });
		rows.push(mk('Total', tot));
		return rows;
	}
}
