export default {

	/* ===============================
	   ACTIVE SETTINGS
	=============================== */

	getActiveView() {
		return appsmith.store.maActiveView || 'Consumption';
	},

	getUOMLabel() {
		const u = appsmith.store.maUOM || 'BTU';
		if (u === 'Wh') return 'Watt hour';
		if (u === 'Joule') return 'Joule';
		return 'mmBTU';
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
		const u = uom || appsmith.store.maUOM || 'BTU';
		if (u === 'Wh') return base * 0.29307107;
		if (u === 'Joule') return base * 1055.06;
		return base;
	},

	/* ===============================
	   MONTHLY ATTRIBUTE OPTIONS
	=============================== */

	// location_ids present in the currently-loaded usage data (respects the filter bar).
	_baseLocationIds() {
		const raw = fetch_analytics_data.data || [];
		const ids = new Set();
		raw.forEach(r => ids.add(String(r.location_id)));
		return ids;
	},

	// Attributes that have numeric values. When usage data is loaded we narrow to
	// attributes available for a loaded location; if usage data hasn't loaded yet
	// we fall back to every attribute so the picker is never empty.
	getAttributeOptions() {
		const attrs = fetch_monthly_attributes.data || [];
		const baseIds = this._baseLocationIds();
		const useBase = baseIds.size > 0;
		const names = new Set();
		attrs.forEach(a => {
			if (!a.attribute_name) return;
			if (!Number(a.attribute_value)) return;
			if (useBase && !baseIds.has(String(a.location_id))) return;
			names.add(a.attribute_name);
		});
		return Array.from(names).sort().map(n => ({ label: n, value: n }));
	},

	// Read the picker directly so the chart updates via native reactivity (no async
	// storeValue round-trip). Falls back to the store for safety.
	getSelectedAttribute() {
		if (typeof MAAttrSelect !== 'undefined' && MAAttrSelect.selectedOptionValue)
			return MAAttrSelect.selectedOptionValue;
		return appsmith.store.maAttribute || null;
	},

	/* ===============================
	   LOCATION OPTIONS
	=============================== */

	// Locations that have any monthly-attribute value. Independent of the selected
	// attribute (so the list stays stable and the widget doesn't re-render on every
	// attribute change). Falls back to all loaded locations if the join resolves to
	// nothing, so the list is never needlessly empty.
	getLocationOptions() {
		const raw = fetch_analytics_data.data || [];
		const attrs = fetch_monthly_attributes.data || [];
		const attrLocIds = new Set();
		attrs.forEach(a => {
			if (!Number(a.attribute_value)) return;
			attrLocIds.add(String(a.location_id));
		});
		const filtered = new Set();
		const all = new Set();
		raw.forEach(r => {
			const name = r.location_description || 'Unknown';
			all.add(name);
			if (attrLocIds.has(String(r.location_id))) filtered.add(name);
		});
		const use = filtered.size > 0 ? filtered : all;
		return Array.from(use).sort().map(loc => ({ label: loc, value: loc }));
	},

	getSelectedLocations() {
		const loc = appsmith.store.maSelectedLocation;
		if (loc) return [loc];
		return this.getLocationOptions().map(o => o.value);
	},

	/* ===============================
	   ATTRIBUTE VALUE LOOKUP
	=============================== */

	// Normalise both usage dates and attribute month values to a YYYY-MM key.
	_monthKey(dateVal) {
		if (!dateVal) return '';
		const s = String(dateVal);
		// Already ISO-like (YYYY-MM or YYYY-MM-DD or full timestamp)
		if (/^\d{4}-\d{2}/.test(s)) return s.substring(0, 7);
		// Fallback: try to parse a Date
		const d = new Date(s);
		if (!isNaN(d.getTime())) {
			const y = d.getUTCFullYear();
			const m = ('0' + (d.getUTCMonth() + 1)).slice(-2);
			return y + '-' + m;
		}
		return '';
	},

	// Build { location_id | YYYY-MM : Number(value) } for the selected attribute.
	_attrIndex() {
		const raw = fetch_monthly_attributes.data || [];
		const attrName = this.getSelectedAttribute();
		const idx = {};
		if (!attrName) return idx;
		raw.forEach(r => {
			if (r.attribute_name !== attrName) return;
			const val = Number(r.attribute_value);
			if (!val || isNaN(val)) return;
			const month = this._monthKey(r.date_month);
			if (!month) return;
			idx[r.location_id + '|' + month] = val;
		});
		return idx;
	},

	/* ===============================
	   STANDARD METRIC (before dividing by attribute)
	=============================== */

	_computeStandard(d, view) {
		const u = appsmith.store.maUOM || 'BTU';
		const scale = u === 'Joule' ? 1 : 1000;

		if (view === 'Charges')
			return d.charges;

		if (view === 'UnitCost')
			return d.cons ? (d.charges * 1000) / (d.cons * scale) : 0;

		if (view === 'EnergyUseIntensity')
			return d.sqft ? (d.cons * scale) / d.sqft : 0;

		// Consumption
		return u === 'Joule' ? d.cons / 1000 : d.cons;
	},

	/* ===============================
	   MONTHLY AGGREGATED DATA (with attribute divisor)
	=============================== */

	getMonthlyData() {
		const raw = fetch_analytics_data.data || [];
		const u = appsmith.store.maUOM || 'BTU';
		const attrName = this.getSelectedAttribute();
		if (!attrName) return {};

		const attrIdx = this._attrIndex();
		// Single selected location (or null = every location that the attribute join keeps).
		const onlyLoc = appsmith.store.maSelectedLocation || null;
		const byLocMonth = {};

		raw.forEach(r => {
			const loc = r.location_description || 'Unknown';
			if (onlyLoc && loc !== onlyLoc) return;

			const month = this._monthKey(r.time_period);
			if (!month) return;

			// Divisor: the attribute value for this location and month.
			const attrVal = attrIdx[r.location_id + '|' + month];
			if (!attrVal) return;

			if (!byLocMonth[loc]) byLocMonth[loc] = {};
			if (!byLocMonth[loc][month])
				byLocMonth[loc][month] = { cons: 0, charges: 0, sqft: Number(r.square_feet) || 0, attr: attrVal };

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
		if (view === 'Charges') return 'Charges per monthly attribute ($)';
		if (view === 'UnitCost') return 'Unit Cost per monthly attribute ($/mm' + uom + ')';
		if (view === 'EnergyUseIntensity') return 'Energy Use Intensity per monthly attribute';
		return 'Energy Consumption per monthly attribute (' + uom + ')';
	},

	getChartTitle() {
		const view = this.getActiveView();
		const attr = this.getSelectedAttribute() || '(select attribute)';
		const metricNames = {
			Consumption: 'Energy Consumption',
			Charges: 'Charges',
			EnergyUseIntensity: 'Energy Use Intensity',
			UnitCost: 'Unit Cost'
		};
		return (metricNames[view] || 'Energy Consumption') + ' by ' + attr;
	},

	// A minimal-but-complete ECharts option that reliably renders a centered message
	// in the CUSTOM_ECHART widget (hidden axes guarantee the chart initialises).
	_messageConfig(text, size) {
		return {
			backgroundColor: '#1E293B',
			xAxis: { show: false, type: 'category', data: [] },
			yAxis: { show: false, type: 'value' },
			series: [],
			graphic: {
				type: 'text',
				left: 20,
				top: 20,
				style: {
					text: text,
					fill: '#E2E8F0',
					fontSize: size || 16,
					fontWeight: 'bold'
				}
			}
		};
	},

	/* ===============================
	   MONTHLY CHART CONFIG
	=============================== */

	getMonthlyChartConfig() {
		const attrName = this.getSelectedAttribute();
		const uomLabel = this.getUOMLabel();

		if (!attrName) {
			return this._messageConfig('Please select a Monthly Attribute', 18);
		}

		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();

		const allMonths = new Set();
		Object.values(byLocMonth).forEach(months => {
			Object.keys(months).forEach(m => allMonths.add(m));
		});
		const sortedMonths = Array.from(allMonths).sort();

		const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const monthLabels = sortedMonths.map(m => {
			const parts = m.split('-');
			return monthNames[parseInt(parts[1]) - 1] + ' ' + parts[0];
		});

		const colors = ['#84CC16','#3366CC','#22AA66','#DD8844','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6','#E11D48','#A855F7','#0EA5E9','#D946EF','#555555'];

		const locations = Object.keys(byLocMonth).sort();
		const series = [];
		locations.forEach((loc, idx) => {
			const data = [];
			sortedMonths.forEach((m, mi) => {
				const d = (byLocMonth[loc] || {})[m];
				if (!d || !d.attr) return;
				const std = this._computeStandard(d, view);
				const v = Number((std / d.attr).toFixed(4));
				if (!v) return;
				data.push([mi, v]);
			});
			if (data.length === 0) return;
			series.push({
				name: loc,
				type: 'line',
				smooth: true,
				symbolSize: 6,
				data: data,
				itemStyle: { color: colors[idx % colors.length] },
				lineStyle: { width: 2, color: colors[idx % colors.length] }
			});
		});

		if (series.length === 0) {
			return this._messageConfig('No data for "' + attrName + '" in the selected date range', 16);
		}

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
				pageIconInactiveColor: '#334155',
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10
			},
			grid: { left: 90, right: 160, top: 20, bottom: 60 },
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
				nameGap: 65,
				nameTextStyle: { color: '#CBD5E1', fontSize: 12 },
				axisLabel: { color: '#CBD5E1' },
				axisLine: { lineStyle: { color: '#475569' } },
				splitLine: { lineStyle: { color: '#334155', type: 'dashed' } }
			},
			series: series
		};
	},

	/* ===============================
	   TABLE DATA (for export / show as table)
	=============================== */

	getMonthlyTable() {
		const attrName = this.getSelectedAttribute();
		if (!attrName) return [];

		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();
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
				row[loc] = (d && d.attr) ? Number((this._computeStandard(d, view) / d.attr).toFixed(4)) : 0;
			});
			return row;
		});
	},

	/* ===============================
	   DEFAULTS
	=============================== */

	setDefaults() {
		if (!appsmith.store.maActiveView) storeValue('maActiveView', 'Consumption');
		if (!appsmith.store.maUOM) storeValue('maUOM', 'BTU');
		removeValue('maSelectedLocation');
	}
}
