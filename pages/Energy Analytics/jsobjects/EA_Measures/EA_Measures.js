export default {

	/* Shared measure definitions for the five Energy Analytics views.

	   Every view model on this page goes through here rather than summing columns itself.
	   That is what keeps the new screens tied to the same numbers the 26 legacy reports
	   produce on the Analytics page — if a measure has to change, it changes once. */

	/* ---------------- source rows ---------------- */

	rows() {
		try { return fetch_analytics_data.data || []; } catch (e) { return []; }
	},

	/* Canonical consumption. fetch_analytics_data already emits the
	     CASE WHEN bill_type = 'Supply Only' THEN total_gen_consumption ELSE total_consumption END
	   rule as its `consumption` column, so reading that column is the whole measure. Summing
	   total_consumption instead will NOT match UBM. */
	consumptionOf(r) { return Number(r.consumption) || 0; },
	chargesOf(r)     { return Number(r.total_charges) || 0; },

	/* MMBtu for a row, so unlike utilities can be added together. Water and sewer carry no
	   heat content and contribute zero by design. */
	mmbtuOf(r) {
		const map = { ELECTRIC: 3412, NATURALGAS: 102800, OIL2: 138500, STEAM: 1000, WATER: 0, SEWER: 0 };
		const f = map[r.utility_type] || 0;
		return (this.consumptionOf(r) * f) / 1000000;
	},

	/* Headline consumption for a KPI strip.

	   Raw consumption CANNOT be summed across utility types — kWh and therms are different
	   units and adding them produces a number that means nothing. When the rows cover more
	   than one unit of measure this returns MMBtu, which is comparable; when they cover
	   exactly one it returns that unit untouched, so a single-utility account still reads in
	   the units the bill is written in. */
	consumptionHeadline(rows) {
		const uoms = new Set();
		(rows || []).forEach(r => { const u = r.total_consumption_uom; if (u) uoms.add(u); });

		if (uoms.size === 1) {
			return {
				value: (rows || []).reduce((a, r) => a + this.consumptionOf(r), 0),
				unit: Array.from(uoms)[0],
				basis: 'native'
			};
		}
		return {
			value: (rows || []).reduce((a, r) => a + this.mmbtuOf(r), 0),
			unit: 'MMBtu',
			basis: 'mmbtu'
		};
	},

	/* ---------------- keys and formatting ---------------- */

	monthKey(r) { return String(r.time_period || '').slice(0, 7); },   // YYYY-MM

	monthLabel(key) {
		const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const p = String(key).split('-');
		return p.length < 2 ? String(key) : m[parseInt(p[1], 10) - 1] + " '" + p[0].slice(2);
	},

	fmtMoney(n) {
		const v = Number(n) || 0;
		const a = Math.abs(v);
		if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
		if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
		if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
		return '$' + v.toFixed(0);
	},

	fmtNum(n, dp) {
		const v = Number(n) || 0;
		const a = Math.abs(v);
		if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
		if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
		if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
		return v.toFixed(dp == null ? 0 : dp);
	},

	fmtPct(n, dp) { return (Number(n) || 0).toFixed(dp == null ? 1 : dp) + '%'; },

	/* ---------------- aggregation ---------------- */

	/* Group rows by a key function, summing charges, consumption and MMBtu. */
	groupBy(rows, keyFn) {
		const out = {};
		(rows || []).forEach(r => {
			const k = keyFn(r);
			if (k == null || k === '') return;
			if (!out[k]) out[k] = { key: k, charges: 0, consumption: 0, mmbtu: 0, rows: 0 };
			out[k].charges     += this.chargesOf(r);
			out[k].consumption += this.consumptionOf(r);
			out[k].mmbtu       += this.mmbtuOf(r);
			out[k].rows        += 1;
		});
		return out;
	},

	/* Sorted list of the YYYY-MM months present in the data. */
	months(rows) {
		const s = new Set();
		(rows || []).forEach(r => { const k = this.monthKey(r); if (k) s.add(k); });
		return Array.from(s).sort();
	},

	/* Split the loaded months in half and compare the later half with the earlier half.
	   The prototype's "vs prior period" deltas are this comparison — it is derived from the
	   selected window, not read from a stored prior-period column. */
	priorPeriodSplit(rows) {
		const ms = this.months(rows);
		if (ms.length < 2) return null;
		const cut = Math.ceil(ms.length / 2);
		const prior = new Set(ms.slice(0, cut));
		const current = new Set(ms.slice(cut));
		const acc = { current: { charges: 0, consumption: 0, mmbtu: 0 }, prior: { charges: 0, consumption: 0, mmbtu: 0 } };
		(rows || []).forEach(r => {
			const k = this.monthKey(r);
			const b = current.has(k) ? acc.current : (prior.has(k) ? acc.prior : null);
			if (!b) return;
			b.charges     += this.chargesOf(r);
			b.consumption += this.consumptionOf(r);
			b.mmbtu       += this.mmbtuOf(r);
		});
		return acc;
	},

	/* Percent change, guarded against a zero base. */
	delta(cur, prior) {
		const p = Number(prior) || 0;
		if (!p) return null;
		return ((Number(cur) || 0) - p) / Math.abs(p) * 100;
	},

	/* Least-squares fit, used by the weather-normalisation and cost-driver scatters.
	   Returns slope, intercept and r2. */
	linearFit(pts) {
		const n = (pts || []).length;
		if (n < 2) return null;
		let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
		pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; syy += p.y * p.y; });
		const d = n * sxx - sx * sx;
		if (!d) return null;
		const slope = (n * sxy - sx * sy) / d;
		const intercept = (sy - slope * sx) / n;
		const rd = Math.sqrt(d * (n * syy - sy * sy));
		const r = rd ? (n * sxy - sx * sy) / rd : 0;
		return { slope: slope, intercept: intercept, r2: r * r };
	}
}
