export default {

	/* Cost & Forecast view model.
	   Covers legacy reports 11 Unit Cost, 12 Charges, 13 Charges Forecast and
	   15 Charges vs Consumption. */

	model() {
		const M = EA_Measures;
		const rows = M.rows();
		if (!rows.length) return { empty: true, kpis: [], series: [], forecast: [], composition: [], unitCostByLocation: [], drivers: [] };

		return {
			empty: false,
			kpis: this._kpis(rows),
			series: this.chargesVsConsumption(),
			forecast: this.forecast(),
			composition: this.composition(),
			unitCostByLocation: this.unitCostByLocation(),
			drivers: this.costDrivers()
		};
	},

	_kpis(rows) {
		const M = EA_Measures;
		const split = M.priorPeriodSplit(rows);
		const charges = rows.reduce((a, r) => a + M.chargesOf(r), 0);
		const cons    = rows.reduce((a, r) => a + M.consumptionOf(r), 0);
		const fc = this.forecastSummary();

		return [
			{ key: 'charges', icon: '$', tone: '', label: 'Total Charges',
			  value: M.fmtMoney(charges),
			  delta: split ? M.delta(split.current.charges, split.prior.charges) : null, note: 'vs prior period' },
			{ key: 'unitcost', icon: '⌁', tone: 'teal', label: 'Unit Cost',
			  value: cons ? '$' + (charges / cons).toFixed(3) : '—',
			  delta: (split && split.prior.consumption && split.current.consumption)
			  	? M.delta(split.current.charges / split.current.consumption, split.prior.charges / split.prior.consumption)
			  	: null, note: 'vs prior period' },
			{ key: 'forecast', icon: '↗', tone: 'purple', label: 'Forecasted Charges',
			  value: fc.total == null ? '—' : M.fmtMoney(fc.total),
			  delta: null, note: fc.note },
			{ key: 'variance', icon: '↕', tone: 'warn', label: 'Cost Variance',
			  value: fc.variance == null ? '—' : M.fmtMoney(Math.abs(fc.variance)),
			  delta: fc.variancePct, note: fc.variance == null ? 'Needs 24 months of history' : 'actual vs forecast' }
		];
	},

	/* ---------------- charges vs consumption ---------------- */

	chargesVsConsumption() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => M.monthKey(r));
		return Object.keys(by).sort().map(k => ({
			month: k, label: M.monthLabel(k),
			charges: by[k].charges,
			consumption: by[k].consumption,
			unitCost: by[k].consumption ? by[k].charges / by[k].consumption : null
		}));
	},

	/* ---------------- forecast ---------------- */

	/* Seasonal-average forecast, the same approach as legacy report 13: for each calendar
	   month, average that month's history and grow it by the trend between the last two
	   full years. There is no forecast table in UBM to read — this is computed in the
	   browser, and the confidence band is the spread of the historical months behind it. */
	_seasonalForecast(history, horizon) {
		if (!history.length) return [];

		const byCal = {};
		history.forEach(h => {
			const cal = h.month.slice(5, 7);
			(byCal[cal] = byCal[cal] || []).push(h.charges);
		});

		const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
		const overall = mean(history.map(h => h.charges));

		/* Year-over-year growth from the most recent 12 months against the 12 before them. */
		let growth = 1;
		if (history.length >= 24) {
			const last12 = history.slice(-12).reduce((a, h) => a + h.charges, 0);
			const prev12 = history.slice(-24, -12).reduce((a, h) => a + h.charges, 0);
			if (prev12) growth = last12 / prev12;
		}
		growth = Math.max(0.5, Math.min(1.5, growth));

		const lastKey = history[history.length - 1].month;
		let y = parseInt(lastKey.slice(0, 4), 10);
		let mo = parseInt(lastKey.slice(5, 7), 10);

		const out = [];
		for (let i = 0; i < horizon; i++) {
			mo += 1;
			if (mo > 12) { mo = 1; y += 1; }
			const cal = String(mo).padStart(2, '0');
			const bucket = byCal[cal] || [];
			const base = bucket.length ? mean(bucket) : overall;
			const value = base * growth;
			/* Band = one standard deviation of that calendar month's history. */
			const sd = bucket.length > 1
				? Math.sqrt(mean(bucket.map(v => Math.pow(v - base, 2))))
				: base * 0.15;
			out.push({
				month: y + '-' + cal,
				label: EA_Measures.monthLabel(y + '-' + cal),
				charges: value, low: Math.max(0, value - sd), high: value + sd, forecast: true
			});
		}
		return out;
	},

	forecast() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => M.monthKey(r));
		const history = Object.keys(by).sort().map(k => ({
			month: k, label: M.monthLabel(k), charges: by[k].charges, forecast: false
		}));
		return history.concat(this._seasonalForecast(history, 6));
	},

	/* Forecast KPI plus the variance the prototype shows.

	   NEW on this page. Legacy report 13 produces forecast values but nothing compares them
	   with what was actually billed, so there is no legacy variance number to reconcile
	   against. Method: hold out the most recent 12 months, forecast them from the history
	   before that, and compare with what those months actually billed. That needs 24 months
	   of loaded history; with less, the variance reads as unavailable rather than guessing. */
	forecastSummary() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => M.monthKey(r));
		const history = Object.keys(by).sort().map(k => ({ month: k, charges: by[k].charges }));

		const ahead = this._seasonalForecast(history, 6);
		const total = ahead.length ? ahead.reduce((a, h) => a + h.charges, 0) : null;
		const note = ahead.length ? 'next ' + ahead.length + ' months' : 'No history to project';

		if (history.length < 24) {
			return { total: total, note: note, variance: null, variancePct: null };
		}

		const holdout = history.slice(-12);
		const backtest = this._seasonalForecast(history.slice(0, -12), 12);
		const predicted = backtest.reduce((a, h) => a + h.charges, 0);
		const actual = holdout.reduce((a, h) => a + h.charges, 0);
		const variance = actual - predicted;

		return {
			total: total, note: note,
			variance: variance,
			variancePct: predicted ? (variance / predicted) * 100 : null
		};
	},

	/* ---------------- charge composition ---------------- */

	/* The seven charge components come from the analytics_monthly_feed side-join in
	   fetch_analytics_data, not from the usage table. A component that is zero across the
	   whole window is dropped rather than drawn as an empty bar. */
	composition() {
		const rows = EA_Measures.rows();
		const parts = [
			{ key: 'total_charges_commodity',    name: 'Supply' },
			{ key: 'total_charges_consumption',  name: 'Delivery' },
			{ key: 'total_charges_demand',       name: 'Demand' },
			{ key: 'total_charges_generation',   name: 'Generation' },
			{ key: 'total_charges_customer',     name: 'Customer' },
			{ key: 'total_charges_taxes',        name: 'Taxes' },
			{ key: 'total_charges_other',        name: 'Other' }
		];
		const totals = parts.map(p => ({
			name: p.name,
			charges: rows.reduce((a, r) => a + (Number(r[p.key]) || 0), 0)
		})).filter(p => p.charges !== 0);

		const sum = totals.reduce((a, p) => a + p.charges, 0);
		return totals
			.map(p => ({ name: p.name, charges: p.charges, pct: sum ? p.charges / sum * 100 : 0 }))
			.sort((a, b) => b.charges - a.charges);
	},

	/* ---------------- unit cost ---------------- */

	unitCostByLocation() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => r.location_description || 'Unknown');
		return Object.values(by)
			.filter(v => v.consumption > 0)
			.map(v => ({ location: v.key, charges: v.charges, consumption: v.consumption, unitCost: v.charges / v.consumption }))
			.sort((a, b) => b.unitCost - a.unitCost);
	},

	/* Cost drivers: charges against consumption per location, with the least-squares line.
	   A location above the line costs more than its consumption predicts. */
	costDrivers() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => r.location_description || 'Unknown');
		const pts = Object.values(by)
			.filter(v => v.consumption > 0 && v.charges > 0)
			.map(v => ({ location: v.key, x: v.consumption, y: v.charges }));

		const fit = M.linearFit(pts);
		return {
			points: pts.map(p => ({
				location: p.location, x: p.x, y: p.y,
				expected: fit ? fit.intercept + fit.slope * p.x : null,
				above: fit ? p.y > (fit.intercept + fit.slope * p.x) : null
			})),
			fit: fit
		};
	}
}
