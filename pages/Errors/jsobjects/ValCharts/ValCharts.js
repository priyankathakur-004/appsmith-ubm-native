export default {

	/* Read-only. This object builds chart configs and answers lookups; it never
	   runs a query. The handlers that do live in ErrorsActions, so nothing here
	   both reads a query's data and triggers it. */

	/* Pipeline stages in the order bills move through them, so a stack reads as
	   progress rather than as an arbitrary sort. */
	_STAGES: ["Integrity Check", "Data Verification I", "Data Verification II",
	          "Data Audit I", "Data Audit II", "Unmapped"],

	/* Checked against the dark surface for lightness, chroma, contrast and
	   colour-blind separation rather than picked by eye, and ordered so the one
	   marginal pair is never adjacent in a stack - the 2px segment gaps and the
	   legend carry that pair. Keyed to stage, never to rank, so filtering the
	   customer list never repaints a stage. */
	_COLOURS: {
		"Integrity Check":       "#3b82f6",
		"Data Verification I":   "#d97706",
		"Data Verification II":  "#8b5cf6",
		"Data Audit I":          "#059669",
		"Data Audit II":         "#ec4899",
		"Unmapped":              "#0891b2"
	},

	_INK: "#e2e8f0",
	_MUTED: "#94a3b8",
	_GRID: "#334155",
	_SURFACE: "#1e293b",

	_num(v) { return Number(v) || 0; },

	_byCustomer() {
		const d = (typeof fetch_validation_by_customer !== 'undefined'
		           && fetch_validation_by_customer.data) || [];
		return Array.isArray(d) ? d : [];
	},

	_codes() {
		const d = (typeof fetch_validation_codes !== 'undefined'
		           && fetch_validation_codes.data) || [];
		return Array.isArray(d) ? d : [];
	},

	/* The stage filter is applied here as well as in the table, so the charts and
	   the rows underneath them always agree. */
	_stageFilter() {
		try {
			if (typeof ValStage !== 'undefined' && ValStage.selectedOptionValue)
				return String(ValStage.selectedOptionValue);
		} catch (e) { /* not mounted yet */ }
		return "";
	},

	/* ── 1. Error codes by customer ─────────────────────────────────────────
	   Horizontal bars: customer names are text and read along the axis instead
	   of rotated under columns. Stacked by stage, so one bar answers both "how
	   many" and "where in the pipeline". Top ten - beyond that bars get too thin
	   to compare, and the question is who the worst are. */
	getCustomerStageConfig() {
		const stage = this._stageFilter();
		const totals = {};
		this._byCustomer().forEach(r => {
			if (stage && r.stage !== stage) return;
			const c = r.customer || "Unknown";
			if (!totals[c]) totals[c] = { total: 0, stages: {} };
			const n = this._num(r.open_count);
			totals[c].total += n;
			totals[c].stages[r.stage] = (totals[c].stages[r.stage] || 0) + n;
		});

		const names = Object.keys(totals)
			.sort((a, b) => totals[b].total - totals[a].total)
			.slice(0, 10)
			.reverse(); // ECharts draws the first category at the bottom

		if (!names.length) return this._empty("No errors for these filters");

		const shown = stage ? [stage] : this._STAGES;
		const series = shown.map(s => ({
			name: s,
			type: "bar",
			stack: "total",
			barWidth: "58%",
			itemStyle: {
				color: this._COLOURS[s] || this._MUTED,
				/* 2px of surface between segments: the spacer that keeps adjacent
				   fills legible, and the secondary encoding the palette needs. */
				borderColor: this._SURFACE,
				borderWidth: 2
			},
			emphasis: { focus: "series" },
			data: names.map(n => totals[n].stages[s] || 0)
		}));

		return {
			backgroundColor: "transparent",
			grid: { left: 8, right: 24, top: 40, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "axis", axisPointer: { type: "shadow" },
				backgroundColor: "#0f172a", borderColor: this._GRID,
				textStyle: { color: this._INK }
			},
			legend: {
				top: 6, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
				textStyle: { color: this._MUTED, fontSize: 11 }
			},
			xAxis: {
				type: "value", axisLabel: { color: this._MUTED },
				splitLine: { lineStyle: { color: this._GRID, opacity: 0.4 } }
			},
			yAxis: {
				type: "category", data: names,
				axisLabel: { color: this._INK, fontSize: 11 },
				axisLine: { lineStyle: { color: this._GRID } },
				axisTick: { show: false }
			},
			series: series
		};
	},

	/* ── 2. Error code breakdown ────────────────────────────────────────────
	   Built from the catalogue already loaded for the table, so it adds no query.
	   Count and share of total, because a raw count says nothing about whether a
	   code is the problem or a rounding error. */
	getTopCodesConfig() {
		const stage = this._stageFilter();
		const all = this._codes().filter(r => !stage || r["Stage"] === stage);
		const grand = all.reduce((a, r) => a + this._num(r["Open"]), 0);

		const rows = all.slice()
			.sort((a, b) => this._num(b["Open"]) - this._num(a["Open"]))
			.slice(0, 12)
			.reverse();

		if (!rows.length) return this._empty("No codes for these filters");

		const self = this;
		return {
			backgroundColor: "transparent",
			grid: { left: 8, right: 96, top: 12, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "item", backgroundColor: "#0f172a",
				borderColor: this._GRID, textStyle: { color: this._INK },
				formatter: function (p) {
					const r = rows[p.dataIndex];
					const pct = grand ? (100 * self._num(r["Open"]) / grand).toFixed(1) : "0.0";
					return "<b>" + r["Code"] + "</b> &middot; " + r["Category"] + "<br/>"
					     + String(r["Check"] || "") + "<br/>"
					     + self._num(r["Open"]).toLocaleString() + " open &middot; " + pct + "% of total"
					     + (r["Resolvable"] ? "" : "<br/><i>not resolvable</i>");
				}
			},
			xAxis: {
				type: "value", axisLabel: { color: this._MUTED },
				splitLine: { lineStyle: { color: this._GRID, opacity: 0.4 } }
			},
			yAxis: {
				type: "category",
				/* The code leads so the label is clickable by code, but the name
				   follows because a bare number means nothing to a reader. */
				data: rows.map(r => r["Code"] + "  " + String(r["Check"] || "").slice(0, 34)),
				axisLabel: { color: this._INK, fontSize: 11 },
				axisLine: { lineStyle: { color: this._GRID } },
				axisTick: { show: false }
			},
			series: [{
				type: "bar", barWidth: "58%",
				/* Colour by whether the check can be resolved at all, not by rank.
				   The biggest code on this page is one nobody can clear, and that
				   is the thing worth seeing before chasing volume. */
				data: rows.map(r => ({
					value: this._num(r["Open"]),
					itemStyle: {
						color: r["Resolvable"] ? "#3b82f6" : "#ec4899",
						borderRadius: [0, 4, 4, 0]
					}
				})),
				label: {
					show: true, position: "right", color: this._MUTED, fontSize: 11,
					formatter: function (p) {
						const pct = grand ? (100 * p.value / grand).toFixed(1) : "0.0";
						return p.value.toLocaleString() + "  (" + pct + "%)";
					}
				}
			}]
		};
	},

	_empty(msg) {
		return {
			backgroundColor: "transparent",
			title: {
				text: msg, left: "center", top: "middle",
				textStyle: { color: this._MUTED, fontSize: 13, fontWeight: "normal" }
			},
			xAxis: { show: false }, yAxis: { show: false }, series: []
		};
	},

	/* ── lookups for the drill handlers ─────────────────────────────────────
	   A chart click gives back a label, not an id. These turn one into the other
	   so the handlers in ErrorsActions never have to read query data themselves. */
	customerIdFor(label) {
		const name = String(label == null ? "" : label);
		const hit = this._byCustomer().find(r => String(r.customer) === name);
		return hit ? hit.customer_id : null;
	},

	/* Labels are "<code>  <check name>", so the code is the leading token. The
	   category comes back too: the same number means different checks under
	   different categories, so a code alone is not enough to drill on. */
	codeFor(label) {
		const m = String(label == null ? "" : label).match(/^(\d+)/);
		if (!m) return null;
		const code = m[1];
		const hit = this._codes().find(r => String(r["Code"]) === code);
		return hit ? { code: hit["Code"], category: hit["Category"], name: hit["Check"] } : null;
	}
}
