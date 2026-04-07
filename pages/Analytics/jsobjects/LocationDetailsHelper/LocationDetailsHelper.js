export default {
	getViewBy() {
		return appsmith.store.ldViewBy || 'ChargesVsConsumption';
	},

	getChartTitle() {
		const view = this.getViewBy();
		const titles = {
			'ChargesVsConsumption': 'Charges vs Consumption by Month',
			'ChargeTypes': 'Charge Types by Month',
			'ConsumptionTypes': 'Consumption Types by Month',
			'TOUChargeTypes': 'Time-of-Use Charge Types by Month',
			'TOUConsumptionTypes': 'Time-of-Use Consumption Types by Month'
		};
		return titles[view] || titles['ChargesVsConsumption'];
	},

	getMonthYearLabel(dateStr) {
		if (!dateStr) return 'Unknown';
		var parts = dateStr.substring(0, 7).split('-');
		var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var mi = parseInt(parts[1]) - 1;
		return monthNames[mi] + ' ' + parts[0];
	},

	// Group raw rows into one bucket per YYYY-MM, summing all numeric columns we
	// care about. Power BI's visuals all aggregate at the MonthYear grain, so the
	// chart series and tables share this single grouping.
	_groupByMonth() {
		var raw = fetch_analytics_data.data || [];
		var by = {};
		// The breakdown columns (total_charges_customer/commodity/...) come from a
		// LATERAL join on analytics_monthly_feed keyed on (customer, location,
		// month, utility). When the base m table has multiple rows per that key
		// (e.g. one per bill_type or meter), the LATERAL returns the same SUM for
		// each row, so we must only count the breakdown once per
		// (location_id, month, utility_type). The "raw" m-row totals
		// (consumption, total_charges) are still summed per row.
		var seenAmfKey = {};
		raw.forEach(function(r) {
			var date = r.time_period || r.bill_start_date || r.read_date || '';
			var my = (date || '').substring(0, 7);
			if (!my) return;
			if (!by[my]) {
				by[my] = {
					my: my,
					consumption: 0,
					total_consumption: 0,
					total_gen_consumption: 0,
					total_charges: 0,
					customer: 0,
					commodity: 0,
					generation: 0,
					other: 0,
					taxes: 0,
					demand: 0,
					consumption_charges: 0
				};
			}
			var b = by[my];
			b.consumption           += parseFloat(r.consumption) || 0;
			b.total_consumption     += parseFloat(r.total_consumption) || 0;
			// Generation Consumption mirrors the Power BI report, which shows the
			// MAX gen_consumption across rows for the period (not the sum). With
			// SUM, sub-meters get double-counted; MAX picks the largest meter's
			// reading and matches the Power BI numbers exactly.
			var gen = parseFloat(r.total_gen_consumption) || 0;
			if (gen > b.total_gen_consumption) b.total_gen_consumption = gen;
			b.total_charges         += parseFloat(r.total_charges) || 0;

			var amfKey = (r.location_id || '') + '|' + my + '|' + (r.utility_type || '');
			if (!seenAmfKey[amfKey]) {
				seenAmfKey[amfKey] = true;
				b.customer            += parseFloat(r.total_charges_customer) || 0;
				b.commodity           += parseFloat(r.total_charges_commodity) || 0;
				b.generation          += parseFloat(r.total_charges_generation) || 0;
				b.other               += parseFloat(r.total_charges_other) || 0;
				b.taxes               += parseFloat(r.total_charges_taxes) || 0;
				b.demand              += parseFloat(r.total_charges_demand) || 0;
				b.consumption_charges += parseFloat(r.total_charges_consumption) || 0;
			}
		});
		return Object.keys(by).sort().map(function(k) { return by[k]; });
	},

	_getUOMLabel() {
		var raw = fetch_analytics_data.data || [];
		var uoms = new Set();
		raw.forEach(function(r) { if (r.total_consumption_uom) uoms.add(r.total_consumption_uom); });
		return Array.from(uoms).join(', ');
	},

	linearRegression(points) {
		var n = points.length;
		if (n < 2) return null;
		var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
		points.forEach(function(p) {
			sumX += p[0]; sumY += p[1];
			sumXY += p[0] * p[1]; sumX2 += p[0] * p[0];
		});
		var denom = n * sumX2 - sumX * sumX;
		if (denom === 0) return null;
		var slope = (n * sumXY - sumX * sumY) / denom;
		var intercept = (sumY - slope * sumX) / n;
		return { slope: slope, intercept: intercept };
	},

	// ---- Shared dark-theme axis/grid helpers ----
	_baseTheme() {
		return {
			BG: '#1E293B',
			AXIS: '#334155',
			LABEL: '#94a3b8',
			TEXT: '#e2e8f0',
			GRID_LINE: '#1e293b',
			TOOLTIP_BG: '#0f172a',
			TOOLTIP_BORDER: '#334155'
		};
	},

	_fmtCurrency(v) {
		v = v || 0;
		if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
		return '$' + Math.round(v);
	},

	_fmtNumber(v) {
		v = v || 0;
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
		return Math.round(v).toString();
	},

	// =============================================================
	//  CHARGES vs CONSUMPTION (scatter, one dot per MonthYear)
	// =============================================================
	getChargesVsConsumptionConfig() {
		var t = this._baseTheme();
		var groups = this._groupByMonth();

		// Newest months first so the legend mirrors Power BI ordering.
		var sorted = groups.slice().sort(function(a, b) { return b.my.localeCompare(a.my); });

		var monthColors = [
			'#7dd3fc','#93c5fd','#a5b4fc','#c4b5fd','#f0abfc','#fda4af',
			'#fca5a5','#fdba74','#fcd34d','#bef264','#86efac','#6ee7b7',
			'#5eead4','#67e8f9','#a78bfa','#f9a8d4','#fbbf24','#2dd4bf'
		];

		var allPoints = [];
		var self = this;
		var series = sorted.map(function(g, idx) {
			var pt = [g.consumption, g.total_charges];
			allPoints.push(pt);
			return {
				name: self.getMonthYearLabel(g.my + '-01'),
				type: 'scatter',
				data: [pt],
				symbolSize: 14,
				itemStyle: { color: monthColors[idx % monthColors.length] }
			};
		});

		var reg = this.linearRegression(allPoints);
		if (reg && allPoints.length >= 2) {
			var xs = allPoints.map(function(p) { return p[0]; });
			var minX = Math.min.apply(null, xs);
			var maxX = Math.max.apply(null, xs);
			series.push({
				name: 'Trend',
				type: 'line',
				data: [
					[minX, reg.slope * minX + reg.intercept],
					[maxX, reg.slope * maxX + reg.intercept]
				],
				symbol: 'circle',
				symbolSize: 12,
				lineStyle: { type: 'dashed', color: '#94a3b8', width: 2 },
				itemStyle: { color: 'transparent', borderColor: '#e2e8f0', borderWidth: 2 },
				showSymbol: true,
				z: 0
			});
		}

		var uom = this._getUOMLabel();
		var xLabel = 'Consumption' + (uom ? ' (' + uom + ')' : '');

		return {
			backgroundColor: t.BG,
			tooltip: {
				trigger: 'item',
				backgroundColor: t.TOOLTIP_BG,
				borderColor: t.TOOLTIP_BORDER,
				textStyle: { color: t.TEXT },
				formatter: function(p) {
					if (p.seriesName === 'Trend') return '';
					var cons = (p.data[0] || 0).toLocaleString();
					var charges = '$' + (p.data[1] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
					return '<b>' + p.seriesName + '</b><br/>Consumption: ' + cons + '<br/>Charges: ' + charges;
				}
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: t.TEXT, fontSize: 11 },
				pageTextStyle: { color: t.LABEL },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 180, top: 60, bottom: 130 },
			xAxis: {
				type: 'value',
				name: xLabel,
				nameLocation: 'middle',
				nameGap: 50,
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return v >= 1000000 ? (v/1000000).toFixed(0) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			yAxis: {
				type: 'value',
				name: 'Charges ($)',
				nameLocation: 'end',
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return '$' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } }
			],
			series: series
		};
	},

	// =============================================================
	//  CHARGE TYPES (stacked bar by month + total charges line)
	// =============================================================
	getChargeTypesConfig() {
		var t = this._baseTheme();
		var groups = this._groupByMonth();
		var self = this;
		var months = groups.map(function(g) { return self.getMonthYearLabel(g.my + '-01'); });

		// Charge-type order + colors loosely mirror the Power BI swatches.
		var stacks = [
			{ key: 'customer',            name: 'Customer Charges',    color: '#3b82f6' },
			{ key: 'commodity',           name: 'Commodity Charges',   color: '#1e3a8a' },
			{ key: 'generation',          name: 'Generation Charges',  color: '#84cc16' },
			{ key: 'other',               name: 'Other Charges',       color: '#1e293b' },
			{ key: 'taxes',               name: 'Taxes',               color: '#16a34a' },
			{ key: 'demand',              name: 'Demand Charges',      color: '#0f172a' },
			{ key: 'consumption_charges', name: 'Consumption Charges', color: '#172554' }
		];

		var series = stacks.map(function(s) {
			return {
				name: s.name,
				type: 'bar',
				stack: 'charges',
				barMaxWidth: 80,
				itemStyle: { color: s.color },
				data: groups.map(function(g) { return Math.round((g[s.key] || 0) * 100) / 100; })
			};
		});

		// "Charges" overlay line that traces total_charges per month — matches the
		// Power BI thin grey line that connects the top of each stack.
		series.push({
			name: 'Charges',
			type: 'line',
			yAxisIndex: 0,
			symbol: 'circle',
			symbolSize: 6,
			lineStyle: { color: '#cbd5e1', width: 2 },
			itemStyle: { color: '#cbd5e1' },
			data: groups.map(function(g) { return Math.round((g.total_charges || 0) * 100) / 100; }),
			z: 5
		});

		return {
			backgroundColor: t.BG,
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				backgroundColor: t.TOOLTIP_BG,
				borderColor: t.TOOLTIP_BORDER,
				textStyle: { color: t.TEXT },
				valueFormatter: function(v) { return '$' + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: t.TEXT, fontSize: 11 },
				pageTextStyle: { color: t.LABEL },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 200, top: 60, bottom: 130 },
			xAxis: {
				type: 'category',
				data: months,
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 40,
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL },
				axisLine: { lineStyle: { color: t.AXIS } }
			},
			yAxis: {
				type: 'value',
				name: 'Charge types ($)',
				nameLocation: 'end',
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return '$' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } }
			],
			series: series
		};
	},

	// =============================================================
	//  CONSUMPTION TYPES (clustered bar: total + generation)
	// =============================================================
	getConsumptionTypesConfig() {
		var t = this._baseTheme();
		var groups = this._groupByMonth();
		var self = this;
		var months = groups.map(function(g) { return self.getMonthYearLabel(g.my + '-01'); });

		var series = [
			{
				name: 'Total Consumption',
				type: 'bar',
				barMaxWidth: 60,
				itemStyle: { color: '#3b82f6' },
				data: groups.map(function(g) { return Math.round((g.total_consumption || 0) * 100) / 100; })
			},
			{
				name: 'Generation Consumption',
				type: 'bar',
				barMaxWidth: 60,
				itemStyle: { color: '#84cc16' },
				data: groups.map(function(g) { return Math.round((g.total_gen_consumption || 0) * 100) / 100; })
			}
		];

		return {
			backgroundColor: t.BG,
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				backgroundColor: t.TOOLTIP_BG,
				borderColor: t.TOOLTIP_BORDER,
				textStyle: { color: t.TEXT },
				valueFormatter: function(v) { return (v || 0).toLocaleString(); }
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: t.TEXT, fontSize: 11 },
				pageTextStyle: { color: t.LABEL },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 220, top: 60, bottom: 130 },
			xAxis: {
				type: 'category',
				data: months,
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 40,
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL },
				axisLine: { lineStyle: { color: t.AXIS } }
			},
			yAxis: {
				type: 'value',
				name: 'Consumption types',
				nameLocation: 'end',
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } }
			],
			series: series
		};
	},

	// =============================================================
	//  TIME-OF-USE CHARGE TYPES
	//  Source data has no per-peak breakdown, so the five peak series
	//  render as zeros (matching what the Power BI report shows) and
	//  the "Consumption Charges" line carries the actual values.
	// =============================================================
	getTOUChargeTypesConfig() {
		var t = this._baseTheme();
		var groups = this._groupByMonth();
		var self = this;
		var months = groups.map(function(g) { return self.getMonthYearLabel(g.my + '-01'); });
		var zeros = groups.map(function() { return 0; });

		var peaks = [
			{ name: 'Mid-peak Consumption Charges',     color: '#3b82f6' },
			{ name: 'Off-peak Consumption Charges',     color: '#1e3a8a' },
			{ name: 'On-Peak Consumption Charges',      color: '#84cc16' },
			{ name: 'Shoulder-Peak Consumption Charges',color: '#1e293b' },
			{ name: 'Super-Peak Consumption Charges',   color: '#16a34a' }
		];

		var series = peaks.map(function(p) {
			return {
				name: p.name,
				type: 'line',
				symbol: 'circle',
				symbolSize: 6,
				lineStyle: { color: p.color, width: 2 },
				itemStyle: { color: p.color },
				data: zeros
			};
		});

		series.push({
			name: 'Consumption Charges',
			type: 'line',
			symbol: 'circle',
			symbolSize: 6,
			lineStyle: { color: '#14532d', width: 3 },
			itemStyle: { color: '#14532d' },
			data: groups.map(function(g) { return Math.round((g.consumption_charges || 0) * 100) / 100; })
		});

		return {
			backgroundColor: t.BG,
			tooltip: {
				trigger: 'axis',
				backgroundColor: t.TOOLTIP_BG,
				borderColor: t.TOOLTIP_BORDER,
				textStyle: { color: t.TEXT },
				valueFormatter: function(v) { return '$' + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: t.TEXT, fontSize: 11 },
				pageTextStyle: { color: t.LABEL },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 240, top: 60, bottom: 130 },
			xAxis: {
				type: 'category',
				data: months,
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 40,
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL },
				axisLine: { lineStyle: { color: t.AXIS } }
			},
			yAxis: {
				type: 'value',
				name: 'Charges TOU ($)',
				nameLocation: 'end',
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(0) + 'K' : '$' + v; } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } }
			],
			series: series
		};
	},

	// =============================================================
	//  TIME-OF-USE CONSUMPTION TYPES
	//  Same shape as the TOU charges chart — peak buckets are zero,
	//  and "Total Consumption" is the only meaningful line.
	// =============================================================
	getTOUConsumptionTypesConfig() {
		var t = this._baseTheme();
		var groups = this._groupByMonth();
		var self = this;
		var months = groups.map(function(g) { return self.getMonthYearLabel(g.my + '-01'); });
		var zeros = groups.map(function() { return 0; });

		var peaks = [
			{ name: 'Shoulder-Peak Consumption', color: '#3b82f6' },
			{ name: 'Super-Peak Consumption',    color: '#1e3a8a' },
			{ name: 'Super-Offpeak Consumption', color: '#84cc16' },
			{ name: 'Off-Peak Consumption',      color: '#1e293b' },
			{ name: 'On-Peak Consumption',       color: '#16a34a' }
		];

		var series = peaks.map(function(p) {
			return {
				name: p.name,
				type: 'line',
				symbol: 'circle',
				symbolSize: 6,
				lineStyle: { color: p.color, width: 2 },
				itemStyle: { color: p.color },
				data: zeros
			};
		});

		series.push({
			name: 'Total Consumption',
			type: 'line',
			symbol: 'circle',
			symbolSize: 6,
			lineStyle: { color: '#14532d', width: 3 },
			itemStyle: { color: '#14532d' },
			data: groups.map(function(g) { return Math.round((g.total_consumption || 0) * 100) / 100; })
		});

		return {
			backgroundColor: t.BG,
			tooltip: {
				trigger: 'axis',
				backgroundColor: t.TOOLTIP_BG,
				borderColor: t.TOOLTIP_BORDER,
				textStyle: { color: t.TEXT },
				valueFormatter: function(v) { return (v || 0).toLocaleString(); }
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: t.TEXT, fontSize: 11 },
				pageTextStyle: { color: t.LABEL },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 220, top: 60, bottom: 130 },
			xAxis: {
				type: 'category',
				data: months,
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 40,
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL },
				axisLine: { lineStyle: { color: t.AXIS } }
			},
			yAxis: {
				type: 'value',
				name: 'Consumption TOU',
				nameLocation: 'end',
				nameTextStyle: { color: t.LABEL, fontSize: 12 },
				axisLabel: { color: t.LABEL, formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; } },
				axisLine: { lineStyle: { color: t.AXIS } },
				splitLine: { lineStyle: { color: t.GRID_LINE, type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: t.AXIS, backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: t.TEXT, borderColor: '#64748b' }, textStyle: { color: t.LABEL } }
			],
			series: series
		};
	},

	getChartConfig() {
		var view = this.getViewBy();
		if (view === 'ChargeTypes')          return this.getChargeTypesConfig();
		if (view === 'ConsumptionTypes')     return this.getConsumptionTypesConfig();
		if (view === 'TOUChargeTypes')       return this.getTOUChargeTypesConfig();
		if (view === 'TOUConsumptionTypes')  return this.getTOUConsumptionTypesConfig();
		return this.getChargesVsConsumptionConfig();
	},

	// =============================================================
	//  TABLE DATA — one row per MonthYear, columns match the view.
	//  Used by the "Show as a Table" modal and the CSV export.
	// =============================================================
	getTableData() {
		var view = this.getViewBy();
		var groups = this._groupByMonth();
		var self = this;
		var labeled = groups.map(function(g) {
			return Object.assign({}, g, { label: self.getMonthYearLabel(g.my + '-01') });
		});

		if (view === 'ChargeTypes') {
			return labeled.map(function(g) {
				return {
					'MonthYear':           g.label,
					'Customer Charges':    g.customer,
					'Commodity Charges':   g.commodity,
					'Generation Charges':  g.generation,
					'Other Charges':       g.other,
					'Taxes':               g.taxes,
					'Demand Charges':      g.demand,
					'Consumption Charges': g.consumption_charges,
					'Charges':             g.total_charges
				};
			});
		}

		if (view === 'ConsumptionTypes') {
			return labeled.map(function(g) {
				return {
					'MonthYear':              g.label,
					'Total Consumption':      g.total_consumption,
					'Generation Consumption': g.total_gen_consumption
				};
			});
		}

		if (view === 'TOUChargeTypes') {
			return labeled.map(function(g) {
				return {
					'MonthYear':                    g.label,
					'Mid-peak Consumption Charges': 0,
					'Off-peak Consumption Charges': 0,
					'On-Peak Consumption Charges':  0,
					'Shoulder-Peak Consumption Charges': 0,
					'Super-Peak Consumption Charges':    0,
					'Consumption Charges':          g.consumption_charges
				};
			});
		}

		if (view === 'TOUConsumptionTypes') {
			return labeled.map(function(g) {
				return {
					'MonthYear':                  g.label,
					'Shoulder-Peak Consumption': 0,
					'Super-Peak Consumption':    0,
					'Super-Offpeak Consumption': 0,
					'Off-Peak Consumption':      0,
					'On-Peak Consumption':       0,
					'Total Consumption':         g.total_consumption
				};
			});
		}

		// Default: Charges vs Consumption
		return labeled.map(function(g) {
			return {
				'MonthYear':   g.label,
				'Consumption': g.consumption,
				'Charges':     g.total_charges
			};
		});
	},

	setDefaults() {
		if (!appsmith.store.ldViewBy) storeValue('ldViewBy', 'ChargesVsConsumption');
	}
}
