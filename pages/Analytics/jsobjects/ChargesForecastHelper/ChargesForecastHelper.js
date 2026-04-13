export default {

	// Aggregate total_charges by year
	getYearlyData() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byYear = {};
		data.forEach(function(r) {
			var yr = (r.time_period || '').substring(0, 4);
			if (!yr) return;
			if (!byYear[yr]) byYear[yr] = 0;
			byYear[yr] += parseFloat(r.total_charges) || 0;
		});
		return byYear;
	},

	// Bar chart — Charges over the Years
	getYearlyChartConfig() {
		var byYear = this.getYearlyData();
		var years = Object.keys(byYear).sort();
		var values = years.map(function(y) { return Number(byYear[y].toFixed(2)); });

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'axis' },
			grid: { left: 70, right: 30, top: 30, bottom: 40 },
			xAxis: {
				type: 'category',
				data: years,
				axisLabel: { color: '#94a3b8' }
			},
			yAxis: {
				type: 'value',
				axisLabel: { color: '#94a3b8' },
				splitLine: { lineStyle: { color: '#334155' } }
			},
			series: [{
				type: 'bar',
				name: 'Total Charges',
				itemStyle: { color: '#3B82F6' },
				data: values
			}]
		};
	},

	// Table for yearly totals
	getYearlyTableData() {
		var byYear = this.getYearlyData();
		var years = Object.keys(byYear).sort().reverse();
		return years.map(function(y) {
			return {
				'Year': y,
				'Total Charges': Number(byYear[y].toFixed(2))
			};
		});
	},

	// Aggregate total_charges by YYYY-MM
	getMonthlyData() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byMonth = {};
		data.forEach(function(r) {
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			if (!byMonth[mk]) byMonth[mk] = 0;
			byMonth[mk] += parseFloat(r.total_charges) || 0;
		});
		return byMonth;
	},

	_formatMonthYear(mk) {
		var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var p = mk.split('-');
		return (months[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
	},

	_formatMonthFull(mk) {
		var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
		var p = mk.split('-');
		return (months[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
	},

	// Simple linear regression forecast
	_forecast(months, values, numForecast) {
		var n = values.length;
		if (n < 2) return [];
		var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
		for (var i = 0; i < n; i++) {
			sumX += i;
			sumY += values[i];
			sumXY += i * values[i];
			sumX2 += i * i;
		}
		var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
		var intercept = (sumY - slope * sumX) / n;

		var result = [];
		for (var j = 0; j < numForecast; j++) {
			var idx = n + j;
			result.push(Number((intercept + slope * idx).toFixed(2)));
		}
		return result;
	},

	// Generate future month keys
	_futureMonths(lastMK, count) {
		var p = lastMK.split('-');
		var yr = parseInt(p[0], 10);
		var mo = parseInt(p[1], 10);
		var result = [];
		for (var i = 0; i < count; i++) {
			mo += 1;
			if (mo > 12) { mo = 1; yr += 1; }
			result.push(yr + '-' + (mo < 10 ? '0' + mo : '' + mo));
		}
		return result;
	},

	// Line chart — Charges by Year/Month and Forecast
	getMonthlyChartConfig() {
		var byMonth = this.getMonthlyData();
		var self = this;
		var months = Object.keys(byMonth).sort();
		var values = months.map(function(mk) { return Number(byMonth[mk].toFixed(2)); });
		var labels = months.map(function(m) { return self._formatMonthYear(m); });

		// Forecast 6 months
		var numForecast = 6;
		var forecastValues = this._forecast(months, values, numForecast);
		var futureKeys = months.length > 0 ? this._futureMonths(months[months.length - 1], numForecast) : [];
		var futureLabels = futureKeys.map(function(m) { return self._formatMonthYear(m); });

		var allLabels = labels.concat(futureLabels);

		// Actual series — fill forecast period with 0
		var actualData = values.concat(forecastValues.map(function() { return 0; }));

		// Forecast series — 0 for historical, then forecast values
		// Connect from last actual point
		var forecastData = values.map(function() { return 0; });
		if (values.length > 0) {
			forecastData[forecastData.length - 1] = values[values.length - 1];
		}
		forecastData = forecastData.concat(forecastValues);

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'axis' },
			legend: {
				data: ['Charges', 'Forecast'],
				textStyle: { color: '#e2e8f0' },
				top: 5
			},
			grid: { left: 70, right: 30, top: 40, bottom: 60 },
			xAxis: {
				type: 'category',
				data: allLabels,
				axisLabel: { color: '#94a3b8' }
			},
			yAxis: {
				type: 'value',
				name: 'Charges',
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8' },
				splitLine: { lineStyle: { color: '#334155' } }
			},
			series: [
				{
					name: 'Charges',
					type: 'line',
					itemStyle: { color: '#3B82F6' },
					data: actualData
				},
				{
					name: 'Forecast',
					type: 'line',
					itemStyle: { color: '#94a3b8' },
					lineStyle: { type: 'dashed' },
					data: forecastData
				}
			]
		};
	},

	// Monthly charges table (Calendar Month, Charges)
	getMonthlyTableData() {
		var byMonth = this.getMonthlyData();
		var self = this;
		var months = Object.keys(byMonth).sort();
		return months.map(function(mk) {
			return {
				'Calendar Month': self._formatMonthFull(mk),
				'Charges': '$' + Number(byMonth[mk].toFixed(2)).toLocaleString()
			};
		});
	},

	// Pivot table — rows = month names (Jan..Dec), columns = years, values = charges
	getTableData() {
		var byMonth = this.getMonthlyData();
		var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

		// Collect all years
		var yearSet = {};
		Object.keys(byMonth).forEach(function(mk) {
			yearSet[mk.substring(0, 4)] = true;
		});
		var years = Object.keys(yearSet).sort().reverse();

		var rows = monthNames.map(function(mName, mIdx) {
			var mo = (mIdx + 1 < 10 ? '0' : '') + (mIdx + 1);
			var row = { 'Month/Year': mName };
			var total = 0;
			years.forEach(function(yr) {
				var mk = yr + '-' + mo;
				var v = byMonth[mk] || 0;
				if (v !== 0) {
					total += v;
					row[yr] = '$' + Number(v.toFixed(2)).toLocaleString();
				} else {
					row[yr] = '';
				}
			});
			if (total !== 0) {
				row['Total'] = '$' + Number(total.toFixed(2)).toLocaleString();
			} else {
				row['Total'] = '';
			}
			return row;
		});

		// Add Total row
		var totalRow = { 'Month/Year': 'Total' };
		var grandTotal = 0;
		years.forEach(function(yr) {
			var yrTotal = 0;
			Object.keys(byMonth).forEach(function(mk) {
				if (mk.substring(0, 4) === yr) yrTotal += byMonth[mk];
			});
			grandTotal += yrTotal;
			totalRow[yr] = '$' + Number(yrTotal.toFixed(2)).toLocaleString();
		});
		totalRow['Total'] = '$' + Number(grandTotal.toFixed(2)).toLocaleString();
		rows.push(totalRow);

		return rows;
	},

	setDefaults() {
		// No view state needed for this tab
	}
}
