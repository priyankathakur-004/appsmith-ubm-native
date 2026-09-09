export default {

	/* Portfolio view model.
	   Covers legacy reports 01 Overview, 02 Rank of Locations and 07 Utility Tree.
	   Report 08 Location Details has no page of its own in the prototype; its content is
	   served here as the location drill-down payload behind a row click. */

	model() {
		const M = EA_Measures;
		const rows = M.rows();
		if (!rows.length) return { empty: true, kpis: [], ranked: [], series: [], breakdown: [], tree: [], markers: [] };

		const split = M.priorPeriodSplit(rows);
		const totalCharges = rows.reduce((a, r) => a + M.chargesOf(r), 0);
		const totalCons    = rows.reduce((a, r) => a + M.consumptionOf(r), 0);

		return {
			empty: false,
			kpis: this._kpis(rows, split, totalCharges, totalCons),
			markers: this.markers(),
			ranked: this.ranked(),
			series: this.chargesOverTime(),
			breakdown: this.costBreakdown(),
			tree: this.utilityTree()
		};
	},

	_kpis(rows, split, totalCharges, totalCons) {
		const M = EA_Measures;
		const d = (a, b) => split ? M.delta(a, b) : null;
		const headline = M.consumptionHeadline(rows);

		/* Locations reporting: the participation figure the prototype shows on Portfolio.
		   It is the share of the account's locations that produced at least one bill row in
		   the window — the same idea as legacy report 16, computed over the loaded rows. */
		const reporting = new Set(rows.map(r => r.location_id).filter(v => v != null));
		const known = this._knownLocationCount() || reporting.size;

		return [
			{ key: 'charges', icon: '$', tone: '', label: 'Total Charges',
			  value: M.fmtMoney(totalCharges),
			  delta: split ? d(split.current.charges, split.prior.charges) : null,
			  note: 'vs prior period' },
			{ key: 'consumption', icon: 'ϟ', tone: 'teal', label: 'Energy Consumption',
			  value: M.fmtNum(headline.value) + ' ' + headline.unit,
			  delta: split
			  	? (headline.basis === 'mmbtu'
			  		? d(split.current.mmbtu, split.prior.mmbtu)
			  		: d(split.current.consumption, split.prior.consumption))
			  	: null,
			  note: 'vs prior period' },
			{ key: 'unitcost', icon: '◇', tone: 'purple', label: 'Unit Cost',
			  value: totalCons ? '$' + (totalCharges / totalCons).toFixed(3) : '—',
			  delta: (split && split.prior.consumption && split.current.consumption)
			  	? M.delta(split.current.charges / split.current.consumption, split.prior.charges / split.prior.consumption)
			  	: null,
			  note: 'vs prior period' },
			{ key: 'participation', icon: '▥', tone: 'warn', label: 'Locations Reporting',
			  value: reporting.size + ' / ' + known,
			  delta: null,
			  note: known ? (reporting.size / known * 100).toFixed(0) + '% participation' : '' }
		];
	},

	/* Total locations on the account, from the lookup query rather than from the filtered
	   rows — otherwise participation would always read 100%. */
	_knownLocationCount() {
		try { return (fetch_locations.data || []).length; } catch (e) { return 0; }
	},

	/* ---------------- portfolio map ---------------- */

	markers() {
		const M = EA_Measures, by = {};
		M.rows().forEach(r => {
			const lat = Number(r.latitude), lng = Number(r.longitude);
			if (!lat || !lng) return;
			const k = r.location_id;
			if (!by[k]) by[k] = {
				id: k, title: r.location_description || 'Unknown',
				city: r.city || '', state: r.state || '',
				lat: lat, long: lng, charges: 0, consumption: 0
			};
			by[k].charges     += M.chargesOf(r);
			by[k].consumption += M.consumptionOf(r);
		});
		return Object.values(by).sort((a, b) => b.charges - a.charges);
	},

	/* ---------------- ranked locations ---------------- */

	/* Metric toggle mirrors legacy report 02, plus the prototype's Variance column.
	   Variance here is the later-half vs earlier-half change in charges for that location —
	   the same prior-period split the KPI strip uses. There is no stored variance column
	   in UBM to read instead. */
	ranked() {
		const M = EA_Measures;
		const rows = M.rows();
		const ms = M.months(rows);
		if (!ms.length) return [];
		const cut = Math.ceil(ms.length / 2);
		const prior = new Set(ms.slice(0, cut));
		const current = new Set(ms.slice(cut));

		const by = {};
		rows.forEach(r => {
			const k = r.location_description || 'Unknown';
			if (!by[k]) by[k] = { location: k, location_id: r.location_id, charges: 0, consumption: 0, sqft: Number(r.square_feet) || 0, cur: 0, pri: 0 };
			const c = M.chargesOf(r);
			by[k].charges     += c;
			by[k].consumption += M.consumptionOf(r);
			const mk = M.monthKey(r);
			if (current.has(mk)) by[k].cur += c;
			else if (prior.has(mk)) by[k].pri += c;
		});

		return Object.values(by).map(v => {
			v.variance = M.delta(v.cur, v.pri);
			v.unitCost = v.consumption ? v.charges / v.consumption : null;
			return v;
		}).sort((a, b) => b.charges - a.charges);
	},

	/* ---------------- charges over time ---------------- */

	/* Current series plus the same months a year earlier, which is the prototype's
	   "Current / Prior year" pair. */
	chargesOverTime() {
		const M = EA_Measures;
		const rows = M.rows();
		const by = M.groupBy(rows, r => M.monthKey(r));
		const ms = Object.keys(by).sort();

		return ms.map(k => {
			const p = String(parseInt(k.slice(0, 4), 10) - 1) + k.slice(4);
			return {
				month: k,
				label: M.monthLabel(k),
				charges: by[k].charges,
				consumption: by[k].consumption,
				priorCharges: by[p] ? by[p].charges : null
			};
		});
	},

	/* ---------------- cost breakdown ---------------- */

	/* Split by utility type. The seven total_charges_* component columns are the charge-type
	   split and belong to the Cost view; Portfolio's donut is the utility split. */
	costBreakdown() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => r.utility_type || 'Unknown');
		const total = Object.values(by).reduce((a, v) => a + v.charges, 0);
		return Object.values(by)
			.map(v => ({ name: v.key, charges: v.charges, pct: total ? v.charges / total * 100 : 0 }))
			.sort((a, b) => b.charges - a.charges);
	},

	/* ---------------- utility hierarchy ---------------- */

	/* Utility -> vendor -> account, from fetch_utility_tree_data (legacy report 07), which
	   resolves vendor pretty names that fetch_analytics_data does not carry. */
	utilityTree() {
		let raw = [];
		try { raw = fetch_utility_tree_data.data || []; } catch (e) { raw = []; }
		if (!raw.length) return [];

		const root = {};
		raw.forEach(r => {
			const u = r.utility_type || 'Unknown';
			const v = r.vendor_name || 'Unknown';
			const a = r.service_account || r.meter || 'Unknown';
			const c = Number(r.total_charges) || 0;
			if (!root[u]) root[u] = { name: u, charges: 0, children: {} };
			root[u].charges += c;
			if (!root[u].children[v]) root[u].children[v] = { name: v, charges: 0, children: {} };
			root[u].children[v].charges += c;
			if (!root[u].children[v].children[a]) root[u].children[v].children[a] = { name: a, charges: 0 };
			root[u].children[v].children[a].charges += c;
		});

		const flatten = n => ({
			name: n.name, charges: n.charges,
			children: Object.values(n.children || {}).sort((a, b) => b.charges - a.charges).map(flatten)
		});
		return Object.values(root).sort((a, b) => b.charges - a.charges).map(flatten);
	}
}
