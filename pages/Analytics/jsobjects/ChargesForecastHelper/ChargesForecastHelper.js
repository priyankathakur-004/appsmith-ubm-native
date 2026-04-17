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
		var self = this;
		var years = Object.keys(byYear).sort().reverse();
		return years.map(function(y) {
			return {
				'Year': y,
				'Total Charges': self._fmtDollar(byYear[y])
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

	// Seasonal naive forecast — look 11 months back to match PBI behavior.
	// If no data exists for that month, cycle through available months.
	_seasonalForecast(byMonth, months, futureKeys) {
		return futureKeys.map(function(fk) {
			var p = fk.split('-');
			var yr = parseInt(p[0], 10);
			var mo = parseInt(p[1], 10);
			// 11 months back
			var prevMo = mo - 11;
			var prevYr = yr;
			while (prevMo < 1) { prevMo += 12; prevYr -= 1; }
			var prevKey = prevYr + '-' + (prevMo < 10 ? '0' + prevMo : '' + prevMo);
			var v = byMonth[prevKey];
			if (v != null) return Number(v.toFixed(2));
			// Fallback: cycle through sorted months
			var idx = futureKeys.indexOf(fk) % months.length;
			return Number((byMonth[months[idx]] || 0).toFixed(2));
		});
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

		// Forecast 12 months using seasonal naive (11-month lookback)
		var numForecast = 12;
		var futureKeys = months.length > 0 ? this._futureMonths(months[months.length - 1], numForecast) : [];
		var forecastValues = this._seasonalForecast(byMonth, months, futureKeys);
		var futureLabels = futureKeys.map(function(m) { return self._formatMonthYear(m); });

		var allLabels = labels.concat(futureLabels);

		// Actual series — real values for historical, 0 for forecast months
		var actualData = [];
		var i;
		for (i = 0; i < values.length; i++) { actualData.push(values[i]); }
		for (i = 0; i < numForecast; i++) { actualData.push(0); }

		// Forecast series — 0 for historical (except last actual = bridge), then forecast
		var forecastData = [];
		for (i = 0; i < values.length - 1; i++) { forecastData.push(0); }
		if (values.length > 0) {
			forecastData.push(values[values.length - 1]);
		}
		for (i = 0; i < forecastValues.length; i++) { forecastData.push(forecastValues[i]); }

		// Upper/Lower bound series — same values as forecast (PBI shows identical bounds)
		var upperData = forecastData.slice();
		var lowerData = forecastData.slice();

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'axis' },
			legend: {
				data: ['Charges', 'Charges Forecast'],
				textStyle: { color: '#e2e8f0' },
				top: 5
			},
			grid: { left: 80, right: 30, top: 40, bottom: 80 },
			dataZoom: [
				{
					type: 'slider',
					xAxisIndex: 0,
					bottom: 10,
					height: 20,
					borderColor: '#334155',
					backgroundColor: '#0f172a',
					fillerColor: 'rgba(59,130,246,0.15)',
					textStyle: { color: '#94a3b8' }
				},
				{
					type: 'slider',
					yAxisIndex: 0,
					right: 5,
					width: 20,
					borderColor: '#334155',
					backgroundColor: '#0f172a',
					fillerColor: 'rgba(59,130,246,0.15)',
					textStyle: { color: '#94a3b8' }
				}
			],
			xAxis: {
				type: 'category',
				data: allLabels,
				axisLabel: { color: '#94a3b8' }
			},
			yAxis: {
				type: 'value',
				name: 'Charges',
				nameLocation: 'middle',
				nameGap: 65,
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
					name: 'Charges Forecast',
					type: 'line',
					itemStyle: { color: '#333333' },
					lineStyle: { type: 'dashed', color: '#94a3b8' },
					data: forecastData
				},
				{
					name: 'Upper bound',
					type: 'line',
					itemStyle: { color: '#334155' },
					lineStyle: { width: 0 },
					data: upperData,
					showSymbol: false
				},
				{
					name: 'Lower bound',
					type: 'line',
					itemStyle: { color: '#334155' },
					lineStyle: { width: 0 },
					data: lowerData,
					showSymbol: false
				}
			]
		};
	},

	_fmtDollar(v) {
		var parts = Math.abs(v).toFixed(2).split('.');
		var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		var formatted = '$' + intPart + '.' + parts[1];
		return v < 0 ? '(' + formatted + ')' : formatted;
	},

	// Monthly charges table (Calendar Month, Charges)
	getMonthlyTableData() {
		var byMonth = this.getMonthlyData();
		var self = this;
		var months = Object.keys(byMonth).sort();
		return months.map(function(mk) {
			return {
				'Calendar Month': self._formatMonthFull(mk),
				'Charges': self._fmtDollar(byMonth[mk])
			};
		});
	},

	// Pivot table — rows = month names (Jan..Dec), columns = years, values = charges
	getTableData() {
		var byMonth = this.getMonthlyData();
		var self = this;
		var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

		var yearSet = {};
		Object.keys(byMonth).forEach(function(mk) {
			yearSet[mk.substring(0, 4)] = true;
		});
		var years = Object.keys(yearSet).sort().reverse();

		// Use trailing thin space on year keys to prevent V8 numeric key reordering
		var yrKeys = years.map(function(yr) { return yr + '\u2009'; });

		var rows = monthNames.map(function(mName, mIdx) {
			var mo = (mIdx + 1 < 10 ? '0' : '') + (mIdx + 1);
			var row = { 'Month': mName };
			var total = 0;
			years.forEach(function(yr, yi) {
				var mk = yr + '-' + mo;
				var v = byMonth[mk] || 0;
				if (v !== 0) {
					total += v;
					row[yrKeys[yi]] = self._fmtDollar(v);
				} else {
					row[yrKeys[yi]] = '';
				}
			});
			row['Total'] = total !== 0 ? self._fmtDollar(total) : '';
			return row;
		});

		var totalRow = { 'Month': 'Total' };
		var grandTotal = 0;
		years.forEach(function(yr, yi) {
			var yrTotal = 0;
			Object.keys(byMonth).forEach(function(mk) {
				if (mk.substring(0, 4) === yr) yrTotal += byMonth[mk];
			});
			grandTotal += yrTotal;
			totalRow[yrKeys[yi]] = self._fmtDollar(yrTotal);
		});
		totalRow['Total'] = self._fmtDollar(grandTotal);
		rows.push(totalRow);

		return rows;
	},

	getPivotHtml() {
		var tbl = this.getTableData();
		if (!tbl || !tbl.length) return '';
		var keys = Object.keys(tbl[0]);
		var thStyle = 'padding:8px 12px;color:#94A3B8;font-size:12px;font-weight:600;border-bottom:1px solid #475569;';
		var tdStyle = 'padding:8px 12px;color:#E2E8F0;font-size:12px;border-bottom:1px solid #334155;';
		var header = '<tr style="background:#334155;">' + keys.map(function(k) {
			var align = k === 'Month' ? 'left' : 'right';
			return '<th style="' + thStyle + 'text-align:' + align + ';">' + k.trim() + '</th>';
		}).join('') + '</tr>';
		var rows = tbl.map(function(r, idx) {
			var isTotal = r['Month'] === 'Total';
			var rowStyle = isTotal ? 'background:#334155;font-weight:700;' : '';
			return '<tr style="' + rowStyle + '">' + keys.map(function(k) {
				var align = k === 'Month' ? 'left' : 'right';
				var fw = isTotal ? 'font-weight:700;' : '';
				return '<td style="' + tdStyle + 'text-align:' + align + ';' + fw + '">' + (r[k] || '') + '</td>';
			}).join('') + '</tr>';
		}).join('');
		return '<table style="width:100%;border-collapse:collapse;background:#1E293B;">' + header + rows + '</table>';
	},

	setDefaults() {
		// No view state needed for this tab
	}
}
