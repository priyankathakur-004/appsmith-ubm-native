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

	// Standard kBtu conversion factors (EPA Portfolio Manager values), keyed by
	// (utility_type, uom). We key on utility too because units like CCF / GAL
	// can mean different things for water vs gas vs fuel oil and we must not
	// count water/sewer volumes as energy.
	_kBtuFactor(utilityType, uom) {
		if (!uom) return 0;
		var ut = String(utilityType || '').toUpperCase().replace(/[\s_-]/g, '');
		var u = String(uom).toUpperCase().trim();

		// Electricity: only KWH counts as energy.
		if (ut === 'ELECTRIC' || ut === 'ELECTRICITY') {
			if (u === 'KWH') return 3.412;
			if (u === 'MWH') return 3412;
			return 0;
		}
		// Natural gas.
		if (ut === 'NATURALGAS' || ut === 'GAS') {
			if (u === 'THERM' || u === 'THERMS') return 100;
			if (u === 'CCF') return 102.6;       // ~1026 BTU/cf heating value
			if (u === 'MCF') return 1026;
			if (u === 'MMBTU' || u === 'MB' || u === 'MBTU') return 1000;
			return 0;
		}
		// Fuel oil.
		if (ut.indexOf('FUELOIL') === 0 || ut === 'OIL') {
			if (u === 'GAL' || u === 'GALLONS') return 138.5;
			return 0;
		}
		// District steam.
		if (ut === 'STEAM') {
			if (u === 'LB' || u === 'LBS') return 1.194;
			if (u === 'MLB' || u === 'KLB') return 1194;
			return 0;
		}
		// Anything else (WATER, SEWER, TRASH, etc.) is non-energy.
		return 0;
	},

	// Aggregate raw rows into:
	//   { location: { year: { charges, consumption, consumptionByKey, sqft } } }
	// `consumption` is the raw sum across all bills (used by ConsPerSqft, which
	// mirrors Power BI's mixed-UOM total). `consumptionByKey` keeps each
	// (utility_type|uom) bucket separate so EUI can apply the correct kBtu
	// factor and skip water/sewer.
	// `sqft` comes from the row (sites have a fixed sqft so any row works).
	getPerSqftData() {
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
			if (!byLocYear[loc][year]) byLocYear[loc][year] = { charges: 0, consumption: 0, consumptionByKey: {}, sqft: sqft };

			var bucket = byLocYear[loc][year];
			var cons = parseFloat(r.consumption) || 0;
			var ut = (r.utility_type || '').toString().toUpperCase().replace(/[\s_-]/g, '');
			var uom = (r.total_consumption_uom || '').toString().toUpperCase().trim();

			bucket.charges += parseFloat(r.total_charges) || 0;
			bucket.consumption += cons;
			if (ut && uom) {
				var key = ut + '|' + uom;
				bucket.consumptionByKey[key] = (bucket.consumptionByKey[key] || 0) + cons;
			}
		});

		return byLocYear;
	},

	getValue(d, view) {
		if (!d || !d.sqft || d.sqft <= 0) return 0;
		if (view === 'ConsPerSqft') return d.consumption / d.sqft;
		if (view === 'EUI') {
			// Sum (consumption × kBtu factor) across every (utility, uom)
			// bucket and divide by sqft. Non-energy buckets (WATER, SEWER,
			// TRASH, etc.) return factor 0 and drop out automatically.
			var totalKBtu = 0;
			var byKey = d.consumptionByKey || {};
			for (var key in byKey) {
				var parts = key.split('|');
				totalKBtu += byKey[key] * this._kBtuFactor(parts[0], parts[1]);
			}
			return totalKBtu / d.sqft;
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
		var isCharges = (view === 'ChargesPerSqft' || view === 'EUI');
		var formatNum = function(num) {
			if (num == null || num === 0) return '';
			if (isCharges) return '$' + Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

		return locations.map(function(loc) {
			var row = { 'Location': loc };
			years.forEach(function(year) {
				var d = (byLocYear[loc] || {})[year];
				row[year] = d ? Number(self.getValue(d, view).toFixed(2)) : 0;
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.psfViewBy) storeValue('psfViewBy', 'ChargesPerSqft');
		if (!appsmith.store.psfChartType) storeValue('psfChartType', 'bar');
	}
}
