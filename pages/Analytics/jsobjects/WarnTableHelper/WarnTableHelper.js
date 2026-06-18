export default {
	/* Self-contained "Show as a Table" / Export data source for the Warnings-over-Time charts.
	   It reads fetch_warnings.data directly and only the NON-trigger slicers (Warning/Resolved/
	   Utility/Location). It deliberately does NOT reference BillHealthHelper or the Severity/Date
	   widgets — those run fetch_warnings, and mixing a query's .run trigger with its .data in one
	   JSObject trips Appsmith's reactive-dependency-misuse check. */

	_cat(msg) {
		const m = String(msg || '');
		if (/unit cost/i.test(m) && /higher than/i.test(m)) return 'Unit cost > 10% higher than prior bill';
		if (/charge/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Charges are out of range (warning)';
		if (/(consumption|volume)/i.test(m) && /(out of range|not within|expected range)/i.test(m)) return 'Volume is out of range (warning)';
		return 'Other';
	},

	_util(msg, fallback) {
		const m = String(msg || '').match(/\[([^\]]+)\]/);
		if (m) {
			const parts = m[1].split('/').map(s => s.trim());
			const last = (parts[parts.length - 1] || '').toUpperCase();
			if (/^(NATURALGAS|NATURAL GAS|GAS|ELECTRIC|ELECTRICITY|WATER|SEWER|STEAM|SOLAR)$/.test(last)) return last;
		}
		return String(fallback || '').toUpperCase();
	},

	_resolved(ws) {
		const w = String(ws || '').toLowerCase();
		if (!w) return 'No';
		if (/resolv|clos|done|complete|paid|approved/.test(w)) return 'Yes';
		return 'No';
	},

	_parse(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; },

	_monthLabel(mk) {
		const names = ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
		const mi = parseInt(mk.slice(5, 7), 10) - 1;
		return mk.slice(0, 4) + ' ' + (names[mi] || '');
	},

	/* Only the JS-side Warnings slicers (these do NOT run the query). */
	_multi(name) {
		try {
			const reg = {
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

	/* Mapped + slicer-filtered warning rows (severity/date are already applied server-side). */
	_rows() {
		const data = (typeof fetch_warnings !== 'undefined' && Array.isArray(fetch_warnings.data)) ? fetch_warnings.data : [];
		let rows = data.map(r => ({
			pearId: r.pear_id || '',
			warning: r.bill_warning || '',
			amount: Number(r.total_amount) || 0,
			vendor: r.vendor || '',
			invoiceDateRaw: r.invoice_date_raw || '',
			category: r.category || this._cat(r.bill_warning || ''),
			utility: this._util(r.bill_warning, r.utility_type),
			resolved: this._resolved(r.workflow_state),
			location: r.location || r.billing_id || ''
		}));
		const cat = this._multi('WOWarningSelect'); if (cat.length) rows = rows.filter(r => cat.includes(r.category));
		const res = this._multi('WOResolvedSelect'); if (res.length) rows = rows.filter(r => res.includes(r.resolved));
		const util = this._multi('WOUtilitySelect'); if (util.length) rows = rows.filter(r => util.includes(r.utility));
		const loc = this._multi('WOLocationSelect'); if (loc.length) rows = rows.filter(r => loc.includes(r.location));
		return rows;
	},

	/* Pivot: one row per month, Total Amount (or Count) + Vendor per warning category.
	   Utility fan-out is collapsed (dedupe by pear_id + message). */
	_tableData(metric) {
		const cats = ['Charges are out of range (warning)', 'Unit cost > 10% higher than prior bill', 'Volume is out of range (warning)'];
		const valLabel = metric === 'amount' ? 'Total Amount' : 'Count';
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
			if (!byMonth[mk][c]) byMonth[mk][c] = { val: 0, vendors: {} };
			byMonth[mk][c].val += (metric === 'amount' ? r.amount : 1);
			if (r.vendor) byMonth[mk][c].vendors[r.vendor] = true;
		});
		return Object.keys(byMonth).sort().map(mk => {
			const row = { 'Year, Month': this._monthLabel(mk) };
			cats.forEach(c => {
				const cell = byMonth[mk][c];
				row[c + ' — ' + valLabel] = cell ? (metric === 'amount' ? cell.val.toFixed(2) : String(cell.val)) : '';
				row[c + ' — Vendor'] = cell ? Object.keys(cell.vendors).join(', ') : '';
			});
			return row;
		});
	},

	getBillsTable() { return this._tableData('amount'); },

	getCountTable() { return this._tableData('count'); }
}
