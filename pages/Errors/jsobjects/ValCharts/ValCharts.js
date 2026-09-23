export default {

	/* Functions only, no object-level data properties: the sibling object on this
	   page that works declares no variables, and a hand-written variables block is
	   not worth the risk of the whole app failing to evaluate.

	   Read-only by design. This object builds chart configs and answers lookups;
	   it never triggers a query. A function that both triggers and reads the same
	   query is rejected as reactive misuse, and the trace follows calls, so the
	   split has to be real rather than cosmetic. */

	/* Pipeline stages in the order bills move through them, so a stack reads as
	   progress rather than as an arbitrary sort. */
	_stages() {
		return ["Integrity Check", "Data Verification I", "Data Verification II",
		        "Data Audit I", "Data Audit II", "Unmapped"];
	},

	/* Checked against the dark surface for lightness, chroma, contrast and
	   colour-blind separation rather than picked by eye, and ordered so the one
	   marginal pair is never adjacent in a stack - the 2px segment gaps and the
	   legend carry that pair. Keyed to stage, never to rank, so filtering the
	   customer list never repaints a stage. */
	_theme() {
		return {
			/* Assigned in pipeline order, which is also the order they stack, so
			   every adjacent pair is one the checks were run against. Softer steps
			   than the first attempt: the neon set passed the numbers but read
			   harshly against a dark card. */
			colours: {
				"Integrity Check":       "#5d8ff0",
				"Data Verification I":   "#2f9e75",
				"Data Verification II":  "#a07ee0",
				"Data Audit I":          "#b8762f",
				"Data Audit II":         "#3f93c9",
				"Unmapped":              "#cf6288"
			},
			/* A code that can be resolved against one that cannot - a state, not a
			   series, so it keeps its own pair and never borrows a stage colour. */
			can:    "#5d8ff0",
			cannot: "#cf6288",
			ink: "#e2e8f0",
			muted: "#94a3b8",
			grid: "#2c3b52",
			surface: "#1e293b",
			panel: "#0f172a"
		};
	},

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

	_empty(msg) {
		const t = this._theme();
		return {
			backgroundColor: "#1e293b",
			title: {
				text: msg, left: "center", top: "middle",
				textStyle: { color: t.muted, fontSize: 13, fontWeight: "normal" }
			},
			xAxis: { show: false }, yAxis: { show: false }, series: []
		};
	},

	/* ── 1. Error codes by customer ─────────────────────────────────────────
	   Horizontal bars: customer names are text and read along the axis instead
	   of rotated under columns. Stacked by stage, so one bar answers both "how
	   many" and "where in the pipeline". Top ten - beyond that bars get too thin
	   to compare, and the question is who the worst are. */
	getCustomerStageConfig() {
		const t = this._theme();
		const stage = this._stageFilter();
		const totals = {};
		this._byCustomer().forEach(r => {
			if (stage && r.stage !== stage) return;
			const c = r.customer || "Unknown";
			if (!totals[c]) totals[c] = { total: 0, stages: {}, id: r.customer_id };
			const n = this._num(r.open_count);
			totals[c].total += n;
			totals[c].stages[r.stage] = (totals[c].stages[r.stage] || 0) + n;
		});

		const names = Object.keys(totals)
			.sort((a, b) => totals[b].total - totals[a].total)
			.slice(0, 10)
			.reverse(); // ECharts draws the first category at the bottom

		if (!names.length) return this._empty("No errors for these filters");

		/* The category value carries the customer id ahead of the name, and the
		   axis formatter hides it again. That is what lets the click handler read
		   an id straight off the clicked label instead of looking it up in this
		   query's data - a handler that both triggers and reads the same query is
		   rejected outright, and the trace follows calls between objects. */
		const cats = names.map(n => totals[n].id + "|" + n);

		const shown = stage ? [stage] : this._stages();
		const series = shown.map(s => ({
			name: s,
			type: "bar",
			stack: "total",
			barWidth: "46%",
			itemStyle: {
				color: t.colours[s] || t.muted,
				/* 2px of surface between segments: the spacer that keeps adjacent
				   fills legible, and the secondary encoding the palette needs. */
				borderColor: t.surface,
				borderWidth: 2
			},
			emphasis: { focus: "series" },
			data: names.map(n => totals[n].stages[s] || 0)
		}));

		return {
			backgroundColor: "#1e293b",
			grid: { left: 8, right: 24, top: 40, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "axis", axisPointer: { type: "shadow" },
				backgroundColor: t.panel, borderColor: t.grid,
				textStyle: { color: t.ink }
			},
			legend: {
				top: 6, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
				textStyle: { color: t.muted, fontSize: 11 }
			},
			xAxis: {
				type: "value", axisLabel: { color: t.muted },
				splitLine: { lineStyle: { color: t.grid, opacity: 0.55, width: 1 } }
			},
			yAxis: {
				type: "category", data: cats,
				axisLabel: {
					color: t.ink, fontSize: 11,
					formatter: function (v) { return String(v).split("|").slice(1).join("|"); }
				},
				axisLine: { show: false },
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
		const t = this._theme();
		const stage = this._stageFilter();
		const all = this._codes().filter(r => !stage || r["Stage"] === stage);
		const grand = all.reduce((a, r) => a + this._num(r["Open"]), 0);

		const rows = all.slice()
			.sort((a, b) => this._num(b["Open"]) - this._num(a["Open"]))
			.slice(0, 12)
			.reverse();

		if (!rows.length) return this._empty("No codes for these filters");

		return {
			backgroundColor: "#1e293b",
			grid: { left: 8, right: 96, top: 12, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "item", backgroundColor: t.panel,
				borderColor: t.grid, textStyle: { color: t.ink }
			},
			xAxis: {
				type: "value", axisLabel: { color: t.muted },
				splitLine: { lineStyle: { color: t.grid, opacity: 0.55, width: 1 } }
			},
			yAxis: {
				type: "category",
				/* The code leads so the label is clickable by code, but the name
				   follows because a bare number means nothing to a reader. */
				/* "<code>|<category>|<name>|<R or N>". The flag is its own field so the
				   drill handler reads a clean check name out of the third part. */
				data: rows.map(r => r["Code"] + "|" + r["Category"] + "|"
				                    + String(r["Check"] || "").slice(0, 30) + "|"
				                    + (r["Resolvable"] ? "R" : "N")),
				axisLabel: {
					color: t.ink, fontSize: 11,
					formatter: function (v) {
						const p = String(v).split("|");
						/* Say it in words as well as colour: a status a reader can only
						   get from a hue is one some readers cannot get at all. */
						return p[0] + "  " + (p[2] || "") + (p[3] === "N" ? "  · unresolvable" : "");
					}
				},
				axisLine: { show: false },
				axisTick: { show: false }
			},
			series: [{
				type: "bar", barWidth: "46%",
				/* Colour by whether the check can be resolved at all, not by rank.
				   The biggest code on this page is one nobody can clear, and that
				   is the thing worth seeing before chasing volume. */
				/* The share is computed here and carried on each item. A formatter is
				   serialised to a string and re-evaluated inside the chart, so it
				   loses this scope - referencing a total computed out here fails at
				   render with "not defined". Anything a formatter needs has to
				   travel in the data. */
				data: rows.map(r => ({
					value: this._num(r["Open"]),
					pct: grand ? (100 * this._num(r["Open"]) / grand).toFixed(1) : "0.0",
					itemStyle: {
						color: r["Resolvable"] ? t.can : t.cannot,
						borderRadius: [0, 4, 4, 0]
					}
				})),
				label: {
					show: true, position: "right", color: t.muted, fontSize: 11,
					formatter: function (p) {
						const pct = (p.data && p.data.pct != null) ? p.data.pct : "0.0";
						return p.value.toLocaleString() + "  (" + pct + "%)";
					}
				}
			}]
		};
	}
}
