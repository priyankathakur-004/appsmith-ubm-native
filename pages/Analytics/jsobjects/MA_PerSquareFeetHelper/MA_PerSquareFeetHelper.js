export default {
	getViewBy() {
		return appsmith.store.psfViewBy || 'ChargesPerSqft';
	},

	getChartType() {
		return appsmith.store.psfChartType || 'bar';
	},

	getChartTitle() {
		var view = this.getViewBy();
		if (view === 'EUI') return 'Energy Use Intensity (kBtu/sqft)';
		if (view === 'ConsPerSqft') {
			// Match Power BI: "Consumption (KWH, CCF, MIN, THERM, MB, SQFEET, GAL) per Square Feet"
			var raw = fetch_analytics_data.data || [];
			var uoms = new Set();
			raw.forEach(function(r) { if (r.total_consumption_uom) uoms.add(r.total_consumption_uom); });
			var uomList = Array.from(uoms).sort();
			return 'Consumption' + (uomList.length ? ' (' + uomList.join(', ') + ')' : '') + ' per Square Feet';
		}
		return 'Charges per Square Feet ($/sqft)';
	},

	getLocationOptions() {
		var raw = fetch_analytics_data.data || [];
		var locs = new Set();
		raw.forEach(function(r) {
			var loc = r.location_description || 'Unknown';
			locs.add(loc);
		});
		return Array.from(locs).sort().map(function(loc) {
			return { label: loc, value: loc };
		});
	},

	getSelectedLocations() {
		// PSFLocCheckbox is a single-select custom widget. It exposes the
		// currently picked value at `PSFLocCheckbox.model.selectedValue`. When
		// nothing is picked (null), fall back to "all locations" so the chart
		// keeps rendering everything by default.
		var picked = (PSFLocCheckbox && PSFLocCheckbox.model && PSFLocCheckbox.model.selectedValue) || null;
		if (picked) return [picked];
		return this.getLocationOptions().map(function(o) { return o.value; });
	},

	// BTU conversion factors per utility. Power BI uses the simpler 100,000
	// BTU/CCF (1 therm equivalent) rather than the heating-value-corrected
	// 102,800, so we match that to keep PSF EUI consistent with PBI.
	// NOTE: this differs from MA_MonthlyEnergyHelper which uses 102800. If those
	// numbers ever need to match PBI too, update both maps in lockstep.
	_btuFactor(utilityType) {
		var map = {
			ELECTRIC:   3412,
			NATURALGAS: 100000,
			OIL2:       138500,
			STEAM:      1000,
			WATER:      0,
			SEWER:      0
		};
		var ut = String(utilityType || '').toUpperCase().replace(/[\s_-]/g, '');
		return map[ut] || 0;
	},

	// Aggregate raw rows into:
	//   { location: { year: { charges, consumption, cons, sqft, sqftSum } } }
	//
	// IMPORTANT — matching Power BI's denominator:
	// In Power BI the source table has `square_feet` denormalized onto every
	// bill row, and the EUI measure is `SUM(kBtu) / SUM(square_feet)`. Because
	// sqft is repeated on every row, the denominator effectively becomes
	// `sqft × row_count`. We replicate that here by summing sqft per row into
	// `sqftSum` and dividing by it in `getValue`. `sqft` is still kept as the
	// single per-site value for ConsPerSqft and ChargesPerSqft, which use the
	// classic single-sqft denominator.
	//
	// `consumption` is the raw mixed-UOM sum used by ConsPerSqft.
	// `cons` is the per-row energy total in mmBTU, same arithmetic as
	// MA_MonthlyEnergyHelper.getMonthlyData:  (consumption × factor) / 1e6.
	getPerSqftData() {
		var self = this;
		var raw = fetch_analytics_data.data || [];
		var selectedLocs = this.getSelectedLocations();
		var byLocYear = {};

		raw.forEach(function(r) {
			var loc = r.location_description || 'Unknown';
			if (!selectedLocs.includes(loc)) return;

			var sqft = parseFloat(r.square_feet) || 0;
			if (sqft <= 0) return;

			var date = r.time_period || r.bill_start_date || '';
			var year = (date || '').substring(0, 4);
			if (!year) return;

			if (!byLocYear[loc]) byLocYear[loc] = {};
			if (!byLocYear[loc][year]) byLocYear[loc][year] = { charges: 0, consumption: 0, cons: 0, sqft: sqft, sqftSum: 0 };

			var bucket = byLocYear[loc][year];
			var rawCons = parseFloat(r.consumption) || 0;
			var f = self._btuFactor(r.utility_type);

			bucket.charges += parseFloat(r.total_charges) || 0;
			bucket.consumption += rawCons;
			// mmBTU, same arithmetic as MA_MonthlyEnergyHelper.getMonthlyData.
			bucket.cons += (rawCons * f) / 1000000;
			// Sum sqft per row to mirror Power BI's SUM(square_feet).
			bucket.sqftSum += sqft;
		});

		return byLocYear;
	},

	getValue(d, view) {
		if (!d || !d.sqft || d.sqft <= 0) return 0;
		if (view === 'ConsPerSqft') return d.consumption / d.sqft;
		if (view === 'EUI') {
			// Match Power BI: SUM(kBtu) / SUM(square_feet).
			//   d.cons is mmBTU, ×1000 → kBTU.
			// Skip "unknown sqft" sites (sentinel value of 1) — PBI excludes
			// them from EUI because dividing by 1 produces nonsense values
			// that drown out everything else. The other two views still keep
			// these sites since they were correct before.
			if (d.sqft <= 1 || !d.sqftSum) return 0;
			return (d.cons * 1000) / d.sqftSum;
		}
		return d.charges / d.sqft;
	},

	// Year color palette mirrors the Power BI report: 2023 lime, 2024 sky-blue,
	// 2025 pink, 2026 deeper blue. Older years cycle through extras.
	_yearColor(year) {
		var map = {
			'2023': '#84cc16',
			'2024': '#3b82f6',
			'2025': '#f9a8d4',
			'2026': '#1d4ed8',
			'2027': '#fbbf24',
			'2028': '#a78bfa'
		};
		return map[year] || '#94a3b8';
	},

	_xAxisFormatter(view) {
		if (view === 'ChargesPerSqft') {
			return function(v) { return '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); };
		}
		return function(v) { return v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; };
	},

	_getSortedYearsAndLocations(byLocYear, view) {
		var self = this;
		var allYears = new Set();
		Object.values(byLocYear).forEach(function(years) {
			Object.keys(years).forEach(function(y) { allYears.add(y); });
		});
		// Newest year first to match Power BI (2026, 2025, 2024, 2023).
		var sortedYears = Array.from(allYears).sort().reverse().slice(0, 5);

		var locations = Object.keys(byLocYear);
		var locTotals = {};
		locations.forEach(function(loc) {
			var total = 0;
			sortedYears.forEach(function(year) {
				var d = (byLocYear[loc] || {})[year];
				if (d) total += self.getValue(d, view);
			});
			locTotals[loc] = total;
		});
		// Sort sites by combined total descending (matches Power BI ordering).
		locations.sort(function(a, b) { return locTotals[b] - locTotals[a]; });
		return { years: sortedYears, locations: locations };
	},

	// Build the dataZoom array. We render:
	//  - x-axis slider (bottom) for zooming the value range
	//  - y-axis slider (right) for dragging the locations list
	//  - y-axis `inside` zoom for mouse-wheel scrolling over the chart body
	//
	// The inside zoom previously caused a hover-freeze, but the actual culprit
	// turned out to be ECharts' default tooltip <div> capturing pointer events
	// (fixed via `extraCssText: pointer-events: none` on the bar tooltip). With
	// that fix in place the inside zoom is safe to use again.
	_buildDataZoom(locationCount) {
		// Show ~12 locations at a time; adjust if there are fewer total.
		var visible = Math.min(12, locationCount || 1);
		var endPct = locationCount > 0 ? (visible / locationCount) * 100 : 100;
		return [
			{
				type: 'slider',
				xAxisIndex: 0,
				bottom: 5,
				height: 18,
				borderColor: '#334155',
				backgroundColor: '#0f172a',
				fillerColor: 'rgba(59,130,246,0.15)',
				handleStyle: { color: '#e2e8f0', borderColor: '#64748b' },
				textStyle: { color: '#94a3b8' }
			},
			{
				type: 'slider',
				yAxisIndex: 0,
				right: 8,
				width: 14,
				start: 0,
				end: endPct,
				borderColor: '#334155',
				backgroundColor: '#0f172a',
				fillerColor: 'rgba(59,130,246,0.18)',
				handleStyle: { color: '#e2e8f0', borderColor: '#64748b' },
				textStyle: { color: '#94a3b8' },
				showDetail: false
			},
			{
				type: 'inside',
				yAxisIndex: 0,
				start: 0,
				end: endPct,
				zoomOnMouseWheel: false,
				moveOnMouseWheel: true,
				moveOnMouseMove: false,
				throttle: 50
			}
		];
	},

	getChartConfig() {
		var byLocYear = this.getPerSqftData();
		var view = this.getViewBy();
		var chartType = this.getChartType();
		var self = this;

		var sl = this._getSortedYearsAndLocations(byLocYear, view);
		var sortedYears = sl.years;
		var locations = sl.locations;

		var xFmt = this._xAxisFormatter(view);
		var dataZoom = this._buildDataZoom(locations.length);

		// Appsmith's CUSTOM_ECHART runs formatter functions in a sandboxed
		// scope with no access to outer closures or `appsmith.*`. Precompute
		// the display string on each data point and have formatters read
		// `p.data.label` (works for both bar and scatter).
		var isMoney = (view === 'ChargesPerSqft');
		// ConsPerSqft is shown rounded to whole numbers (matches Power BI).
		// EUI keeps 2 decimals (e.g. 33.15). ChargesPerSqft is currency.
		var isWhole = (view === 'ConsPerSqft');
		var formatNum = function(num) {
			if (num == null || num === 0) return '';
			if (isMoney) return '$' + Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			if (isWhole) return Math.round(Number(num)).toLocaleString();
			return Number(num).toLocaleString(undefined, { maximumFractionDigits: 2 });
		};

		// ---- Scatter view ----
		if (chartType === 'scatter') {
			var scatterSeries = sortedYears.map(function(year) {
				return {
					name: year,
					type: 'scatter',
					symbolSize: 14,
					itemStyle: { color: self._yearColor(year) },
					data: locations.map(function(loc) {
						var d = (byLocYear[loc] || {})[year];
						if (!d) return null;
						var num = Number(self.getValue(d, view).toFixed(2));
						return { value: [num, loc], label: formatNum(num) };
					}).filter(Boolean)
				};
			});

			return {
				backgroundColor: '#1E293B',
				tooltip: {
					trigger: 'item',
					confine: true,
					enterable: false,
					extraCssText: 'pointer-events: none;',
					backgroundColor: '#0f172a',
					borderColor: '#334155',
					textStyle: { color: '#e2e8f0' },
					formatter: function(p) {
						var loc = (p && p.value && p.value[1]) || '';
						var label = (p && p.data && p.data.label) || '';
						return '<b>' + p.seriesName + '</b><br/>' + loc + ': ' + label;
					}
				},
				legend: {
					right: 40, top: 10,
					textStyle: { color: '#e2e8f0', fontSize: 12 },
					icon: 'circle', itemWidth: 10, itemHeight: 10
				},
				grid: { left: 130, right: 60, top: 40, bottom: 50 },
				xAxis: {
					type: 'value',
					axisLabel: { color: '#94a3b8', formatter: xFmt },
					axisLine: { lineStyle: { color: '#334155' } },
					splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
				},
				yAxis: {
					type: 'category',
					data: locations,
					inverse: true,
					axisLabel: { color: '#e2e8f0', width: 110, overflow: 'truncate', fontSize: 12 },
					axisLine: { lineStyle: { color: '#334155' } }
				},
				dataZoom: dataZoom,
				series: scatterSeries
			};
		}

		// ---- Bar view (default) ----
		// Larger bar widths + small gap so each location row has visible thickness
		// for every year. The y-axis dataZoom keeps the visible window small
		// enough that bars don't get crushed regardless of total location count.
		var barSeries = sortedYears.map(function(year) {
			return {
				name: year,
				type: 'bar',
				barMaxWidth: 10,
				barGap: '10%',
				barCategoryGap: '35%',
				itemStyle: { color: self._yearColor(year), borderRadius: [0, 3, 3, 0] },
				// Show the precomputed value at the end of the bar on hover.
				emphasis: {
					focus: 'series',
					label: {
						show: true,
						position: 'right',
						color: '#e2e8f0',
						fontSize: 11,
						fontWeight: 'bold',
						formatter: function(p) {
							return (p && p.data && p.data.label) || '';
						}
					}
				},
				data: locations.map(function(loc) {
					var d = (byLocYear[loc] || {})[year];
					var v = d ? Number(self.getValue(d, view).toFixed(2)) : 0;
					return { value: v, label: formatNum(v) };
				})
			};
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				// `pointer-events: none` keeps the tooltip <div> from stealing
				// mouse/wheel events from the chart canvas — without this the
				// inside dataZoom locks up after the first hover.
				confine: true,
				enterable: false,
				extraCssText: 'pointer-events: none;',
				backgroundColor: '#0f172a',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' },
				formatter: function(params) {
					if (!params || !params.length) return '';
					var lines = ['<b>' + (params[0].axisValueLabel || params[0].name || '') + '</b>'];
					params.forEach(function(p) {
						var label = (p && p.data && p.data.label) || '';
						if (!label) return;
						lines.push(p.marker + p.seriesName + ': ' + label);
					});
					return lines.join('<br/>');
				}
			},
			legend: {
				right: 40,
				top: 10,
				textStyle: { color: '#e2e8f0', fontSize: 12 },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 130, right: 60, top: 40, bottom: 50 },
			xAxis: {
				type: 'value',
				axisLabel: { color: '#94a3b8', formatter: xFmt },
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
			},
			yAxis: {
				type: 'category',
				data: locations,
				inverse: true,
				axisLabel: { color: '#e2e8f0', width: 110, overflow: 'truncate', fontSize: 12 },
				axisLine: { lineStyle: { color: '#334155' } }
			},
			dataZoom: dataZoom,
			series: barSeries
		};
	},

	// Drill-through table that mirrors the Power BI tables: one row per
	// Location with one column per Year (newest first).
	getTableData() {
		var byLocYear = this.getPerSqftData();
		var view = this.getViewBy();
		var self = this;
		var sl = this._getSortedYearsAndLocations(byLocYear, view);
		var years = sl.years;
		var locations = sl.locations;

		// ConsPerSqft is rounded to whole numbers in the table (matches Power
		// BI). The other views keep two decimals.
		var roundWhole = (view === 'ConsPerSqft');
		var yrKeys = years.map(function(yr) { return yr + '\u2009'; });
		return locations.map(function(loc) {
			var row = { 'Location': loc };
			years.forEach(function(year, yi) {
				var d = (byLocYear[loc] || {})[year];
				if (!d) { row[yrKeys[yi]] = 0; return; }
				var v = self.getValue(d, view);
				row[yrKeys[yi]] = roundWhole ? Math.round(v) : Number(v.toFixed(2));
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.psfViewBy) storeValue('psfViewBy', 'ChargesPerSqft');
		if (!appsmith.store.psfChartType) storeValue('psfChartType', 'bar');
	}
}
