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

	// FULL OUTER JOIN of fetch_demand_loadfactor (demand, load_factor) and
	// fetch_analytics_data (total_charges_demand) on (location, month).
	// Hard-filtered to ELECTRIC since this page is "Monthly Electric Demand".
	//
	// IMPORTANT: fetch_analytics_data may have multiple rows per
	// (location, month, utility) — one per bill — but each row's
	// `total_charges_demand` is the SUM across all those bills (broadcast by
	// the LATERAL join in the SQL). So we use last-write-wins, NOT sum.
	_getJoinedRows() {
		var demandRaw = (fetch_demand_loadfactor && fetch_demand_loadfactor.data) || [];
		var analyticsRaw = (fetch_analytics_data && fetch_analytics_data.data) || [];

		var byKey = {};
		function ensure(key, locDesc, tp) {
			if (!byKey[key]) {
				byKey[key] = {
					location_description: locDesc,
					time_period: tp,
					demand: 0,
					hasDemand: false,
					load_factor: null,
					demand_charges: 0,
					charges_bill_count: 0
				};
			}
			return byKey[key];
		}

		// Demand side
		demandRaw.forEach(function(r) {
			var ut = String(r.utility_type || '').toUpperCase();
			if (ut !== 'ELECTRIC') return;
			var tp = (r.time_period || '').substring(0, 10);
			if (!tp) return;
			var loc = r.location_description || 'Unknown';
			var key = loc + '|' + tp;
			var entry = ensure(key, loc, tp);
			entry.demand += parseFloat(r.demand) || 0;
			entry.hasDemand = true;
			if (r.load_factor != null && !isNaN(parseFloat(r.load_factor))) {
				entry.load_factor = (entry.load_factor || 0) + parseFloat(r.load_factor);
			}
		});

		// Charges side — last-write-wins for the value (SQL already broadcasts
		// SUM() to every row), but we COUNT bill rows because Power BI's
		// $/kW measure double-counts for locations with multiple bills per
		// month (see comment in getTableData).
		analyticsRaw.forEach(function(r) {
			var ut = String(r.utility_type || '').toUpperCase();
			if (ut !== 'ELECTRIC') return;
			var tp = (r.time_period || '').substring(0, 10);
			if (!tp) return;
			var loc = r.location_description || 'Unknown';
			var key = loc + '|' + tp;
			var entry = ensure(key, loc, tp);
			entry.demand_charges = parseFloat(r.total_charges_demand) || 0;
			entry.charges_bill_count += 1;
		});

		return Object.keys(byKey).map(function(k) { return byKey[k]; });
	},

	// "YYYY-MM" → integer for distance comparisons.
	_monthIndex(mk) {
		var p = mk.split('-');
		return parseInt(p[0], 10) * 12 + parseInt(p[1], 10);
	},

	// Aggregate joined rows into:
	//   { location: { monthYearKey: { demand, demandCharges, loadFactorSum, loadFactorCount, hasDemand } } }
	// monthYearKey is "YYYY-MM" so it sorts naturally.
	//
	// After bucketing, fills missing-demand months from the NEAREST month in
	// the same location that has a demand value. This matches Power BI's
	// drillthrough behavior — e.g., Site 100 charges exist in Jan/Feb 2025
	// but demand_loadfactor only has Site 100 in Mar 2025; PBI shows demand
	// 222 for Jan/Feb/Mar by broadcasting Mar's value to its neighbors.
	getMonthlyData() {
		var rows = this._getJoinedRows();
		var selectedLocs = this.getSelectedLocations();
		var self = this;
		var byLocMonth = {};

		rows.forEach(function(r) {
			if (selectedLocs.indexOf(r.location_description) === -1) return;
			var mk = (r.time_period || '').substring(0, 7); // YYYY-MM
			if (!mk) return;
			var loc = r.location_description;
			if (!byLocMonth[loc]) byLocMonth[loc] = {};
			if (!byLocMonth[loc][mk]) byLocMonth[loc][mk] = { demand: 0, demandCharges: 0, chargesBillCount: 0, loadFactorSum: 0, loadFactorCount: 0, hasDemand: false, hasLoadFactor: false };
			var b = byLocMonth[loc][mk];
			b.demand += r.demand;
			b.demandCharges += r.demand_charges;
			b.chargesBillCount += r.charges_bill_count || 0;
			if (r.hasDemand) b.hasDemand = true;
			if (r.load_factor != null && !isNaN(r.load_factor)) {
				b.loadFactorSum += r.load_factor;
				b.loadFactorCount += 1;
				b.hasLoadFactor = true;
			}
		});

		// Nearest-month fill: for every location, walk its rows and copy
		// demand from the nearest month (same location) that has a real
		// demand reading. Same treatment for load factor.
		Object.keys(byLocMonth).forEach(function(loc) {
			var monthsForLoc = byLocMonth[loc];
			var monthsWithDemand = Object.keys(monthsForLoc).filter(function(mk) {
				return monthsForLoc[mk].hasDemand;
			});
			if (monthsWithDemand.length === 0) return;

			Object.keys(monthsForLoc).forEach(function(mk) {
				var entry = monthsForLoc[mk];
				if (entry.hasDemand) return;
				var idx = self._monthIndex(mk);
				var bestKey = monthsWithDemand[0];
				var bestDist = Math.abs(self._monthIndex(bestKey) - idx);
				for (var i = 1; i < monthsWithDemand.length; i++) {
					var d = Math.abs(self._monthIndex(monthsWithDemand[i]) - idx);
					if (d < bestDist) { bestKey = monthsWithDemand[i]; bestDist = d; }
				}
				var src = monthsForLoc[bestKey];
				entry.demand = src.demand;
				// Do NOT copy load factor across months — PBI shows load
				// factor only for months that have a real reading.
			});
		});

		return byLocMonth;
	},

	getValue(d, view) {
		if (!d) return null;
		if (view === 'DemandCharges') return d.demandCharges;
		if (view === 'ChargesPerKw') {
			// PBI's $/kW measure = SUM(charges) / MAX(demand) and SUM iterates
			// over bill rows so the broadcast charges value is multiplied by
			// chargesBillCount.
			var billCount = d.chargesBillCount > 0 ? d.chargesBillCount : 1;
			return d.demand > 0 ? (d.demandCharges * billCount) / d.demand : 0;
		}
		if (view === 'LoadFactor') {
			// Load factor is a percentage (0..100). The SQL SUMs load_factor
			// across bill_blocks, so when a bill has multiple blocks the
			// stored value can exceed 100. PBI normalizes by dividing by the
			// smallest integer that brings it back under 100 — i.e. the
			// number of blocks that summed into it. We don't have that count
			// directly but can derive it as `ceil(lf / 100)`. Examples:
			//   Site 100 Mar 2025: 164.30 / 2 = 82.15
			//   Site 99 Jun 2025:  114.15 / 2 = 57.07
			//   Site 99 Mar 2025:   54.60 / 1 = 54.60 (no divide needed)
			// Only return a value if there's real load_factor data for this
			// (loc, month) — never use the nearest-month-filled value, which
			// PBI doesn't do for load factor.
			if (!d.hasLoadFactor || d.loadFactorSum == null || d.loadFactorSum === 0) return null;
			var divisor = Math.max(1, Math.ceil(d.loadFactorSum / 100));
			return d.loadFactorSum / divisor;
		}
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

	// Stable color per location. Bright Tailwind-400 hues chosen to pop on
	// the dark slate background; adjacent palette entries are spaced around
	// the color wheel so neighboring series stay visually distinct.
	_locationColor(idx) {
		var palette = [
			'#60a5fa', // sky blue
			'#34d399', // emerald / mint
			'#f472b6', // hot pink
			'#fbbf24', // amber
			'#a78bfa', // lavender
			'#22d3ee', // electric cyan
			'#fb923c', // orange
			'#4ade80', // fresh green
			'#f87171', // coral
			'#c084fc', // light purple
			'#facc15', // bright yellow
			'#2dd4bf', // teal
			'#818cf8', // indigo
			'#fda4af'  // rose
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

		// Drop locations whose currently-selected view value is zero/null for
		// every month — they'd just clutter the legend with empty series.
		var locations = Object.keys(byLocMonth).filter(function(loc) {
			var monthsForLoc = byLocMonth[loc] || {};
			return Object.keys(monthsForLoc).some(function(mk) {
				var v = self.getValue(monthsForLoc[mk], view);
				return v != null && v > 0;
			});
		}).sort();

		// Drop months that have no non-zero value across the visible
		// locations, so the x-axis doesn't include empty trailing months.
		var months = this._getAllMonths(byLocMonth).filter(function(mk) {
			return locations.some(function(loc) {
				var v = self.getValue((byLocMonth[loc] || {})[mk], view);
				return v != null && v > 0;
			});
		});
		var monthLabels = months.map(function(m) { return self._formatMonthYear(m); });

		var seriesType = (chartType === 'line') ? 'line' : 'scatter';
		// Each data point embeds all three metrics so the tooltip formatter
		// (which runs in Appsmith's sandboxed scope and can't see outer
		// closures) can read them directly from `p.data`.
		var series = locations.map(function(loc, idx) {
			var color = self._locationColor(idx);
			var data = months.map(function(mk) {
				var d = (byLocMonth[loc] || {})[mk];
				var demand = d ? d.demand : 0;
				var charges = d ? d.demandCharges : 0;
				var billCount = (d && d.chargesBillCount > 0) ? d.chargesBillCount : 1;
				var perKw = (d && d.demand > 0) ? ((d.demandCharges * billCount) / d.demand) : 0;
				var v = self.getValue(d, view);
				var num = v == null ? 0 : Number(Number(v).toFixed(2));
				return {
					value: num,
					loc: loc,
					demand: Math.round(demand),
					charges: Number(charges.toFixed(2)),
					perKw: Number(perKw.toFixed(2))
				};
			});
			return {
				name: loc,
				type: seriesType,
				itemStyle: { color: color },
				data: data
			};
		});

		// Tooltip formatter is view-aware. For LoadFactor view we show a
		// minimal `<b>Apr 2025</b><br/>● Site 92    31.27` layout matching
		// PBI. For all other views we keep the multi-metric layout.
		var tooltipFormatter;
		if (view === 'LoadFactor') {
			tooltipFormatter = function(params) {
				if (!params || !params.length) return '';
				var header = (params[0] && (params[0].axisValueLabel || params[0].name)) || '';
				var lines = ['<b>' + header + '</b>'];
				params.forEach(function(p) {
					var d = p && p.data;
					if (!d || d.value == null || d.value <= 0) return;
					lines.push(p.marker + d.loc + '&nbsp;&nbsp;&nbsp;&nbsp;' + Number(d.value).toFixed(2));
				});
				return lines.join('<br/>');
			};
		} else {
			tooltipFormatter = function(params) {
				if (!params || !params.length) return '';
				var header = (params[0] && (params[0].axisValueLabel || params[0].name)) || '';
				var lines = ['<b>' + header + '</b>'];
				params.forEach(function(p) {
					var d = p && p.data;
					if (!d) return;
					if ((d.demand || 0) <= 0 && (d.charges || 0) <= 0) return;
					lines.push(p.marker + '<b>' + d.loc + '</b>');
					lines.push('&nbsp;&nbsp;Demand (kW): ' + d.demand);
					lines.push('&nbsp;&nbsp;Demand Charges: $' + Number(d.charges).toFixed(2));
					lines.push('&nbsp;&nbsp;Demand Charges / kW: $' + Number(d.perKw).toFixed(2));
				});
				return lines.join('<br/>');
			};
		}

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				formatter: tooltipFormatter
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 'middle',
				textStyle: { color: '#e2e8f0', fontSize: 12 },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 80, right: 140, top: 40, bottom: 60 },
			xAxis: { type: 'category', data: monthLabels, axisLabel: { color: '#94a3b8' } },
			yAxis: {
				type: 'value',
				axisLabel: { color: '#94a3b8' },
				splitLine: { lineStyle: { color: '#475569', type: 'dashed' } }
			},
			series: series
		};
		
	},

	_getChartConfigFull() {
		var byLocMonth = this.getMonthlyData();
		var view = this.getViewBy();
		var chartType = this.getChartType();
		var self = this;

		// Drop locations whose currently-selected view value is zero/null for
		// every month — they'd just clutter the legend with empty series.
		var locations = Object.keys(byLocMonth).filter(function(loc) {
			var monthsForLoc = byLocMonth[loc] || {};
			return Object.keys(monthsForLoc).some(function(mk) {
				var v = self.getValue(monthsForLoc[mk], view);
				return v != null && v > 0;
			});
		}).sort();

		// Drop months that have no non-zero value across the visible
		// locations, so the x-axis doesn't include empty trailing months.
		var months = this._getAllMonths(byLocMonth).filter(function(mk) {
			return locations.some(function(loc) {
				var v = self.getValue((byLocMonth[loc] || {})[mk], view);
				return v != null && v > 0;
			});
		});
		var monthLabels = months.map(function(m) { return self._formatMonthYear(m); });

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

	// Drill-through table — view-aware. For Demand / DemandCharges / ChargesPerKw
	// it shows one row per MonthYear with three sub-columns per location
	// (Demand kW / Demand Charges / Demand Charges / kW). For LoadFactor it
	// shows one column per location with the load factor %, mirroring PBI.
	getTableData() {
		var view = this.getViewBy();
		if (view === 'LoadFactor') return this._getLoadFactorTable();
		return this._getDemandTable();
	},

	_getDemandTable() {
		var byLocMonth = this.getMonthlyData();
		var self = this;
		var months = this._getAllMonths(byLocMonth);

		// Drop locations whose demand AND demandCharges are zero for every
		// month — they'd just produce empty columns.
		var locations = Object.keys(byLocMonth).filter(function(loc) {
			var monthsForLoc = byLocMonth[loc] || {};
			return Object.keys(monthsForLoc).some(function(mk) {
				var d = monthsForLoc[mk];
				return d && (d.demand > 0 || d.demandCharges > 0);
			});
		}).sort();

		var rows = months.map(function(mk) {
			var row = { 'MonthYear': self._formatMonthYear(mk) };
			var hasAnyValue = false;
			locations.forEach(function(loc) {
				var d = (byLocMonth[loc] || {})[mk];
				var demand = d ? d.demand : 0;
				var charges = d ? d.demandCharges : 0;
				// Match Power BI's $/kW measure: SUM(charges_demand) / MAX(demand).
				// Because the SQL LATERAL join broadcasts the same charges value
				// to every bill row, "SUM" effectively multiplies by the number
				// of bill rows (which we tracked in charges_bill_count). The
				// Charges column itself shows the un-multiplied value to match
				// PBI's column display.
				var billCount = (d && d.chargesBillCount > 0) ? d.chargesBillCount : 1;
				var perKw = (d && d.demand > 0) ? ((d.demandCharges * billCount) / d.demand) : 0;
				if (demand > 0 || charges > 0) hasAnyValue = true;
				row[loc + ' Demand (kW)'] = Math.round(demand);
				row[loc + ' Demand Charges'] = Number(charges.toFixed(2));
				row[loc + ' Demand Charges / kW'] = Number(perKw.toFixed(2));
			});
			row.__hasAnyValue = hasAnyValue;
			return row;
		});

		// Drop month rows where every visible location has zero values.
		return rows.filter(function(r) { return r.__hasAnyValue; }).map(function(r) {
			delete r.__hasAnyValue;
			return r;
		});
	},

	_getLoadFactorTable() {
		var byLocMonth = this.getMonthlyData();
		var self = this;
		var months = this._getAllMonths(byLocMonth);

		// Drop locations whose load factor is zero/null for every month.
		var locations = Object.keys(byLocMonth).filter(function(loc) {
			var monthsForLoc = byLocMonth[loc] || {};
			return Object.keys(monthsForLoc).some(function(mk) {
				var v = self.getValue(monthsForLoc[mk], 'LoadFactor');
				return v != null && v > 0;
			});
		}).sort();

		var rows = months.map(function(mk) {
			var row = { 'MonthYear': self._formatMonthYear(mk) };
			var hasAnyValue = false;
			locations.forEach(function(loc) {
				var d = (byLocMonth[loc] || {})[mk];
				var v = self.getValue(d, 'LoadFactor');
				if (v != null && v > 0) hasAnyValue = true;
				row[loc] = (v == null) ? 0 : Number(v.toFixed(2));
			});
			row.__hasAnyValue = hasAnyValue;
			return row;
		});

		return rows.filter(function(r) { return r.__hasAnyValue; }).map(function(r) {
			delete r.__hasAnyValue;
			return r;
		});
	},

	setDefaults() {
		if (!appsmith.store.medViewBy) storeValue('medViewBy', 'Demand');
		if (!appsmith.store.medChartType) storeValue('medChartType', 'scatter');
	}
}
