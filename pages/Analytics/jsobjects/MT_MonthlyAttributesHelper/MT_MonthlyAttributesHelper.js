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
		// Factors mirror MA_PerSquareFeetHelper (the Main Analytics EUI helper), which
		// is reconciled against Power BI. Power BI uses the simpler 100,000 BTU/CCF
		// (1 therm equivalent) for natural gas, NOT the heating-value 102,800 — using
		// 102,800 here inflated gas-heavy months by ~2.8%.
		const map = {
			ELECTRIC: 3412,
			NATURALGAS: 100000,
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
	// Reads the dedicated, pre-aggregated fetch_ma_usage query (location/month/utility
	// rollup) rather than the big raw fetch_analytics_data, so this tab never scans the
	// full 32-column history.
	_baseLocationIds() {
		const raw = fetch_ma_usage.data || [];
		const ids = new Set();
		raw.forEach(r => ids.add(String(r.location_id)));
		return ids;
	},

	// Attributes that have numeric values. fetch_monthly_attributes is already date-
	// scoped server-side (its WHERE filters v.date_month by MADateSelect), so the rows
	// here only cover the selected months. We further narrow to attributes for a loaded
	// location when usage data is present; falls back to every attribute otherwise so
	// the picker is never needlessly empty.
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

	// Locations that have a value for the SELECTED monthly attribute. The attribute
	// rows are already date-scoped server-side (fetch_monthly_attributes filters
	// v.date_month by MADateSelect), so this is implicitly within the selected months.
	// Before an attribute is picked we fall back to any location with any attribute
	// value so the list is populated. Falls back to all loaded locations if the join
	// resolves to nothing, so the list is never needlessly empty.
	getLocationOptions() {
		const raw = fetch_ma_usage.data || [];
		const attrs = fetch_monthly_attributes.data || [];
		const attrName = this.getSelectedAttribute();
		const attrLocIds = new Set();
		attrs.forEach(a => {
			if (!Number(a.attribute_value)) return;
			if (attrName && a.attribute_name !== attrName) return;
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

		// d.consBase holds Σ(consumption × base BTU factor) — UOM-INDEPENDENT — so the
		// memoized grid survives BTU/Wh/Joule toggles. Apply the UOM multiplier here at
		// display time (base × mult == the old per-UOM factor, so results are unchanged).
		const uomMult = u === 'Wh' ? 0.29307107 : (u === 'Joule' ? 1055.06 : 1);
		const cons = d.consBase * uomMult;

		if (view === 'Charges')
			return d.charges;

		if (view === 'UnitCost')
			return cons ? (d.charges * 1000) / (cons * scale) : 0;

		if (view === 'EnergyUseIntensity')
			// Power BI EUI = SUM(kBtu) / SUM(square_feet); sqftSum is sqft summed per
			// meter row (see getMonthlyData), NOT the single per-location sqft.
			return d.sqftSum ? (cons * scale) / d.sqftSum : 0;

		// Consumption
		return u === 'Joule' ? cons / 1000 : cons;
	},

	/* ===============================
	   MONTHLY AGGREGATED DATA (with attribute divisor)
	=============================== */

	getMonthlyData() {
		// Pre-aggregated per location/month/utility rollup (fetch_ma_usage) — small,
		// server-summed — instead of the raw per-meter history. This is what keeps the
		// tab fast: a few hundred rows to fold, not tens of thousands.
		const raw = fetch_ma_usage.data || [];
		const attrName = this.getSelectedAttribute();
		if (!attrName) return {};

		// Single selected location (or null = every location that the attribute join keeps).
		const onlyLoc = appsmith.store.maSelectedLocation || null;

		const attrIdx = this._attrIndex();
		const byLocMonth = {};

		// The Power BI "monthly attribute" source query filters usage to these three
		// utility types (see Power BI Queries.sql). Match it so charges/consumption
		// don't pick up WATER/SEWER/etc. rows the reference report excludes.
		const ALLOWED = { ELECTRIC: 1, NATURALGAS: 1, PROPANE: 1 };

		// Base (UOM-independent) BTU factor per raw utility_type value — cached because
		// there are only a handful of distinct types across thousands of rows. The UOM
		// multiplier is applied later in _computeStandard, keeping this grid reusable.
		const factorCache = {};
		const factorFor = (utype) => {
			if (!(utype in factorCache)) factorCache[utype] = this.getBTUConversionFactor(utype, 'BTU');
			return factorCache[utype];
		};

		raw.forEach(r => {
			const ut = String(r.utility_type || '').toUpperCase().replace(/[\s_-]/g, '');
			if (!ALLOWED[ut]) return;

			const loc = r.location_description || 'Unknown';
			if (onlyLoc && loc !== onlyLoc) return;

			// fetch_ma_usage exposes the pre-truncated month column (date_trunc → YYYY-MM-01).
			const month = this._monthKey(r.month);
			if (!month) return;

			// Divisor: the attribute value for this location and month.
			const attrVal = attrIdx[r.location_id + '|' + month];
			if (!attrVal) return;

			const sqft = Number(r.square_feet) || 0;
			if (!byLocMonth[loc]) byLocMonth[loc] = {};
			if (!byLocMonth[loc][month])
				byLocMonth[loc][month] = { consBase: 0, charges: 0, sqft: sqft, sqftSum: 0, attr: attrVal };

			const f = factorFor(r.utility_type);
			byLocMonth[loc][month].consBase += ((Number(r.consumption) || 0) * f) / 1000000;
			byLocMonth[loc][month].charges += Number(r.total_charges) || 0;
			// Sum sqft per row to mirror Power BI's EUI denominator SUM(square_feet).
			byLocMonth[loc][month].sqftSum += sqft;
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

	/* ===============================
	   TOOLTIP / DETAIL FORMATTING
	   Shared by the chart hover tooltip and the "show as table" Details column so the
	   two always read identically (matches the Power BI monthly-attribute report).
	=============================== */

	// Unit of the RAW metric numerator (before dividing by the attribute). Mirrors the
	// scaling in _computeStandard so the label always matches the number it annotates.
	_metricUnit(view, u) {
		if (view === 'Charges') return '';
		if (view === 'UnitCost') return u === 'Joule' ? '$/GJ' : (u === 'Wh' ? '$/MWh' : '$/mmBTU');
		if (view === 'EnergyUseIntensity') return u === 'Joule' ? 'MJ/sqft' : (u === 'Wh' ? 'kWh/sqft' : 'kBtu/sqft');
		return u === 'Joule' ? 'GJ' : (u === 'Wh' ? 'MWh' : 'mmBTU');
	},

	// Short metric name used in the "<metric> Details" text and the Details column header.
	_metricRawLabel(view) {
		if (view === 'Charges') return 'Charges';
		if (view === 'UnitCost') return 'Unit Cost';
		if (view === 'EnergyUseIntensity') return 'EUI';
		return 'Consumption';
	},

	// Thousands-separated fixed-decimal formatter (kept local to avoid relying on
	// Intl/toLocaleString inside the Appsmith JS sandbox).
	_commas(n, dp) {
		const d = (dp == null) ? 2 : dp;
		const num = Number(n) || 0;
		const neg = num < 0;
		const parts = Math.abs(num).toFixed(d).split('.');
		parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return (neg ? '-' : '') + parts.join('.');
	},

	// The plotted value (metric ÷ attribute) as shown in the tooltip and the value
	// column. Charges and Unit Cost are money; Consumption and EUI are plain numbers.
	_fmtMain(v, view) {
		if (view === 'Charges' || view === 'UnitCost') return '$' + this._commas(v);
		return this._commas(v);
	},

	// Unit string for the currently-selected attribute (e.g. "LBS"). The monthly-
	// attributes feed does not yet carry a unit column, so this returns '' until one is
	// added — the detail text then simply omits the unit. Reads attribute_uom/unit/uom
	// from the row if present so it lights up automatically once the query exposes it.
	_selectedAttrUnit() {
		const attrName = this.getSelectedAttribute();
		if (!attrName) return '';
		const attrs = fetch_monthly_attributes.data || [];
		const row = attrs.find(a => a.attribute_name === attrName);
		return (row && (row.attribute_uom || row.unit || row.uom)) || '';
	},

	// "Products Produced 145.00 LBS, Consumption 10,378.76 MWh" — the attribute (divisor)
	// followed by the raw metric numerator, matching the Power BI detail format.
	_detailText(d, view, u, attrName, attrUnit) {
		const std = this._computeStandard(d, view);
		const rawLabel = this._metricRawLabel(view);
		const unit = this._metricUnit(view, u);
		const au = attrUnit ? (' ' + attrUnit) : '';
		const attrPart = attrName + ' ' + this._commas(d.attr) + au;
		const metricPart = (view === 'Charges')
			? rawLabel + ' $' + this._commas(std)
			: rawLabel + ' ' + this._commas(std) + (unit ? (' ' + unit) : '');
		return attrPart + ', ' + metricPart;
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

	// True while either source query is still fetching. Used to show a "Loading" state
	// instead of the misleading "No data" message while a date change re-runs the query.
	_isLoading() {
		const a = (typeof fetch_ma_usage !== 'undefined') && fetch_ma_usage.isLoading;
		const b = (typeof fetch_monthly_attributes !== 'undefined') && fetch_monthly_attributes.isLoading;
		return !!(a || b);
	},

	getMonthlyChartConfig() {
		if (this._isLoading()) {
			return this._messageConfig('Loading data…', 18);
		}

		const attrName = this.getSelectedAttribute();
		const uomLabel = this.getUOMLabel();

		if (!attrName) {
			return this._messageConfig('Please select a Monthly Attribute', 18);
		}

		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();
		const u = appsmith.store.maUOM || 'BTU';
		const attrUnit = this._selectedAttrUnit();
		const detailLabel = this._metricRawLabel(view) + ' Details';

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
				// Carry the display value + detail text on the point so the tooltip
				// formatter can render the same "<attribute>, <metric>" line as the table.
				data.push({
					value: [mi, v],
					mainDisp: this._fmtMain(v, view),
					detail: this._detailText(d, view, u, attrName, attrUnit),
					detailLabel: detailLabel
				});
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
				textStyle: { color: '#E2E8F0' },
				formatter: function (params) {
					const arr = Array.isArray(params) ? params : [params];
					if (!arr.length) return '';
					const head = arr[0].axisValueLabel || arr[0].name || '';
					let s = '<div style="font-weight:700;margin-bottom:4px;">' + head + '</div>';
					arr.forEach(function (p) {
						const dd = p.data || {};
						if (dd.mainDisp == null) return;
						s += '<div style="margin-top:2px;">' + p.marker + ' ' + p.seriesName +
							' &nbsp;<b>' + dd.mainDisp + '</b></div>';
						if (dd.detail) {
							s += '<div style="color:#94A3B8;font-size:11px;margin:1px 0 4px 16px;">' +
								dd.detailLabel + ': ' + dd.detail + '</div>';
						}
					});
					return s;
				}
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

	// Long format matching the Power BI report: one row per location-month with the
	// plotted value and a Details column identical to the chart tooltip's detail line.
	getMonthlyTable() {
		const attrName = this.getSelectedAttribute();
		if (!attrName) return [];

		const byLocMonth = this.getMonthlyData();
		const view = this.getActiveView();
		const u = appsmith.store.maUOM || 'BTU';
		const attrUnit = this._selectedAttrUnit();

		const monthNamesFull = ['January','February','March','April','May','June',
			'July','August','September','October','November','December'];
		const fullNames = {
			Consumption: 'Energy Consumption',
			Charges: 'Charges',
			EnergyUseIntensity: 'Energy Use Intensity',
			UnitCost: 'Unit Cost'
		};
		const valCol = (fullNames[view] || 'Energy Consumption') + ' per monthly attribute';
		const detCol = this._metricRawLabel(view) + ' Details';

		const locations = Object.keys(byLocMonth).sort();
		const rows = [];
		locations.forEach(loc => {
			const months = Object.keys(byLocMonth[loc]).sort();
			months.forEach(m => {
				const d = byLocMonth[loc][m];
				if (!d || !d.attr) return;
				const parts = m.split('-');
				const ym = parts[0] + ', ' + monthNamesFull[parseInt(parts[1]) - 1];
				const v = this._computeStandard(d, view) / d.attr;
				const row = {};
				row['Location'] = loc;
				row['Year, Month'] = ym;
				row[valCol] = this._fmtMain(v, view);
				row[detCol] = this._detailText(d, view, u, attrName, attrUnit);
				rows.push(row);
			});
		});
		return rows;
	},

	/* ===============================
	   DEFAULTS
	=============================== */

	// Runs when the user enters the Monthly Attributes Report (ReportSelect.onOptionChange).
	// appsmith.store persists across page reloads, so we FORCE the metric back to
	// Consumption and the UOM back to BTU on entry rather than only seeding when unset —
	// otherwise the toolbar buttons would show a stale prior selection after a reload.
	setDefaults() {
		storeValue('maActiveView', 'Consumption');
		storeValue('maUOM', 'BTU');
		removeValue('maSelectedLocation');
		removeValue('maTable');
	}
}
