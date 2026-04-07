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

	// Aggregate raw rows into { location: { year: { charges, consumption, sqft } } }.
	// charges/consumption are summed across all bills for that (loc, year);
	// sqft is taken from the row (sites have a fixed sqft so any row works).
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
			if (!byLocYear[loc][year]) byLocYear[loc][year] = { charges: 0, consumption: 0, sqft: sqft };

			byLocYear[loc][year].charges += parseFloat(r.total_charges) || 0;
			byLocYear[loc][year].consumption += parseFloat(r.consumption) || 0;
		});

		return byLocYear;
	},

	getValue(d, view) {
		if (!d || !d.sqft || d.sqft <= 0) return 0;
		if (view === 'ConsPerSqft') return d.consumption / d.sqft;
		// EUI ≈ kBtu/sqft. With charges as a proxy this is `($/sqft) × 3.412`.
		// (Real EUI requires a fuel-type-aware kBtu conversion of consumption.)
		if (view === 'EUI') return (d.charges / d.sqft) * 3.412;
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

	_tooltipFormatter(view) {
		var isCharges = (view === 'ChargesPerSqft' || view === 'EUI');
		return function(v) {
			if (v == null) return '';
			if (isCharges) return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
		};
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

	// Build the dataZoom array for both chart modes. We render two sliders:
	//  - x-axis slider (bottom) for zooming the value range
	//  - y-axis slider (right) for scrolling the locations list. With many sites
	//    (50+), we need this so each row keeps a usable height instead of being
	//    crushed into a 2px sliver. `inside` zoom on the y-axis lets the user
	//    scroll with the mouse wheel as well.
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
				moveOnMouseMove: false
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

		var tooltipFmt = this._tooltipFormatter(view);
		var xFmt = this._xAxisFormatter(view);
		var dataZoom = this._buildDataZoom(locations.length);

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
						return d ? [Number(self.getValue(d, view).toFixed(2)), loc] : null;
					}).filter(Boolean)
				};
			});

			return {
				backgroundColor: '#1E293B',
				tooltip: {
					trigger: 'item',
					backgroundColor: '#0f172a',
					borderColor: '#334155',
					textStyle: { color: '#e2e8f0' },
					formatter: function(p) {
						return '<b>' + p.seriesName + '</b><br/>' + p.data[1] + ': ' + tooltipFmt(p.data[0]);
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
				data: locations.map(function(loc) {
					var d = (byLocYear[loc] || {})[year];
					return d ? Number(self.getValue(d, view).toFixed(2)) : 0;
				})
			};
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				backgroundColor: '#0f172a',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' },
				valueFormatter: tooltipFmt
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
