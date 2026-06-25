export default {
	/* read a multi-select's values (guarded for import order) */
	_multi(w) {
		try { const v = w && w.selectedOptionValues; return Array.isArray(v) ? v : []; }
		catch (e) { return []; }
	},

	/* Map the expected-bills view rows to the Late Bills table shape. */
	_rawBills() {
		const data = (typeof fetch_late_bills !== 'undefined' && Array.isArray(fetch_late_bills.data)) ? fetch_late_bills.data : [];
		return data.map(r => ({
			daysLate: r.days_late,
			lastInvoiceDate: r.last_bill_invoice_date || '',
			billingAccount: r.billing_account || '',
			location: r.location || '',
			accountStatus: r.account_status || '',
			utility: r.utility_type || '',
			lastBillType: r.last_bill_type || '',
			lastDueDate: r.last_bill_due_date || '',
			daysOfService: r.days_of_service,
			expectedArrival: r.expected_bill_arrival || '',
			expectedDueDate: r.expected_bill_due_date || '',
			daysToNext: r.days_to_next_expected_due_date,
			meterId: r.meter_id || '',
			said: r.said || '',
			vendor: r.vendor || ''
		}));
	},

	/* Match a selection against a comma-joined cell (utility/location/vendor are aggregated per account). */
	_hasAny(cell, selected) {
		if (!selected.length) return true;
		const parts = String(cell || '').split(',').map(s => s.trim());
		return selected.some(s => parts.indexOf(s) !== -1);
	},

	/* UBM Days-Late bucket from the numeric days_late. */
	_daysLateBucket(d) {
		if (d == null) return 'unknown';
		if (d < 0) return 'notlate';
		if (d <= 7) return '0-7';
		if (d <= 15) return '8-15';
		return '>15';
	},

	/* UBM Days-to-Next-Due bucket (negative = overdue → "5 days or less"). */
	_daysToNextBucket(d) {
		if (d == null) return null;
		if (d <= 5) return '<=5';
		if (d <= 10) return '6-10';
		return '>10';
	},

	/* Apply the Bill Health filters: Account Status / Utility / Location / Vendor +
	   the UBM-specific Bill Type / Days Late / Days to Next Due Date. */
	_applyFilters(rows) {
		const acct = this._multi(typeof BHAcctStatusSelect !== 'undefined' ? BHAcctStatusSelect : null);
		const util = this._multi(typeof BHUtilitySelect !== 'undefined' ? BHUtilitySelect : null);
		const loc = this._multi(typeof BHLocationSelect !== 'undefined' ? BHLocationSelect : null);
		const vend = this._multi(typeof BHVendorSelect !== 'undefined' ? BHVendorSelect : null);
		const bt = this._multi(typeof BHBillTypeSelect !== 'undefined' ? BHBillTypeSelect : null);
		const dl = this._multi(typeof BHDaysLateSelect !== 'undefined' ? BHDaysLateSelect : null);
		const dn = this._multi(typeof BHDaysToNextSelect !== 'undefined' ? BHDaysToNextSelect : null);
		return rows.filter(r => {
			if (acct.length && acct.indexOf(r.accountStatus) === -1) return false;
			if (!this._hasAny(r.utility, util)) return false;
			if (!this._hasAny(r.location, loc)) return false;
			if (!this._hasAny(r.vendor, vend)) return false;
			if (!this._hasAny(r.lastBillType, bt)) return false;
			if (dl.length && dl.indexOf(this._daysLateBucket(r.daysLate)) === -1) return false;
			if (dn.length && dn.indexOf(this._daysToNextBucket(r.daysToNext)) === -1) return false;
			return true;
		});
	},

	getBills() { return this._applyFilters(this._rawBills()); },

	/* Display rows for the table / export / show-as-table. */
	getBillsTableData() {
		return this.getBills().map(r => ({
			'Days Late': r.daysLate,
			'Last Bill Invoice Date': r.lastInvoiceDate,
			'Billing Account': r.billingAccount,
			'Location': r.location,
			'Account Status': r.accountStatus,
			'Utility Type': r.utility,
			'Last Bill Type': r.lastBillType,
			'Last Bill Due Date': r.lastDueDate,
			'Days of Service': r.daysOfService,
			'Expected Bill Arrival': r.expectedArrival,
			'Expected Bill Due Date': r.expectedDueDate,
			'Days To Next Expected Due Date': r.daysToNext,
			'Meter ID': r.meterId,
			'SAID': r.said,
			'Vendor': r.vendor
		}));
	}
}
