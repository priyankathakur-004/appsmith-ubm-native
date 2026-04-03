export default {
	getLocationOptions() {
		const raw = fetch_analytics_data.data || [];
		const locs = new Set();
		raw.forEach(r => {
			const loc = r.location_description || 'Unknown';
			locs.add(loc);
		});
		return Array.from(locs).sort().map(loc => ({ label: loc, value: loc }));
	},

	getSelectedLocations() {
				const stored = appsmith.store.OTYLocCheckbox;
				if (stored && stored.length > 0) {
						return stored;
				}
				return this.getLocationOptions().map(o => o.value);
		},

	getViewBy() {
		return appsmith.store.otyViewBy || 'Location';
	},

	getGroupKey(record) {
		const viewBy = this.getViewBy();
		if (viewBy === 'ServiceAccount') return record.location_id || 'Unknown';
		if (viewBy === 'Meter') return (record.location_id || '') + ' - ' + (record.meter_id || '');
		return record.location_description || 'Unknown';
	},

	getMapMarkers() {
		const raw = fetch_analytics_data.data || [];
		const selectedLocs = this.getSelectedLocations();
		const markers = {};

		raw.forEach(r => {
			const loc = r.location_description || 'Unknown';
			if (!selectedLocs.includes(loc)) return;
			const lat = parseFloat(r.latitude);
			const lng = parseFloat(r.longitude);
			if (!isNaN(lat) && !isNaN(lng) && !markers[loc]) {
				const charges = parseFloat(r.total_charges) || 0;
				markers[loc] = { lat: lat, long: lng, title: loc, color: '#3B82F6' };
			}
		});

		return Object.values(markers);
	},

	getYearlyMonthlyData() {
		const raw = fetch_analytics_data.data || [];
		const selectedLocs = this.getSelectedLocations();
		const byYearMonth = {};

		raw.forEach(r => {
			const loc = r.location_description || 'Unknown';
			if (!selectedLocs.includes(loc)) return;

			const date = r.bill_start_date || r.read_date || '';
			if (!date) return;
			const year = date.substring(0, 4);
			const monthNum = parseInt(date.substring(5, 7));
			if (!year || isNaN(monthNum)) return;

			if (!byYearMonth[year]) byYearMonth[year] = {};
			if (!byYearMonth[year][monthNum]) {
				byYearMonth[year][monthNum] = { charges: 0, consumption: 0, unitCost: 0, count: 0 };
			}

			byYearMonth[year][monthNum].charges += parseFloat(r.total_charges) || 0;
			byYearMonth[year][monthNum].consumption += parseFloat(r.consumption) || 0;
			byYearMonth[year][monthNum].count += 1;
		});

		Object.keys(byYearMonth).forEach(year => {
			Object.keys(byYearMonth[year]).forEach(month => {
				const d = byYearMonth[year][month];
				d.unitCost = d.consumption > 0 ? d.charges / d.consumption : 0;
			});
		});

		return byYearMonth;
	},

	getUnitCostTitle() {
		const raw = fetch_analytics_data.data || [];
		const units = new Set();
		raw.forEach(r => { if (r.unit_of_measure) units.add(r.unit_of_measure); });
		const uom = units.size === 1 ? Array.from(units)[0] : 'Unit';
		return 'Unit Cost ($/' + uom + ')';
	},

	getConsumptionTitle() {
		const raw = fetch_analytics_data.data || [];
		const units = new Set();
		raw.forEach(r => { if (r.unit_of_measure) units.add(r.unit_of_measure); });
		const uom = units.size === 1 ? Array.from(units)[0] : 'Unit';
		return 'Consumption (' + uom + ')';
	},

	buildLineChart(valueKey, yAxisFormatter) {
		const data = this.getYearlyMonthlyData();
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const years = Object.keys(data).sort().reverse().slice(0, 5);
		const colors = ['#F9A8D4', '#3B82F6', '#86efac', '#F59E0B', '#8B5CF6'];

		const series = years.map((year, idx) => ({
			name: year,
			type: 'line',
			smooth: true,
			data: months.map((_, mi) => {
				const d = (data[year] || {})[mi + 1];
				return d ? Number(d[valueKey].toFixed(2)) : null;
			}),
			itemStyle: { color: colors[idx % colors.length] },
			lineStyle: { width: 2, color: colors[idx % colors.length] },
			symbolSize: 6,
			connectNulls: true
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
				backgroundColor: '#1e293b',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' }
			},
			legend: {
				right: 10,
				top: 5,
				orient: 'vertical',
				textStyle: { color: '#e2e8f0', fontSize: 12 },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10,
				data: years.map((y, i) => ({ name: y, itemStyle: { color: colors[i % colors.length] } }))
			},
			grid: { left: 60, right: 100, top: 20, bottom: 30 },
			xAxis: {
				type: 'category',
				data: months,
				axisLabel: { color: '#94a3b8', fontSize: 11 },
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				axisLabel: {
					color: '#94a3b8',
					formatter: yAxisFormatter
				},
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
			},
			series: series
		};
	},

	getChargesChartConfig() {
		return this.buildLineChart('charges', function(v) {
			if (v >= 1000000) return '$' + (v/1000000).toFixed(1) + 'M';
			if (v >= 1000) return '$' + (v/1000).toFixed(0) + 'K';
			return '$' + v;
		});
	},

	getUnitCostChartConfig() {
		return this.buildLineChart('unitCost', function(v) {
			return '$' + v.toFixed(0);
		});
	},

	getConsumptionChartConfig() {
		return this.buildLineChart('consumption', function(v) {
			if (v >= 1000000) return (v/1000000).toFixed(0) + 'M';
			if (v >= 1000) return (v/1000).toFixed(0) + 'K';
			return v;
		});
	},

	setDefaults() {
		if (!appsmith.store.otyViewBy) storeValue('otyViewBy', 'Location');
	}
}