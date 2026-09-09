export default {

	/* Exceptions view model.
	   Covers legacy reports 18 Notifications, 19 Warnings Overview, 20 Warnings over Time,
	   21 Impacted Locations and 22 Late Fees.

	   This JSObject also carries the two SQL fragments the warnings query interpolates into
	   its WHERE clause. Those two functions must read ONLY widgets — never that query's own
	   rows — or the query would depend on itself and the page would not load.
	   (The query is named indirectly on purpose: entity names in comments can register as
	   dependencies, and these two functions must stay clear of it.) */

	/* ================= SQL fragments (widget-only) ================= */

	_severityClause(label) {
		if (label === 'Low') return 'w.bill_warning_severity <= 20';
		if (label === 'Medium') return 'w.bill_warning_severity = 30';
		if (label === 'High') return 'w.bill_warning_severity >= 40';
		return '';
	},

	/* Server-side severity filter for the warnings query. A bill is bucketed by its MAX
	   warning severity (Low <=20 / Medium =30 / High >=40).

	   Defaults to Medium when nothing is selected — this is the UBM "Medium" report view, and
	   changing the default will move every Exceptions number away from the legacy report.

	   Reads EASeveritySelect DIRECTLY rather than through a shared getter, because a shared
	   getter would touch other slicers whose own options come from the very query this
	   clause is being built for. */
	warnSeveritySql() {
		let sel = [];
		try {
			if (typeof EASeveritySelect !== 'undefined' && Array.isArray(EASeveritySelect.selectedOptionValues)) {
				sel = EASeveritySelect.selectedOptionValues;
			}
		} catch (e) { sel = []; }
		const labels = sel.length ? sel : ['Medium'];
		const parts = labels.map(l => this._severityClause(l)).filter(Boolean);
		if (!parts.length) return '';
		return 'AND (' + parts.join(' OR ') + ')';
	},

	/* Invoice-date window for the warnings query, from the shared page date control. */
	warnDateSql() {
		try {
			const s = EA_DateWindow.start();
			const e = EA_DateWindow.end();
			if (!s || !e) return '';
			return "AND w.invoice_date >= '" + s + "' AND w.invoice_date < '" + e + "'";
		} catch (err) { return ''; }
	},

	/* ================= view model ================= */

	model() {
		const warnings = this.warnings();
		return {
			empty: !warnings.length,
			kpis: this.kpis(warnings),
			overTime: this.overTime(warnings),
			queue: this.queue(warnings),
			impacted: this.impactedLocations(warnings),
			lateFees: this.lateFees(),
			gaps: this.gaps()
		};
	},

	_severityLabel(v) {
		const n = Number(v) || 0;
		if (n >= 40) return 'Critical';
		if (n === 30) return 'Warning';
		return 'Info';
	},

	warnings() {
		let raw = [];
		try { raw = fetch_warnings.data || []; } catch (e) { raw = []; }
		return raw.map(r => ({
			id: r.warning_id,
			message: r.bill_warning || '',
			severity: this._severityLabel(r.severity),
			severityValue: Number(r.severity) || 0,
			category: r.category || 'Uncategorised',
			workflowState: r.workflow_state || '',
			resolvable: this._resolved(r.resolvable),
			location: r.location || 'Unknown',
			utility: r.utility_type || '',
			vendor: r.vendor || '',
			billId: r.pear_id,
			billingId: r.billing_id,
			date: r.invoice_date || '',
			dateRaw: r.invoice_date_raw || '',
			amount: Number(r.total_amount) || 0,
			latitude: Number(r.latitude) || null,
			longitude: Number(r.longitude) || null
		}));
	},

	/* Resolved comes from the definition view's `resolvable` column, with a
	   workflow_state-style fallback for rows the view does not cover. */
	_resolved(v) {
		const w = String(v == null ? '' : v).toLowerCase().trim();
		if (w === 'yes' || w === 'true' || w === 'y' || w === '1') return 'Yes';
		if (w === 'no' || w === 'false' || w === 'n' || w === '0') return 'No';
		if (/resolv|clos|done|complete|paid|approved/.test(w)) return 'Yes';
		return 'No';
	},

	kpis(warnings) {
		const M = EA_Measures;
		const open = warnings.filter(w => w.resolvable !== 'Yes');
		const critical = open.filter(w => w.severity === 'Critical');
		const locations = new Set(open.map(w => w.location)).size;
		const exposure = open.reduce((a, w) => a + w.amount, 0);

		return [
			{ key: 'open', icon: '⚠', tone: 'warn', label: 'Open Exceptions',
			  value: M.fmtNum(open.length), delta: null, note: warnings.length + ' total in window' },
			{ key: 'critical', icon: '!', tone: 'warn', label: 'Critical',
			  value: M.fmtNum(critical.length), delta: null, note: 'severity 40+' },
			{ key: 'locations', icon: '⌖', tone: '', label: 'Impacted Locations',
			  value: M.fmtNum(locations), delta: null, note: 'with an open exception' },
			{ key: 'exposure', icon: '$', tone: 'teal', label: 'Financial Exposure',
			  value: M.fmtMoney(exposure), delta: null, note: 'billed amount on flagged bills' }
		];
	},

	/* Stacked severity counts per month (legacy report 20). */
	overTime(warnings) {
		const M = EA_Measures;
		const by = {};
		warnings.forEach(w => {
			const k = String(w.dateRaw || '').slice(0, 7);
			if (k.length !== 7) return;
			if (!by[k]) by[k] = { month: k, Critical: 0, Warning: 0, Info: 0, amount: 0 };
			by[k][w.severity] += 1;
			by[k].amount += w.amount;
		});
		return Object.keys(by).sort().map(k => ({
			month: k, label: M.monthLabel(k),
			Critical: by[k].Critical, Warning: by[k].Warning, Info: by[k].Info,
			amount: by[k].amount
		}));
	},

	/* The "Needs attention" triage queue: open exceptions, worst first.
	   Owner and Status are prototype columns with no source — see gaps(). */
	queue(warnings) {
		const rank = { Critical: 0, Warning: 1, Info: 2 };
		return warnings
			.filter(w => w.resolvable !== 'Yes')
			.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.amount - a.amount))
			.slice(0, 50)
			.map(w => ({
				id: w.id, title: w.message, severity: w.severity,
				location: w.location, category: w.category,
				amount: w.amount, date: w.date, billId: w.billId,
				workflowState: w.workflowState
			}));
	},

	impactedLocations(warnings) {
		const by = {};
		warnings.filter(w => w.resolvable !== 'Yes').forEach(w => {
			const k = w.location;
			if (!by[k]) by[k] = { location: k, open: 0, critical: 0, amount: 0, latitude: w.latitude, longitude: w.longitude };
			by[k].open += 1;
			if (w.severity === 'Critical') by[k].critical += 1;
			by[k].amount += w.amount;
		});
		return Object.values(by).sort((a, b) => (b.critical - a.critical) || (b.amount - a.amount));
	},

	/* Late fee exposure (legacy report 22), from analytics_billing_line_items.

	   fetch_late_fees already pins bill_type = 'live'; workflow_state = 'processed' is applied
	   here so unfinalised bills do not inflate the total past what UBM reports. Both filters
	   must stay — dropping either roughly doubles the figure. */
	lateFees() {
		let raw = [];
		try { raw = fetch_late_fees.data || []; } catch (e) { raw = []; }
		const rows = raw.filter(r => String(r.workflow_state || '').toLowerCase() === 'processed');

		const gross = rows.reduce((a, r) => a + (Number(r.late_fee) || 0), 0);
		const recouped = rows.reduce((a, r) => a + (Number(r.recouped_late_fee) || 0), 0);
		const net = rows.reduce((a, r) => a + (Number(r.net_late_fee) || 0), 0);

		const byLoc = {};
		rows.forEach(r => {
			const fee = Number(r.net_late_fee) || 0;
			if (!fee) return;
			const k = r.location || 'Unknown';
			byLoc[k] = (byLoc[k] || 0) + fee;
		});

		return {
			gross: gross, recouped: recouped, net: net,
			bills: rows.filter(r => (Number(r.net_late_fee) || 0) !== 0).length,
			excluded: raw.length - rows.length,
			byLocation: Object.keys(byLoc)
				.map(k => ({ location: k, fee: byLoc[k] }))
				.sort((a, b) => b.fee - a.fee)
				.slice(0, 10)
		};
	},

	/* Bill comments, the closest thing UBM has to the prototype's notification feed
	   (legacy report 18). Source is activity_history type = manual_comment. */
	notifications() {
		let raw = [];
		try { raw = fetch_notifications.data || []; } catch (e) { raw = []; }
		return raw.map(r => ({
			billId: r.bill_id, location: r.location || '',
			text: r.text || '', user: r.user_name || '',
			createdAt: r.created_at, workflowState: r.workflow_state || ''
		}));
	},

	/* Prototype elements on this screen with no source in UBM today. */
	gaps() {
		return [
			{ field: 'Owner / Assignee', note: 'bill_warnings carries no assignee column; the prototype names a person per row.' },
			{ field: 'Status (Active / Monitoring)', note: 'No exception status table. Resolvable yes/no from the definition view is the nearest signal.' },
			{ field: 'Resolve action', note: 'Read-only today. Resolving a warning would need a write path UBM does not expose here.' },
			{ field: 'Tagged recipient', note: 'No notifications or tags table; comments carry an author but no addressee.' }
		];
	}
}
