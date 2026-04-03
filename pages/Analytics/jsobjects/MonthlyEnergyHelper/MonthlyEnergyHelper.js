export default {

	/* ===============================
	   ACTIVE SETTINGS
	=============================== */

	getActiveView() {
		return appsmith.store.mecActiveView || 'Consumption';
	},

	getUOMLabel() {
		const u = appsmith.store.mecUOM || 'BTU';
		if (u === 'Wh') return 'Watt hour';
		if (u === 'Joule') return 'Joule';
		return 'mmBTU';
	},

	getChartType() {
		return appsmith.store.mecChartType || 'scatter';
	},

	getChartTitle() {
		const view = this.getActiveView();
		const titles = {
			'Consumption': 'Monthly energy consumption by location',
			'UnitCost': 'Monthly unit cost by location',
			'EnergyUseIntensity': 'Monthly energy use intensity by location'
		};
		return titles[view] || titles['Consumption'];
	},

	/* ===============================
	   UNIT CONVERSION
	=============================== */

	getBTUConversionFactor(utilityType, uom) {
		const map = {
			ELECTRIC: 3412,
			NATURALGAS: 102800,
			OIL2: 138500,
			STEAM: 1000,
			WATER: 0,
			SEWER: 0
		};
		const base = map[utilityType] || 0;
		const u = uom || appsmith.store.mecUOM || 'BTU';
		if (u === 'Wh') return base * 0.29307107;
		if (u === 'Joule') return base * 1055.06;
		return base;
	},

	/* ===============================
	   LOCATION OPTIONS
	=============================== */

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
		const loc = appsmith.store.mecSelectedLocation;
		if (loc) {
			return [loc];
		}
		return this.getLocationOptions().map(o => o.value);
	},

	/* ===============================
	   VALUE CALCULATION
	=============================== */

	_computeValue(d, view) {
		const u = appsmith.store.mecUOM || 'BTU';
		const scale = u === 'Joule' ? 1 : 1000;

		if (view === 'UnitCost')
			return d.cons ? (d.charges * 1000) / (d.cons * scale) : 0;

		if (view === 'EnergyUseIntensity')
			return d.sqft ? (d.cons * scale) / d.sqft : 0;

		return u === 'Joule' ? d.cons / 1000 : d.cons;
	},

	/* ===============================
	   MONTHLY AGGREGATED DATA
	=============================== */

	getMonthlyData() {
		const raw = fetch_analytics_data.data || [];
		const u = appsmith.store.mecUOM || 'BTU';
		const selectedLocs = this.getSelectedLocations();
		const byLocMonth = {};

		raw.forEach(r => {
			const loc = r.location_description || 'Unknown';
			if (!selectedLocs.includes(loc)) return;

			const date = r.time_period || '';
			const month = date.substring(0, 7);
			if (!month) return;

			if (!byLocMonth[loc]) byLocMonth[loc] = {};
			if (!byLocMonth[loc][month])
				byLocMonth[loc][month] = { cons: 0, charges: 0, sqft: Number(r.square_feet) || 0 };

			const f = this.getBTUConversionFactor(r.utility_type, u);
			byLocMonth[loc][month].cons += ((Number(r.consumption) || 0) * f) / 1000000;
			byLocMonth[loc][month].charges += Number(r.total_charges) || 0;
		});

		return byLocMonth;
	},

	/* ===============================
	   CHART HELPERS
	=============================== */

	_getYLabel(view, uom) {
		if (view === 'UnitCost') return 'Unit Cost ($/mm' + uom + ')';
		if (view === 'EnergyUseIntensity') return 'EUI (' + uom + '/sqft)';
		return 'Equivalent Energy Consumption (' + uom + ')';
	},

	_getUOMColumnLabel(view) {
		const uom = this.getUOMLabel();
		if (view === 'UnitCost') return '$/mm' + uom;
		if (view === 'EnergyUseIntensity') return uom + '/sqft';
		return uom;
	},

	/* ===============================
	   MONTHLY CHART CONFIG
	=============================== */

	getMonthlyChartConfig() {
		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();
		const chartType = this.getChartType();
		const uomLabel = this.getUOMLabel();

		const allMonths = new Set();
		Object.values(byLocMonth).forEach(months => {
			Object.keys(months).forEach(m => allMonths.add(m));
		});
		const sortedMonths = Array.from(allMonths).sort();

		const monthLabels = sortedMonths.map(m => {
			const parts = m.split('-');
			const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
			return monthNames[parseInt(parts[1]) - 1] + ' ' + parts[0];
		});

		const colors = ['#3366CC','#22AA66','#DD8844','#555555','#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316','#6366F1','#14B8A6','#E11D48','#A855F7','#0EA5E9','#D946EF'];

		const locations = Object.keys(byLocMonth).sort();
		const series = locations.map((loc, idx) => {
			const data = sortedMonths.map(m => {
				const d = (byLocMonth[loc] || {})[m];
				if (!d) return 0;
				return Number(this._computeValue(d, view).toFixed(2));
			});
			return {
				name: loc,
				type: chartType,
				data: data,
				symbolSize: chartType === 'scatter' ? 10 : 6,
				itemStyle: { color: colors[idx % colors.length] },
				lineStyle: chartType === 'line' ? { width: 2 } : undefined
			};
		});

		const yLabel = this._getYLabel(view, uomLabel);

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				backgroundColor: '#0F172A',
				borderColor: '#334155',
				textStyle: { color: '#E2E8F0' }
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 'middle',
				textStyle: { color: '#E2E8F0', fontSize: 11 },
				pageTextStyle: { color: '#94A3B8' },
				pageIconColor: '#94A3B8',
				pageIconInactiveColor: '#334155'
			},
			grid: { left: 80, right: 160, top: 20, bottom: 60 },
			xAxis: {
				type: 'category',
				data: monthLabels,
				axisLabel: { color: '#CBD5E1', fontSize: 11 },
				axisLine: { lineStyle: { color: '#475569' } },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				name: yLabel,
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#CBD5E1', fontSize: 12 },
				axisLabel: { color: '#CBD5E1' },
				axisLine: { lineStyle: { color: '#475569' } },
				splitLine: { lineStyle: { color: '#334155', type: 'dashed' } }
			},
			series: series
		};
	},

	/* ===============================
	   TABLE DATA
	=============================== */

	getMonthlyTable() {
		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();
		const uomLabel = this._getUOMColumnLabel(view);
		const valLabel = this._getValueLabel();
		const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

		const allMonths = new Set();
		Object.values(byLocMonth).forEach(months => {
			Object.keys(months).forEach(m => allMonths.add(m));
		});
		const sortedMonths = Array.from(allMonths).sort();
		const locations = Object.keys(byLocMonth).sort();

		return sortedMonths.map(m => {
			const parts = m.split('-');
			const monthLabel = monthNames[parseInt(parts[1]) - 1] + ' ' + parts[0];
			const row = { MonthYear: monthLabel };

			locations.forEach(loc => {
				const d = (byLocMonth[loc] || {})[m];
				row[loc + ' ' + valLabel] = d ? Number(this._computeValue(d, view).toFixed(2)) : 0;
				row[loc + ' Selected UOM'] = uomLabel;
			});

			return row;
		});
	},
	
	_getValueLabel() {
		const view = this.getActiveView();
		if (view === 'UnitCost') return 'Unit Cost';
		if (view === 'EnergyUseIntensity') return 'Energy Use Intensity';
		return 'Consumption';
	},

	/* ===============================
	   DEFAULTS
	=============================== */

	setDefaults() {
		if (!appsmith.store.mecActiveView) storeValue('mecActiveView', 'Consumption');
		if (!appsmith.store.mecChartType) storeValue('mecChartType', 'scatter');
		if (!appsmith.store.mecUOM) storeValue('mecUOM', 'BTU');
	}
}
