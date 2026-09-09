export default {

	/* Invoice-date window for the queries that filter on a statement/invoice date rather than
	   on m.time_period: fetch_late_fees, fetch_received_bills and fetch_late_bills.

	   Ported from BH_LFDateHelper / BH_LBDateHelper on the Analytics page, which are identical
	   apart from the widgets they read. The two are merged here because the prototype gives the
	   whole page a single date control instead of one per report.

	   Kept SEPARATE from the view-model JSObjects (which read the queries' .data) so the
	   query -> helper binding cannot form a cycle. Reads only the Date widgets. */

	_mode() { try { return (typeof EADateModeSelect !== 'undefined' && EADateModeSelect.selectedOptionValue) || 'Last'; } catch (e) { return 'Last'; } },
	_unitRaw() { try { return (typeof EADateUnitSelect !== 'undefined' && EADateUnitSelect.selectedOptionValue) || 'Months'; } catch (e) { return 'Months'; } },
	_num() { try { const n = parseInt(EADateNumInput.text, 10); return (n && n > 0) ? n : 13; } catch (e) { return 13; } },

	_fmt(d) {
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
	},

	/* [start, end) window from Mode (Last/Next/This) x Unit x Number. Mirrors the Power BI
	   relative date filter: a plain unit rolls from today; "(Calendar)" and "This" align to whole
	   Day/Week/Month/Year periods. end is EXCLUSIVE. */
	_bounds() {
		const mode = this._mode();
		const unitRaw = this._unitRaw();
		const n = this._num();
		if (!unitRaw || unitRaw === 'Select') return { start: '1900-01-01', end: '2999-01-01' };

		const calendar = /\(Calendar\)/.test(unitRaw) || mode === 'This';
		const unit = unitRaw.replace(' (Calendar)', '');

		const add = (d, k) => {
			const x = new Date(d);
			if (unit === 'Days') x.setDate(x.getDate() + k);
			else if (unit === 'Weeks') x.setDate(x.getDate() + k * 7);
			else if (unit === 'Years') x.setFullYear(x.getFullYear() + k);
			else x.setMonth(x.getMonth() + k);
			return x;
		};
		const periodStart = (d) => {
			const x = new Date(d);
			x.setHours(0, 0, 0, 0);
			if (unit === 'Weeks') x.setDate(x.getDate() - x.getDay());   // week starts Sunday
			else if (unit === 'Years') x.setMonth(0, 1);
			else if (unit === 'Months') x.setDate(1);
			return x;
		};

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		let start, end;

		if (mode === 'This') {
			start = periodStart(today);
			end = add(start, 1);
		} else if (mode === 'Next') {
			if (calendar) { const cur = periodStart(today); start = add(cur, 1); end = add(start, n); }
			else { start = today; end = add(today, n); }
		} else {  // Last
			if (calendar) { const cur = periodStart(today); end = cur; start = add(cur, -n); }
			else { start = add(today, -n); end = new Date(today); end.setDate(end.getDate() + 1); }  // include today
		}
		return { start: this._fmt(start), end: this._fmt(end) };
	},

	start() { return this._bounds().start; },
	end() { return this._bounds().end; }
}
