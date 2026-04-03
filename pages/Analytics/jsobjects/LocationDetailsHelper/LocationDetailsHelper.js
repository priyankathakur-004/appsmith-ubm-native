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

	getScatterData() {
		var raw = fetch_analytics_data.data || [];
		var byMonthYear = {};

		raw.forEach(function(r) {
			var date = r.time_period || r.bill_start_date || r.read_date || '';
			var my = date.substring(0, 7);
			if (!my) return;

			var cons = parseFloat(r.consumption) || 0;
			var charges = parseFloat(r.total_charges) || 0;

			if (!byMonthYear[my]) byMonthYear[my] = [];
			byMonthYear[my].push([cons, charges]);
		});

		return byMonthYear;
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

	getChartConfig() {
		var byMonthYear = this.getScatterData();
		var self = this;

		var sortedKeys = Object.keys(byMonthYear).sort().reverse();

		var monthColors = [
				'#7dd3fc', // light sky blue
				'#93c5fd', // light blue
				'#a5b4fc', // light indigo
				'#c4b5fd', // light violet
				'#f0abfc', // light fuchsia
				'#fda4af', // light rose
				'#fca5a5', // light red
				'#fdba74', // light orange
				'#fcd34d', // light amber
				'#bef264', // light lime
				'#86efac', // light green
				'#6ee7b7', // light emerald
				'#5eead4', // light teal
				'#67e8f9', // light cyan
				'#a78bfa', // soft purple
				'#f9a8d4', // soft pink
				'#fbbf24', // golden yellow
				'#2dd4bf', // bright teal
		];

		var allPoints = [];
		var series = sortedKeys.map(function(my, idx) {
			var label = self.getMonthYearLabel(my + '-01');
			var pts = byMonthYear[my];
			pts.forEach(function(p) { allPoints.push(p); });
			return {
				name: label,
				type: 'scatter',
				data: pts,
				symbolSize: 12,
				itemStyle: { color: monthColors[idx % monthColors.length] }
			};
		});

		var reg = this.linearRegression(allPoints);
		if (reg && allPoints.length > 0) {
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
				symbolSize: 10,
				lineStyle: { type: 'dashed', color: '#475569', width: 2 },
				itemStyle: { color: '#475569', borderColor: '#e2e8f0', borderWidth: 2 },
				showSymbol: true,
				z: 0
			});
		}

		var raw = fetch_analytics_data.data || [];
		var uoms = new Set();
		raw.forEach(function(r) { if (r.total_consumption_uom) uoms.add(r.total_consumption_uom); });
		var uomList = Array.from(uoms);
		var xLabel = 'Consumption' + (uomList.length > 0 ? ' (' + uomList.join(', ') + ')' : '');

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'item',
				backgroundColor: '#1e293b',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' },
				formatter: function(p) {
					if (p.seriesName === 'Trend') return '';
					var cons = (p.data[0] || 0).toLocaleString();
					var charges = '$' + (p.data[1] || 0).toLocaleString();
					return '<b>' + p.seriesName + '</b><br/>Consumption: ' + cons + '<br/>Charges: ' + charges;
				}
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 60,
				bottom: 80,
				textStyle: { color: '#e2e8f0', fontSize: 11 },
				pageTextStyle: { color: '#94a3b8' },
				pageIconColor: '#94a3b8',
				pageIconInactiveColor: '#334155',
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10,
				title: { text: 'MonthYear', textStyle: { color: '#e2e8f0', fontWeight: 'bold', fontSize: 13 } }
			},
			grid: { left: 80, right: 180, top: 60, bottom: 130 },
			xAxis: {
				type: 'value',
				name: xLabel,
				nameLocation: 'middle',
				nameGap: 50,
				nameTextStyle: { color: '#94a3b8', fontSize: 12 },
				axisLabel: {
					color: '#94a3b8',
					formatter: function(v) {
						return v >= 1000000 ? (v/1000000).toFixed(0) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v;
					}
				},
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
			},
			yAxis: {
				type: 'value',
				name: 'Charges ($)',
				nameLocation: 'end',
				nameTextStyle: { color: '#94a3b8', fontSize: 12 },
				axisLabel: {
					color: '#94a3b8',
					formatter: function(v) {
						return '$' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v);
					}
				},
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
			},
			dataZoom: [
				{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, borderColor: '#334155', backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: '#e2e8f0', borderColor: '#64748b' }, textStyle: { color: '#94a3b8' } },
				{ type: 'slider', yAxisIndex: 0, left: 5, width: 20, borderColor: '#334155', backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: '#e2e8f0', borderColor: '#64748b' }, textStyle: { color: '#94a3b8' } }
			],
			series: series
		};
	},

	setDefaults() {
		if (!appsmith.store.ldViewBy) storeValue('ldViewBy', 'ChargesVsConsumption');
	}
}