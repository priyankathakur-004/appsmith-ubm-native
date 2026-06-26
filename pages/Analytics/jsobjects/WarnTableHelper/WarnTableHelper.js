export default {
	/* Self-contained "Show as a Table" / Export data source for the Warnings-over-Time charts.
	   It reads the warnings query result directly and references no widgets, so it stays a pure
	   data source (reading the Warnings slicers would pull in BillHealthHelper, whose SQL builders
	   read the widgets that run the query — Appsmith flags mixing a query's run trigger with its
	   data in one path). It therefore reflects the server-side Severity + Invoice Date filters,
	   not the four JS slicers. */

	_cat(msg) {
		const m = String(msg || '');
		if (/unit cost/i.test(m) && /higher than/i.test(m)) return 'Unit cost > 10% higher than prior bill';
		if (/charge/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Charges are out of range (warning)';
		if (/(consumption|volume)/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Volume is out of range (warning)';
		return 'Other';
	},

	_parse(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; },

	_monthLabel(mk) {
		const names = ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
		const mi = parseInt(mk.slice(5, 7), 10) - 1;
		return mk.slice(0, 4) + ', ' + (names[mi] || '');
	},

	/* Mapped warning rows straight from the (server-filtered) query result — no widget reads. */
	_rows() {
		const data = (typeof fetch_warnings !== 'undefined' && Array.isArray(fetch_warnings.data)) ? fetch_warnings.data : [];
		return data.map(r => ({
			pearId: r.pear_id || '',
			warning: r.bill_warning || '',
			amount: Number(r.total_amount) || 0,
			vendor: r.vendor || '',
			invoiceDateRaw: r.invoice_date_raw || ''
		}));
	},

	/* Pivot: one row per month. Utility fan-out is collapsed (dedupe by pear_id + message).
	   - Warning Count ('count'): a plain count column per category (no Vendor), matching the UBM view.
	   - Bills Impacted ('amount'): Total Amount + Vendor per category. */
	_tableData(metric) {
		const cats = ['Charges are out of range (warning)', 'Unit cost > 10% higher than prior bill', 'Volume is out of range (warning)'];
		const seen = {};
		const byMonth = {};
		this._rows().forEach(r => {
			const dk = r.pearId + '||' + r.warning;
			if (seen[dk]) return;
			seen[dk] = true;
			const d = this._parse(r.invoiceDateRaw);
			if (!d) return;
			const c = this._cat(r.warning);
			if (cats.indexOf(c) < 0) return;
			const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
			if (!byMonth[mk]) byMonth[mk] = {};
			if (!byMonth[mk][c]) byMonth[mk][c] = { count: 0, amount: 0, vendors: {} };
			byMonth[mk][c].count += 1;
			byMonth[mk][c].amount += r.amount;
			if (r.vendor) byMonth[mk][c].vendors[r.vendor] = true;
		});
		return Object.keys(byMonth).sort().map(mk => {
			const row = { 'Year, Month': this._monthLabel(mk) };
			cats.forEach(c => {
				const cell = byMonth[mk][c];
				if (metric === 'count') {
					row[c] = cell ? String(cell.count) : '';
				} else {
					row[c + ' — Total Amount'] = cell ? cell.amount.toFixed(2) : '';
					row[c + ' — Vendor'] = cell ? Object.keys(cell.vendors).join(', ') : '';
				}
			});
			return row;
		});
	},

	getBillsTable() { return this._tableData('amount'); },

	getCountTable() { return this._tableData('count'); }
}
