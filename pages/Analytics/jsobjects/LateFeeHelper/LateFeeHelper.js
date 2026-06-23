export default {

	/* ── view / breakdown toggle state (store-backed) ── */

	getViewBy() { return appsmith.store.lfView || 'donut'; },        // 'donut' | 'tabular'
	getBreakdownBy() { return appsmith.store.lfBreakdown || 'utility'; }, // 'utility' | 'vendor' | 'location'
	setView(v) { return storeValue('lfView', v); },
	setBreakdown(b) { return storeValue('lfBreakdown', b); },

	/* ── data ── */

	/* ALL live+processed bills (fetch_late_fees has no net≠0 filter) — feeds the matrix/donut so
	   vendors/locations with zero late fees still appear with their Total Charges. */
	_allBills() {
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

	/* Only bills that actually carry a late fee (Net Late Fee ≠ 0) — the right-side detail table. */
	getBills() {
		return this._allBills().filter(r => Math.abs(r.netLateFee) > 1e-6);
	},

	/* Dimension value for a given dimension (defaults to the "Breakdown by" choice). */
	_dimKey(r, dim) {
		const b = dim || this.getBreakdownBy();
		if (b === 'vendor') return r.vendor || '(none)';
		if (b === 'location') return r.location || '(none)';
		return r.utility || '(none)';
	},

	/* Aggregate net / lateFee / recouped / totalCharges by dimension (default = selected breakdown). */
	_byDim(dim) {
		const out = {};
		this._allBills().forEach(r => {
			const k = this._dimKey(r, dim);
			if (!out[k]) out[k] = { net: 0, late: 0, recoup: 0, charges: 0 };
			out[k].net += r.netLateFee;
			/* UBM's "Late Fee" / "Recouped Late Fee" split by each BILL's net sign (not line-level). */
			out[k].late += (r.netLateFee > 0 ? r.netLateFee : 0);
			out[k].recoup += (r.netLateFee < 0 ? r.netLateFee : 0);
			out[k].charges += r.totalCharges;
		});
		return out;
	},

	/* ── Donut: Net Late Fee by dimension ── */
	getDonutConfig() {
		const agg = this._byDim();
		const keys = Object.keys(agg).filter(k => Math.abs(agg[k].net) > 0.0001).sort((a, b) => agg[b].net - agg[a].net);
		/* fixed per-utility colours (green gas, blue electric, …) like the UBM donut; palette is the
		   fallback for the Vendors / Locations breakdowns. */
		const utilColors = {
			NATURALGAS: '#6BA644', ELECTRIC: '#3E6FB5', WATER: '#3AAFA9', SEWER: '#8E6E53',
			LIGHTING: '#E0B93C', OIL2: '#C0584B', STEAM: '#9B6FB0', SOLARPV: '#1F9E89',
			PROPANE: '#E07B39', STORMWATER: '#5B9BD5', TELEPHONE: '#7F8C8D', INTERNET: '#B5495B'
		};
		const palette = ['#3E6FB5', '#6BA644', '#3AAFA9', '#E0B93C', '#9B6FB0', '#C0584B', '#5B9BD5', '#1F9E89', '#E07B39', '#7F8C8D', '#B5495B', '#4DB6AC'];
		const byUtil = this.getBreakdownBy() === 'utility';
		const titleByDim = { utility: 'Utility Type', vendor: 'Vendor Name', location: 'Location' };
		const data = keys.map((k, i) => ({ name: k, value: Number(agg[k].net.toFixed(2)), itemStyle: { color: (byUtil && utilColors[String(k).toUpperCase()]) || palette[i % palette.length] } }));
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
		const agg = this._byDim('vendor');
		const dimLabel = 'Vendor Name';
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
		const agg = this._byDim('vendor');
		const dimLabel = 'Vendor Name';
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
	},

	/* Bill-table rows as plain objects for the right table's "Show as a Table" / Export. */
	getBillsTableData() {
		return this.getBills().map(r => ({
			'Pear ID': r.pearId,
			'Net Late Fee': (Number(r.netLateFee) || 0).toFixed(2),
			'Total Charges': (Number(r.totalCharges) || 0).toFixed(2),
			'Late fee/charges': (Number(r.lateFeePct) || 0).toFixed(2) + '%',
			'Utility Type': r.utility,
			'Vendor Name': r.vendor,
			'Invoice Date': r.invoiceDate,
			'Location': r.location
		}));
	}
}
