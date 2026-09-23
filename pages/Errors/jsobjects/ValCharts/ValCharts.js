export default {

	/* Pipeline stages in the order bills move through them, so the stack reads
	   left to right as progress rather than as an arbitrary sort. */
	_STAGES: ["Integrity Check", "Data Verification I", "Data Verification II",
	          "Data Audit I", "Data Audit II", "Unmapped"],

	/* Validated for a dark surface: all six sit inside the lightness band, clear
	   the chroma floor and hold 3:1 against the background. The one adjacent pair
	   that lands in the 6-8 colour-blind band is carried by the 2px segment gaps
	   and the legend below, which is what that band requires. Assigned by stage,
	   never by rank, so filtering the customer list never repaints a stage. */
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

	_rows() {
		const d = (typeof fetch_validation_by_customer !== 'undefined'
		           && fetch_validation_by_customer.data) || [];
		return Array.isArray(d) ? d : [];
	},

	_num(v) { return Number(v) || 0; },

	/* ── Open errors by customer, split by pipeline stage ───────────────────
	   Horizontal bars: customer names are text and read far better along the
	   axis than rotated under vertical columns. Top ten only - beyond that the
	   bars get too thin to compare and the point is the leaders anyway. */
	getCustomerStageConfig() {
		const rows = this._rows();
		const byCustomer = {};
		rows.forEach(r => {
			const c = r.customer || "Unknown";
			if (!byCustomer[c]) byCustomer[c] = { total: 0, stages: {} };
			const n = this._num(r.open_count);
			byCustomer[c].total += n;
			byCustomer[c].stages[r.stage] = (byCustomer[c].stages[r.stage] || 0) + n;
		});

		const names = Object.keys(byCustomer)
			.sort((a, b) => byCustomer[b].total - byCustomer[a].total)
			.slice(0, 10)
			.reverse(); // ECharts draws the first category at the bottom

		const series = this._STAGES.map(stage => ({
			name: stage,
			type: "bar",
			stack: "total",
			barWidth: "58%",
			itemStyle: {
				color: this._COLOURS[stage],
				/* 2px of surface between segments: the spacer that keeps adjacent
				   fills legible, and the secondary encoding the palette needs. */
				borderColor: "#1e293b",
				borderWidth: 2
			},
			emphasis: { focus: "series" },
			data: names.map(n => byCustomer[n].stages[stage] || 0)
		}));

		return {
			backgroundColor: "transparent",
			grid: { left: 8, right: 24, top: 44, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "axis",
				axisPointer: { type: "shadow" },
				backgroundColor: "#0f172a",
				borderColor: this._GRID,
				textStyle: { color: this._INK }
			},
			legend: {
				top: 8, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
				textStyle: { color: this._MUTED, fontSize: 12 }
			},
			xAxis: {
				type: "value",
				axisLabel: { color: this._MUTED },
				splitLine: { lineStyle: { color: this._GRID, opacity: 0.4 } }
			},
			yAxis: {
				type: "category",
				data: names,
				axisLabel: { color: this._INK },
				axisLine: { lineStyle: { color: this._GRID } },
				axisTick: { show: false }
			},
			series: series
		};
	},

	/* ── Open errors by code ────────────────────────────────────────────────
	   Reads the catalogue already loaded for the table, so this costs nothing
	   extra. One series, so no legend: the title names it. */
	getTopCodesConfig() {
		const d = (typeof fetch_validation_codes !== 'undefined'
		           && fetch_validation_codes.data) || [];
		const rows = (Array.isArray(d) ? d : [])
			.slice()
			.sort((a, b) => this._num(b["Open"]) - this._num(a["Open"]))
			.slice(0, 12)
			.reverse();

		return {
			backgroundColor: "transparent",
			grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
			tooltip: {
				trigger: "item",
				backgroundColor: "#0f172a",
				borderColor: this._GRID,
				textStyle: { color: this._INK }
			},
			xAxis: {
				type: "value",
				axisLabel: { color: this._MUTED },
				splitLine: { lineStyle: { color: this._GRID, opacity: 0.4 } }
			},
			yAxis: {
				type: "category",
				/* Code plus name: the number alone means nothing to a reader, and
				   the same number means different checks under different categories. */
				data: rows.map(r => r["Code"] + "  " + String(r["Check"] || "").slice(0, 40)),
				axisLabel: { color: this._INK, fontSize: 11 },
				axisLine: { lineStyle: { color: this._GRID } },
				axisTick: { show: false }
			},
			series: [{
				type: "bar",
				barWidth: "58%",
				/* Colour by whether the check can be resolved at all, not by rank:
				   a code nobody can clear is the thing worth seeing. */
				data: rows.map(r => ({
					value: this._num(r["Open"]),
					itemStyle: {
						color: r["Resolvable"] ? "#3b82f6" : "#ec4899",
						borderRadius: [0, 4, 4, 0]
					}
				})),
				label: {
					show: true, position: "right",
					color: this._MUTED, fontSize: 11,
					formatter: function (p) { return p.value.toLocaleString(); }
				}
			}]
		};
	}
}
