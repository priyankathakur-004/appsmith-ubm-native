export default {

	/* Bill Health view model.
	   Covers legacy reports 16 Invoice Participation, 17 Missing Invoice Data,
	   23 Late Bills, 24 Received Bills Details, 25 Received Bills per Location
	   and 26 Rate Codes. */

	model() {
		const matrix = this.matrix();
		return {
			empty: !matrix.rows.length,
			kpis: this.kpis(matrix),
			matrix: matrix,
			summary: this.summary(matrix),
			inventory: this.inventory(),
			rateCodes: this.rateCodes()
		};
	},

	/* ---------------- coverage matrix ---------------- */

	/* The account grain is location + service account + meter + utility + bill type, matching
	   BH_BillHealthHelper._buildRows on the Analytics page. Keeping the same key is what makes
	   the participation figure here agree with legacy report 16. */
	_key(r) {
		return [r.location_description, r.service_account, r.meter, r.utility_type, r.bill_type].join('||');
	},

	_blank(r) {
		return {
			location: r.location_description || '', account: r.service_account || '',
			meter: r.meter || '', utility: r.utility_type || '',
			billType: r.bill_type || '', vendor: r.vendor_name || '',
			months: {}, monthDays: {}
		};
	},

	matrix() {
		const M = EA_Measures;
		const rows = M.rows();
		const map = {};

		rows.forEach(r => {
			const k = this._key(r);
			if (!map[k]) map[k] = this._blank(r);
			const mk = M.monthKey(r);
			if (mk.length === 7) {
				map[k].months[mk] = (map[k].months[mk] || 0) + 1;
				/* Real billed days for the month, from analytics_monthly_feed.days_of_service.
				   A bill's service period can be shorter than the calendar month. */
				map[k].monthDays[mk] = Math.max(map[k].monthDays[mk] || 0, Number(r.days_of_service) || 0);
			}
		});

		/* Merge the all-time account roster so a service that billed nothing in the window
		   still appears as a row of misses instead of vanishing from the denominator. */
		let roster = [];
		try { roster = (fetch_bill_accounts && Array.isArray(fetch_bill_accounts.data)) ? fetch_bill_accounts.data : []; } catch (e) { roster = []; }
		roster.forEach(r => {
			const k = this._key(r);
			if (!map[k]) map[k] = this._blank(r);
		});

		const months = this.monthAxis();
		const list = Object.values(map).map(v => {
			const cells = months.map(mk => ({
				month: mk,
				label: M.monthLabel(mk),
				state: v.months[mk] ? 'received' : 'missing',
				days: v.monthDays[mk] || 0
			}));
			const received = cells.filter(c => c.state === 'received').length;

			/* %Last12Mo = billed service days over the last 12 months / 365, the figure the
			   UBM app reports. Days, not month counts, so a partial month scores partially. */
			const last12 = months.slice(-12);
			const days = last12.reduce((a, mk) => a + (v.monthDays[mk] || 0), 0);

			return {
				location: v.location, account: v.account, meter: v.meter,
				utility: v.utility, billType: v.billType, vendor: v.vendor,
				cells: cells, received: received, expected: months.length,
				pctLast12: Math.min(100, (days / 365) * 100)
			};
		});

		return {
			months: months.map(mk => ({ key: mk, label: M.monthLabel(mk) })),
			rows: this._applyClientFilters(list)
		};
	},

	/* Month columns for the matrix, from the loaded window. */
	monthAxis() {
		return EA_Measures.months(EA_Measures.rows());
	},

	/* Vendor and utility are filtered here rather than in SQL so their option lists keep
	   offering every value on the account instead of only the ones that survive the filter. */
	_applyClientFilters(list) {
		const sel = w => {
			try { const v = w && w.selectedOptionValues; return Array.isArray(v) ? v : []; } catch (e) { return []; }
		};
		const vendors = (typeof EAVendorSelect !== 'undefined') ? sel(EAVendorSelect) : [];
		const utils   = (typeof EABHUtilitySelect !== 'undefined') ? sel(EABHUtilitySelect) : [];

		return list.filter(r =>
			(!vendors.length || vendors.indexOf(r.vendor) >= 0) &&
			(!utils.length   || utils.indexOf(r.utility) >= 0)
		);
	},

	/* ---------------- KPIs and summary ---------------- */

	kpis(matrix) {
		const M = EA_Measures;
		const rows = matrix.rows;
		const expected = rows.reduce((a, r) => a + r.expected, 0);
		const received = rows.reduce((a, r) => a + r.received, 0);
		const missing = expected - received;
		const locations = new Set(rows.map(r => r.location).filter(Boolean)).size;

		return [
			{ key: 'participation', icon: '◔', tone: 'teal', label: 'Participation Rate',
			  value: expected ? M.fmtPct(received / expected * 100) : '—',
			  delta: null, note: locations + ' locations' },
			{ key: 'expected', icon: '▤', tone: '', label: 'Bills Expected',
			  value: M.fmtNum(expected), delta: null, note: rows.length + ' services' },
			{ key: 'received', icon: '✓', tone: 'teal', label: 'Bills Received',
			  value: M.fmtNum(received), delta: null, note: matrix.months.length + ' months in window' },
			{ key: 'missing', icon: '!', tone: 'warn', label: 'Missing or Late',
			  value: M.fmtNum(missing), delta: null,
			  note: expected ? M.fmtPct(missing / expected * 100) + ' of expected' : '' }
		];
	},

	summary(matrix) {
		const rows = matrix.rows;
		const expected = rows.reduce((a, r) => a + r.expected, 0);
		const received = rows.reduce((a, r) => a + r.received, 0);
		const missing = expected - received;
		const pct = n => expected ? (n / expected * 100) : 0;

		/* Received and Missing are the two states the usage table can prove. The prototype
		   also colours Late and Estimated; Late lives at virtual-account grain in
		   fetch_late_bills (legacy report 23) and is reported separately below, and
		   Estimated has no column in this model — see gaps(). */
		return {
			states: [
				{ name: 'Received', count: received, pct: pct(received) },
				{ name: 'Missing',  count: missing,  pct: pct(missing) }
			],
			late: this.lateSummary(),
			byMonth: matrix.months.map((m, i) => {
				const got = rows.filter(r => r.cells[i] && r.cells[i].state === 'received').length;
				return { month: m.key, label: m.label, received: got, expected: rows.length,
				         pct: rows.length ? got / rows.length * 100 : 0 };
			})
		};
	},

	/* Late bills, from fetch_late_bills (legacy report 23).
	   Grain is the VIRTUAL ACCOUNT, not the service account the matrix uses. That mirrors the
	   UBM Power BI model, and it means this count will not tie out against the matrix rows —
	   it is reported as its own number rather than folded into the participation maths. */
	lateSummary() {
		let raw = [];
		try { raw = fetch_late_bills.data || []; } catch (e) { raw = []; }
		if (!raw.length) return { available: false, count: 0, accounts: 0 };
		const late = raw.filter(r => Number(r.days_late) > 0);
		return {
			available: true,
			grain: 'virtual account',
			count: late.length,
			accounts: new Set(raw.map(r => r.billing_account)).size,
			/* Shaped like the inventory rows so the Late filter can list them beside
			   received bills. There is no meter on a virtual-account row. */
			rows: late.map(r => ({
				location: r.location || '',
				vendor: r.vendor || '',
				account: r.billing_account || '',
				period: String(r.date_of_last_bill || '').slice(0, 7),
				utility: r.utility_type || '',
				rateCode: '',
				status: 'Late'
			}))
		};
	},

	/* ---------------- bill inventory ---------------- */

	/* Received bill detail, from fetch_received_bills (legacy reports 24 and 25). */
	inventory() {
		let raw = [];
		try { raw = fetch_received_bills.data || []; } catch (e) { raw = []; }
		return raw.map(r => ({
			billId: r.bill_id,
			location: r.location || '',
			vendor: r.vendor || '',
			account: r.meter_id || '',
			utility: r.utility_type || '',
			billType: r.bill_type || '',
			accountStatus: r.account_status || '',
			period: r.invoice_month || '',
			date: r.invoice_date_raw || '',
			rateCode: r.rate_code || ''
		}));
	},

	/* Rate code distribution (legacy report 26). */
	rateCodes() {
		const by = {};
		this.inventory().forEach(b => {
			const k = b.rateCode || '(none)';
			by[k] = (by[k] || 0) + 1;
		});
		const total = Object.values(by).reduce((a, b) => a + b, 0);
		return Object.keys(by)
			.map(k => ({ code: k, count: by[k], pct: total ? by[k] / total * 100 : 0 }))
			.sort((a, b) => b.count - a.count);
	},

	/* Prototype elements on this screen with no source in UBM today. Surfaced in the model so
	   the view can label them instead of drawing an invented number. */
	gaps() {
		return [
			{ field: 'Estimated', note: 'No estimated-read flag in reports_customer_monthly_usage; the matrix shows received/missing only.' },
			{ field: 'Late (in matrix)', note: 'Late is virtual-account grain in fetch_late_bills and cannot be painted onto the per-account matrix.' }
		];
	}
}
