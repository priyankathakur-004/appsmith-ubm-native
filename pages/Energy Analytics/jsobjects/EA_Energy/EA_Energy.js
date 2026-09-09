export default {

	/* Energy Performance view model.
	   Covers legacy reports 03 Weather Sensitivity, 04 Energy Consumption,
	   05 Monthly Energy Consumption, 06 Over the Years, 09 Per Square Feet,
	   10 Monthly Electric Demand and 14 Consumption — seven Appsmith tabs collapsed
	   into the prototype's four: Trends / Demand / Intensity / Weather. */

	model() {
		const M = EA_Measures;
		const rows = M.rows();
		if (!rows.length) return { empty: true, kpis: [], trend: [], byUtility: [], intensity: [], scatter: [], drivers: null };

		return {
			empty: false,
			kpis: this._kpis(rows),
			trend: this.trend(),
			byUtility: this.byUtility(),
			intensity: this.intensity(),
			scatter: this.weatherScatter(),
			drivers: this.weatherNormalised()
		};
	},

	_kpis(rows) {
		const M = EA_Measures;
		const split = M.priorPeriodSplit(rows);
		const mmbtu = rows.reduce((a, r) => a + M.mmbtuOf(r), 0);
		const peak = this.peakDemand();
		const inten = this.intensitySummary();
		const fit = this._weatherFit();

		return [
			{ key: 'consumption', icon: 'ϟ', tone: '', label: 'Consumption',
			  value: M.fmtNum(mmbtu) + ' MMBtu',
			  delta: split ? M.delta(split.current.mmbtu, split.prior.mmbtu) : null, note: 'vs prior period' },
			{ key: 'demand', icon: '⌁', tone: 'purple', label: 'Peak Demand',
			  value: peak.value == null ? '—' : M.fmtNum(peak.value) + ' kW',
			  delta: peak.delta, note: peak.note },
			{ key: 'intensity', icon: '◉', tone: 'teal', label: 'Energy Intensity',
			  value: inten.value == null ? '—' : inten.value.toFixed(1) + ' kBtu/sq ft',
			  delta: inten.delta, note: inten.note },
			{ key: 'weather', icon: '☁', tone: '', label: 'Weather Correlation',
			  value: fit ? 'R² ' + fit.r2.toFixed(2) : '—',
			  delta: null, note: fit ? this._r2Label(fit.r2) : 'Not enough months' }
		];
	},

	_r2Label(r2) {
		if (r2 >= 0.7) return 'Strong correlation';
		if (r2 >= 0.4) return 'Moderate correlation';
		return 'Weak correlation';
	},

	/* ---------------- trends ---------------- */

	/* Monthly MMBtu with the same month a year earlier alongside it. */
	trend() {
		const M = EA_Measures;
		const by = M.groupBy(M.rows(), r => M.monthKey(r));
		return Object.keys(by).sort().map(k => {
			const p = String(parseInt(k.slice(0, 4), 10) - 1) + k.slice(4);
			return {
				month: k, label: M.monthLabel(k),
				mmbtu: by[k].mmbtu, consumption: by[k].consumption,
				priorMmbtu: by[p] ? by[p].mmbtu : null
			};
		});
	},

	/* Monthly MMBtu stacked by utility type. */
	byUtility() {
		const M = EA_Measures, rows = M.rows();
		const months = M.months(rows);
		const utils = Array.from(new Set(rows.map(r => r.utility_type || 'Unknown'))).sort();
		const cell = {};
		rows.forEach(r => {
			const k = M.monthKey(r) + '|' + (r.utility_type || 'Unknown');
			cell[k] = (cell[k] || 0) + M.mmbtuOf(r);
		});
		return {
			months: months.map(m => ({ key: m, label: M.monthLabel(m) })),
			utilities: utils,
			values: utils.map(u => months.map(m => cell[m + '|' + u] || 0))
		};
	},

	/* ---------------- demand ---------------- */

	/* Peak demand comes from fetch_demand_loadfactor (legacy report 10), the only report
	   that reads raw bill line items rather than the monthly usage rollup. Its rows are
	   therefore NOT filtered by EA_Filters.analyticsWhere() — that clause targets the
	   usage table — so its own SQL filters must stay in step with the shared filter bar. */
	peakDemand() {
		let raw = [];
		try { raw = fetch_demand_loadfactor.data || []; } catch (e) { raw = []; }
		if (!raw.length) return { value: null, delta: null, note: 'No demand data' };

		const M = EA_Measures;
		const byMonth = {};
		raw.forEach(r => {
			const k = String(r.time_period || '').slice(0, 7);
			const d = Number(r.demand) || 0;
			if (!k) return;
			byMonth[k] = Math.max(byMonth[k] || 0, d);
		});
		const ms = Object.keys(byMonth).sort();
		if (!ms.length) return { value: null, delta: null, note: 'No demand data' };

		const peak = Math.max.apply(null, ms.map(k => byMonth[k]));
		const cut = Math.ceil(ms.length / 2);
		const pri = ms.slice(0, cut).map(k => byMonth[k]);
		const cur = ms.slice(cut).map(k => byMonth[k]);
		const mx = a => a.length ? Math.max.apply(null, a) : 0;

		return {
			value: peak,
			delta: (pri.length && cur.length) ? M.delta(mx(cur), mx(pri)) : null,
			note: 'Peak of ' + ms.length + ' months'
		};
	},

	demandSeries() {
		let raw = [];
		try { raw = fetch_demand_loadfactor.data || []; } catch (e) { raw = []; }
		const M = EA_Measures, by = {};
		raw.forEach(r => {
			const k = String(r.time_period || '').slice(0, 7);
			if (!k) return;
			if (!by[k]) by[k] = { month: k, label: M.monthLabel(k), demand: 0, lf: [], };
			by[k].demand = Math.max(by[k].demand, Number(r.demand) || 0);
			const lf = Number(r.load_factor);
			if (lf) by[k].lf.push(lf);
		});
		return Object.keys(by).sort().map(k => ({
			month: k, label: by[k].label, demand: by[k].demand,
			loadFactor: by[k].lf.length ? by[k].lf.reduce((a, b) => a + b, 0) / by[k].lf.length : null
		}));
	},

	/* ---------------- intensity ---------------- */

	/* kBtu per square foot, per location. A location with blank square footage is dropped
	   rather than counted as zero — the same rule legacy report 09 applies. */
	intensity() {
		const M = EA_Measures, by = {};
		M.rows().forEach(r => {
			const sq = Number(r.square_feet) || 0;
			if (!sq) return;
			const k = r.location_description || 'Unknown';
			if (!by[k]) by[k] = { location: k, sqft: sq, mmbtu: 0 };
			by[k].mmbtu += M.mmbtuOf(r);
		});
		return Object.values(by)
			.map(v => ({ location: v.location, sqft: v.sqft, kbtuPerSqft: (v.mmbtu * 1000) / v.sqft }))
			.sort((a, b) => b.kbtuPerSqft - a.kbtuPerSqft);
	},

	intensitySummary() {
		const M = EA_Measures, rows = M.rows();
		const withSq = rows.filter(r => Number(r.square_feet) > 0);
		if (!withSq.length) return { value: null, delta: null, note: 'No square footage' };

		const sq = {};
		withSq.forEach(r => { sq[r.location_id] = Number(r.square_feet) || 0; });
		const totalSqft = Object.values(sq).reduce((a, b) => a + b, 0);
		if (!totalSqft) return { value: null, delta: null, note: 'No square footage' };

		const kbtu = withSq.reduce((a, r) => a + M.mmbtuOf(r), 0) * 1000;
		const ms = M.months(withSq);
		const cut = Math.ceil(ms.length / 2);
		const prior = new Set(ms.slice(0, cut)), current = new Set(ms.slice(cut));
		let c = 0, p = 0;
		withSq.forEach(r => {
			const k = M.monthKey(r);
			if (current.has(k)) c += M.mmbtuOf(r);
			else if (prior.has(k)) p += M.mmbtuOf(r);
		});

		const dropped = new Set(rows.filter(r => !(Number(r.square_feet) > 0)).map(r => r.location_id)).size;
		return {
			value: kbtu / totalSqft,
			delta: M.delta(c, p),
			note: dropped ? dropped + ' location(s) without sq ft excluded' : 'All locations have sq ft'
		};
	},

	/* ---------------- weather ---------------- */

	/* Monthly MMBtu against total degree days. Degree days come from the usage table
	   (m.total_hdd / total_cdd / total_dd), not from the location monthly-attribute weather
	   lookup — that query exists on the legacy Analytics page but no widget or helper reads it.
	   (Named indirectly on purpose: Appsmith scans comments for entity names and would create a
	   phantom dependency on a query this page does not carry.) */
	weatherScatter() {
		const M = EA_Measures, by = {};
		M.rows().forEach(r => {
			const k = M.monthKey(r);
			if (!k) return;
			if (!by[k]) by[k] = { month: k, mmbtu: 0, dd: 0, seen: false };
			by[k].mmbtu += M.mmbtuOf(r);
			/* Degree days repeat across every row of a month, so take one reading per month
			   rather than summing them once per bill. */
			if (!by[k].seen) {
				const dd = Number(r.total_dd);
				by[k].dd = dd || ((Number(r.total_hdd) || 0) + (Number(r.total_cdd) || 0));
				by[k].seen = true;
			}
		});
		return Object.keys(by).sort()
			.map(k => ({ month: k, label: M.monthLabel(k), x: by[k].dd, y: by[k].mmbtu }))
			.filter(p => p.x > 0 && p.y > 0);
	},

	_weatherFit() {
		return EA_Measures.linearFit(this.weatherScatter());
	},

	/* Weather-normalised performance — the prototype's "Performance drivers" tile.

	   NEW on this page. The Analytics page computes a Pearson correlation
	   (MA_WeatherHelper.pearson) but never a normalised expectation, so there is no legacy
	   number to reconcile against. Method: fit MMBtu against degree days across the loaded
	   months, read the fit as the expected consumption for each month's weather, and report
	   the residual. Per-location residuals use the portfolio fit scaled by that location's
	   share of consumption, because a single location rarely has enough months to fit alone. */
	weatherNormalised() {
		const M = EA_Measures;
		const pts = this.weatherScatter();
		const fit = M.linearFit(pts);
		if (!fit || pts.length < 6) {
			return { available: false, reason: pts.length < 6
				? 'Needs at least 6 months with degree days; have ' + pts.length
				: 'Consumption and degree days do not fit a line' };
		}

		let actual = 0, expected = 0;
		const monthly = pts.map(p => {
			const e = fit.intercept + fit.slope * p.x;
			actual += p.y; expected += e;
			return { month: p.month, label: p.label, actual: p.y, expected: e, residual: p.y - e };
		});

		const totalResidual = actual - expected;
		const shareByLoc = {};
		let totalMmbtu = 0;
		M.rows().forEach(r => {
			const k = r.location_description || 'Unknown';
			const v = M.mmbtuOf(r);
			shareByLoc[k] = (shareByLoc[k] || 0) + v;
			totalMmbtu += v;
		});

		const byLocation = Object.keys(shareByLoc).map(k => ({
			location: k,
			mmbtu: shareByLoc[k],
			residual: totalMmbtu ? totalResidual * (shareByLoc[k] / totalMmbtu) : 0
		})).sort((a, b) => a.residual - b.residual);

		return {
			available: true,
			r2: fit.r2,
			actual: actual,
			expected: expected,
			residual: totalResidual,
			pct: expected ? (totalResidual / expected) * 100 : null,
			monthly: monthly,
			byLocation: byLocation
		};
	}
}
