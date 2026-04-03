export default {
	getViewBy() {
		return appsmith.store.psfViewBy || 'ChargesPerSqft';
	},

	getChartType() {
		return appsmith.store.psfChartType || 'bar';
	},

	getChartTitle() {
		var view = this.getViewBy();
		var titles = {
			'ChargesPerSqft': 'Charges per Square Feet ($/sqft)',
			'ConsPerSqft': 'Consumption per Square Feet (unit/sqft)',
			'EUI': 'Energy Use Intensity (kBTU/sqft)'
		};
		return titles[view] || titles['ChargesPerSqft'];
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
		const stored = appsmith.store.PSFLocCheckbox;
		if (stored && stored.length > 0) {
			return stored;
		}
		return this.getLocationOptions().map(o => o.value);
	},

	getPerSqftData() {
		var raw = fetch_analytics_data.data || [];
		var selectedLocs = this.getSelectedLocations();
		var view = this.getViewBy();
		var byLocYear = {};

		raw.forEach(function(r) {
			var loc = r.location_description || 'Unknown';
			if (!selectedLocs.includes(loc)) return;

			var sqft = parseFloat(r.square_feet) || 0;
			if (sqft <= 0) return;

			var date = r.time_period || r.bill_start_date || '';
			var year = date.substring(0, 4);
			if (!year) return;

			if (!byLocYear[loc]) byLocYear[loc] = {};
			if (!byLocYear[loc][year]) byLocYear[loc][year] = { charges: 0, consumption: 0, sqft: sqft };

			byLocYear[loc][year].charges += parseFloat(r.total_charges) || 0;
			byLocYear[loc][year].consumption += parseFloat(r.consumption) || 0;
		});

		return byLocYear;
	},

	getValue(d, view) {
		if (view === 'ConsPerSqft') return d.sqft > 0 ? d.consumption / d.sqft : 0;
		if (view === 'EUI') return d.sqft > 0 ? (d.charges / d.sqft) * 3.412 : 0;
		return d.sqft > 0 ? d.charges / d.sqft : 0;
	},

	getChartConfig() {
        var byLocYear = this.getPerSqftData();
        var view = this.getViewBy();
        var chartType = this.getChartType();
        var self = this;

        var allYears = new Set();
        Object.values(byLocYear).forEach(function(years) {
            Object.keys(years).forEach(function(y) { allYears.add(y); });
        });
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
        locations.sort(function(a, b) { return locTotals[b] - locTotals[a]; });

        var yearColors = ['#f9a8d4', '#3b82f6', '#86efac', '#f59e0b', '#8b5cf6'];

        if (chartType === 'scatter') {
            var scatterSeries = sortedYears.map(function(year, idx) {
                var pts = [];
                locations.forEach(function(loc) {
                    var d = (byLocYear[loc] || {})[year];
                    if (d) {
                        var val = self.getValue(d, view);
                        pts.push({ value: [val, loc], name: loc });
                    }
                });
                return {
                    name: year,
                    type: 'scatter',
                    data: pts.map(function(p) { return p.value; }),
                    symbolSize: 12,
                    itemStyle: { color: yearColors[idx % yearColors.length] }
                };
            });

            return {
                backgroundColor: '#1E293B',
                tooltip: {
                    trigger: 'item',
                    backgroundColor: '#1e293b',
                    borderColor: '#334155',
                    textStyle: { color: '#e2e8f0' },
                    formatter: function(p) {
                        return '<b>' + p.seriesName + '</b><br/>' + p.data[1] + ': ' + (p.data[0] || 0).toLocaleString();
                    }
                },
                legend: {
                    right: 10, top: 5,
                    textStyle: { color: '#e2e8f0', fontSize: 12 },
                    icon: 'circle', itemWidth: 10, itemHeight: 10
                },
                grid: { left: 130, right: 50, top: 40, bottom: 30 },
                xAxis: {
                    type: 'value',
                    axisLabel: { color: '#94a3b8', formatter: function(v) { return '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); } },
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
                series: scatterSeries
            };
        }

        var barSeries = sortedYears.map(function(year, idx) {
            return {
                name: year,
                type: 'bar',
                data: locations.map(function(loc) {
                    var d = (byLocYear[loc] || {})[year];
                    return d ? Number(self.getValue(d, view).toFixed(2)) : 0;
                }),
                itemStyle: { color: yearColors[idx % yearColors.length], borderRadius: [0, 3, 3, 0] },
                barMaxWidth: 14
            };
        });

        var xFormatter;
        if (view === 'ChargesPerSqft') {
            xFormatter = function(v) { return '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'K' : v); };
        } else {
            xFormatter = function(v) { return v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; };
        }

        return {
            backgroundColor: '#1E293B',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: '#1e293b',
                borderColor: '#334155',
                textStyle: { color: '#e2e8f0' }
            },
            legend: {
                right: 10,
                top: 5,
                textStyle: { color: '#e2e8f0', fontSize: 12 },
                icon: 'circle',
                itemWidth: 10,
                itemHeight: 10,
                title: { text: 'Year', textStyle: { color: '#e2e8f0', fontWeight: 'bold' } }
            },
            grid: { left: 50, right: 50, top: 40, bottom: 50 },
            xAxis: {
                type: 'value',
                axisLabel: { color: '#94a3b8', formatter: xFormatter },
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
            dataZoom: [
                { type: 'slider', xAxisIndex: 0, bottom: 5, height: 18, borderColor: '#334155', backgroundColor: '#0f172a', fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: '#e2e8f0', borderColor: '#64748b' }, textStyle: { color: '#94a3b8' } }
            ],
            series: barSeries
        };
    },
	
	setDefaults() {
		if (!appsmith.store.psfViewBy) storeValue('psfViewBy', 'ChargesPerSqft');
		if (!appsmith.store.psfChartType) storeValue('psfChartType', 'bar');
	}
}