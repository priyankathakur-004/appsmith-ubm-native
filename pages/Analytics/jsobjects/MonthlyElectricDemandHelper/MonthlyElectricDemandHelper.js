export default {
	getViewBy() {
		return appsmith.store.medViewBy || 'Demand';
	},

	getChartType() {
		return appsmith.store.medChartType || 'scatter';
	},

	getChartTitle() {
		var view = this.getViewBy();
		if (view === 'DemandCharges') return 'Demand Charges by Location';
		if (view === 'ChargesPerKw') return 'Demand Charges / kW by Location';
		if (view === 'LoadFactor') return 'Load Factor (%) by Location';
		return 'Demand (kW) by Location';
	},

	getYAxisLabel() {
		var view = this.getViewBy();
		if (view === 'DemandCharges') return 'Demand Charges';
		if (view === 'ChargesPerKw') return 'Demand Charges / kW';
		if (view === 'LoadFactor') return 'Average of Load factor (%)';
		return 'Demand (kW)';
	},

	getLocationOptions() {
		var rows = this._getJoinedRows();
		var locs = new Set();
		rows.forEach(function(r) {
			var loc = r.location_description || 'Unknown';
			locs.add(loc);
		});
		return Array.from(locs).sort().map(function(loc) {
			return { label: loc, value: loc };
		});
	},

	getSelectedLocations() {
		// Single-select widget; null = "all locations".
		var picked = (MEDLocCheckbox && MEDLocCheckbox.model && MEDLocCheckbox.model.selectedValue) || null;
		if (picked) return [picked];
		return this.getLocationOptions().map(function(o) { return o.value; });
	},

	// Join fetch_demand_loadfactor (has demand + load_factor) with
	// fetch_analytics_data (has total_charges_demand) on
	// (location_id, time_period). We hard-filter to ELECTRIC because this
	// page is "Monthly Electric Demand" — Power BI does the same. We do the
	// join in JS rather than touching the SQL so other tabs that share
	// fetch_demand_loadfactor are unaffected.
	_getJoinedRows() {
		var demandRaw = (fetch_demand_loadfactor && fetch_demand_loadfactor.data) || [];
		var analyticsRaw = (fetch_analytics_data && fetch_analytics_data.data) || [];

		// Index analytics rows by `${location_id}|${time_period}` for ELECTRIC only.
		var chargesByKey = {};
		analyticsRaw.forEach(function(r) {
			var ut = String(r.utility_type || '').toUpperCase();
			if (ut !== 'ELECTRIC') return;
			var key = r.location_id + '|' + (r.time_period || '').substring(0, 10);
			chargesByKey[key] = parseFloat(r.total_charges_demand) || 0;
		});

		var out = [];
		demandRaw.forEach(function(r) {
			var ut = String(r.utility_type || '').toUpperCase();
			if (ut !== 'ELECTRIC') return;
			var tp = (r.time_period || '').substring(0, 10);
			if (!tp) return;
			var key = r.location_id + '|' + tp;
			out.push({
				location_id: r.location_id,
				location_description: r.location_description || 'Unknown',
				time_period: tp,
				demand: parseFloat(r.demand) || 0,
				load_factor: r.load_factor == null ? null : parseFloat(r.load_factor),
				demand_charges: chargesByKey[key] || 0
			});
		});
		return out;
	},

	// Aggregate joined rows into:
	//   { location: { monthYearKey: { demand, demandCharges, loadFactorSum, loadFactorCount } } }
	// monthYearKey is "YYYY-MM" so it sorts naturally.
	getMonthlyData() {
		var rows = this._getJoinedRows();
		var selectedLocs = this.getSelectedLocations();
		var byLocMonth = {};

		rows.forEach(function(r) {
			if (selectedLocs.indexOf(r.location_description) === -1) return;
			var mk = (r.time_period || '').substring(0, 7); // YYYY-MM
			if (!mk) return;
			var loc = r.location_description;
			if (!byLocMonth[loc]) byLocMonth[loc] = {};
			if (!byLocMonth[loc][mk]) byLocMonth[loc][mk] = { demand: 0, demandCharges: 0, loadFactorSum: 0, loadFactorCount: 0 };
			var b = byLocMonth[loc][mk];
			b.demand += r.demand;
			b.demandCharges += r.demand_charges;
			if (r.load_factor != null && !isNaN(r.load_factor)) {
				b.loadFactorSum += r.load_factor;
				b.loadFactorCount += 1;
			}
		});
		return byLocMonth;
	},

	getValue(d, view) {
		if (!d) return null;
		if (view === 'DemandCharges') return d.demandCharges;
		if (view === 'ChargesPerKw') return d.demand > 0 ? d.demandCharges / d.demand : 0;
		if (view === 'LoadFactor') return d.loadFactorCount > 0 ? d.loadFactorSum / d.loadFactorCount : null;
		return d.demand; // 'Demand'
	},

	// Format YYYY-MM → "Jan 2023"
	_formatMonthYear(mk) {
		var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var parts = mk.split('-');
		var y = parts[0];
		var m = parseInt(parts[1], 10) - 1;
		return (months[m] || '') + ' ' + y;
	},

	// Stable color per location (cycles through palette).
	_locationColor(idx) {
		var palette = [
			'#3b82f6','#1e40af','#84cc16','#0f766e','#22c55e','#065f46','#0ea5e9',
			'#94a3b8','#06b6d4','#fbcfe8','#67e8f9','#475569','#f87171','#fbbf24'
		];
		return palette[idx % palette.length];
	},

	// Sorted list of all month keys present across all locations.
	_getAllMonths(byLocMonth) {
		var monthSet = {};
		Object.keys(byLocMonth).forEach(function(loc) {
			Object.keys(byLocMonth[loc] || {}).forEach(function(m) { monthSet[m] = true; });
		});
		return Object.keys(monthSet).sort();
	},

	_xAxisFormatter(view) {
		if (view === 'DemandCharges' || view === 'ChargesPerKw') {
			return function(v) { return '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); };
		}
		return function(v) { return v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; };
	},

	getChartConfig() {
		var byLocMonth = this.getMonthlyData();
		var view = this.getViewBy();
		var chartType = this.getChartType();
		var self = this;

		var months = this._getAllMonths(byLocMonth);
		var monthLabels = months.map(function(m) { return self._formatMonthYear(m); });
		var locations = Object.keys(byLocMonth).sort();

		var isMoney = (view === 'DemandCharges' || view === 'ChargesPerKw');
		var isPct = (view === 'LoadFactor');

		var formatNum = function(num) {
			if (num == null) return '';
			if (isMoney) return '$' + Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			if (isPct) return Number(num).toFixed(2) + '%';
			return Number(num).toLocaleString(undefined, { maximumFractionDigits: 2 });
		};

		var xAxisFormatter = this._xAxisFormatter(view);

		var seriesType = (chartType === 'line') ? 'line' : 'scatter';
		var yAxisLabel = this.getYAxisLabel();

		var series = locations.map(function(loc, idx) {
			var color = self._locationColor(idx);
			var data = months.map(function(mk) {
				var d = (byLocMonth[loc] || {})[mk];
				if (!d) return null;
				var v = self.getValue(d, view);
				if (v == null) return null;
				var num = Number(Number(v).toFixed(2));
				return { value: num, label: formatNum(num) };
			});
			var s = {
				name: loc,
				type: seriesType,
				itemStyle: { color: color },
				data: data
			};
			if (seriesType === 'line') {
				s.lineStyle = { color: color, width: 2 };
				s.symbol = 'circle';
				s.symbolSize = 6;
				s.connectNulls = false;
			} else {
				s.symbolSize = 10;
			}
			return s;
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				confine: true,
				enterable: false,
				extraCssText: 'pointer-events: none;',
				backgroundColor: '#0f172a',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' },
				formatter: function(params) {
					if (!params || !params.length) return '';
					var header = (params[0] && (params[0].axisValueLabel || params[0].name)) || '';
					var lines = ['<b>' + header + '</b>'];
					params.forEach(function(p) {
						var label = (p && p.data && p.data.label) || '';
						if (!label) return;
						lines.push(p.marker + p.seriesName + ': ' + label);
					});
					return lines.join('<br/>');
				}
			},
			legend: {
				type: 'scroll',
				right: 40,
				top: 10,
				textStyle: { color: '#e2e8f0', fontSize: 12 },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 60, top: 60, bottom: 60 },
			xAxis: {
				type: 'category',
				data: monthLabels,
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 35,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8', rotate: 35 },
				axisLine: { lineStyle: { color: '#334155' } }
			},
			yAxis: {
				type: 'value',
				name: yAxisLabel,
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8', formatter: xAxisFormatter },
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
			},
			series: series
		};
	},

	// Drill-through table — one row per Location, one column per MonthYear.
	getTableData() {
		var byLocMonth = this.getMonthlyData();
		var view = this.getViewBy();
		var self = this;
		var months = this._getAllMonths(byLocMonth);
		var locations = Object.keys(byLocMonth).sort();

		return locations.map(function(loc) {
			var row = { 'Location': loc };
			months.forEach(function(mk) {
				var d = (byLocMonth[loc] || {})[mk];
				var v = d ? self.getValue(d, view) : null;
				row[self._formatMonthYear(mk)] = (v == null) ? 0 : Number(Number(v).toFixed(2));
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.medViewBy) storeValue('medViewBy', 'Demand');
		if (!appsmith.store.medChartType) storeValue('medChartType', 'scatter');
	}
}
