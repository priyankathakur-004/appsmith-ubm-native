export default {
	getLocationOptions() {
		const raw = fetch_analytics_data.data || [];
		const locs = new Set();

		raw.forEach(r => {
			locs.add((r.location_description || "Unknown").trim());
		});

		return Array.from(locs)
			.sort()
			.map(loc => ({ label: loc, value: loc }));
	},

	getServiceAccountOptions() {
		const raw = fetch_analytics_data.data || [];
		const saSet = new Set();

		raw.forEach(r => {
			const loc = (r.location_description || "Unknown").trim();
			const sa = (r.service_account || "").trim();
			if (sa) {
				saSet.add(loc + ", " + sa);
			}
		});

		return Array.from(saSet)
			.sort()
			.map(item => ({ label: item, value: item }));
	},

	getMeterOptions() {
		const raw = fetch_analytics_data.data || [];
		const meterSet = new Set();

		raw.forEach(r => {
			const loc = (r.location_description || "Unknown").trim();
			const sa = (r.service_account || "").trim();
			const meter = (r.meter || "").trim();
			if (sa && meter) {
				meterSet.add(loc + ", " + sa + ", " + meter);
			}
		});

		return Array.from(meterSet)
			.sort()
			.map(item => ({ label: item, value: item }));
	},

	getFilterOptions() {
		const view = this.getViewBy();
		if (view === "ServiceAccount") return this.getServiceAccountOptions();
		if (view === "Meter") return this.getMeterOptions();
		return this.getLocationOptions();
	},

	getFilterHeader() {
		const view = this.getViewBy();
		if (view === "ServiceAccount") return "Location, Service Acct";
		if (view === "Meter") return "Location, Service Acct, Meter";
		return "Location";
	},

	getSelectedLocations() {
		const sel = appsmith.store.otySelectedLocation;

		if (Array.isArray(sel) && sel.length) {
			return sel.map(l => l.trim());
		}

		if (typeof sel === 'string' && sel) {
			return [sel.trim()];
		}

		return this.getFilterOptions().map(o => o.value);
	},

	_matchesSelection(r) {
		const view = this.getViewBy();
		const selected = this.getSelectedLocations();
		const loc = (r.location_description || "Unknown").trim();

		if (view === "ServiceAccount") {
			const sa = (r.service_account || "").trim();
			const key = loc + ", " + sa;
			return selected.some(s => s === key);
		}

		if (view === "Meter") {
			const sa = (r.service_account || "").trim();
			const meter = (r.meter || "").trim();
			const key = loc + ", " + sa + ", " + meter;
			return selected.some(s => s === key);
		}

		return selected.some(l => l === loc);
	},

	getViewBy() {
		return appsmith.store.otyViewBy || "Location";
	},

	getMapMarkers() {
		const raw = fetch_analytics_data.data || [];
		const markers = {};

		raw.forEach(r => {
			if (!this._matchesSelection(r)) return;

			const loc = (r.location_description || "Unknown").trim();
			const lat = Number(r.latitude);
			const lng = Number(r.longitude);

			if (!isNaN(lat) && !isNaN(lng) && !markers[loc]) {
				markers[loc] = {
					lat,
					long: lng,
					title: loc,
					color: "#3B82F6"
				};
			}
		});

		return Object.values(markers);
	},

	getYearlyMonthlyData() {
		const raw = fetch_analytics_data.data || [];
		const result = {};

		const MIN_CONSUMPTION = 0; // remove noisy data

		raw.forEach(r => {
			if (!this._matchesSelection(r)) return;

			const dateStr = r.time_period || '';
			if (!dateStr) return;

			// SAFE DATE PARSE
			const parts = dateStr.split("-");
			const year = Number(parts[0]);
			const month = Number(parts[1]);

			if (!year || !month) return;

			const charges = parseFloat(r.total_charges);
			const consumption = parseFloat(r.consumption);

			// FILTER BAD DATA
			if (isNaN(consumption) || consumption < MIN_CONSUMPTION) return;
			if (isNaN(charges) || charges <= 0) return;

			if (!result[year]) result[year] = {};
			if (!result[year][month]) {
				result[year][month] = {
					charges: 0,
					consumption: 0,
					unitCost: 0
				};
			}

			result[year][month].charges += charges;
			result[year][month].consumption += consumption;
		});

		// CALCULATE UNIT COST
		Object.keys(result).forEach(year => {
			Object.keys(result[year]).forEach(month => {
				const d = result[year][month];

				if (d.consumption > 0 && d.charges > 0) {
					const uc = d.charges / d.consumption;
					d.unitCost = uc > 1 ? 0 : uc; // cap spikes
				} else {
					d.unitCost = 0;
				}
			});
		});

		return result;
	},

	buildLineChart(valueKey) {
		const data = this.getYearlyMonthlyData();

		const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

		// REMOVE INCOMPLETE YEARS
		const years = Object.keys(data)
			.map(y => Number(y))
			.filter(y => Object.keys(data[y]).length >= 1)
			.sort((a, b) => b - a)
			.slice(0, 5);

		const colors = ["#3B82F6","#F9A8D4","#86efac","#F59E0B","#8B5CF6"];

		const series = years.map((year, idx) => ({
			name: String(year),
			type: "line",
			smooth: true,
			data: months.map((_, i) => {
				const d = data[year]?.[i + 1];
				return d ? Number(d[valueKey].toFixed(2)) : 0;
			}),
			itemStyle: { color: colors[idx % colors.length] },
			lineStyle: { width: 2, color: colors[idx % colors.length] },
			connectNulls: true
		}));

		return {
			backgroundColor: "#1E293B",

			tooltip: {
				trigger: "axis",
				backgroundColor: "#0F172A",
				textStyle: { color: "#E2E8F0" }
			},

			legend: {
				right: 10,
				top: 5,
				orient: "vertical",
				textStyle: { color: "#E2E8F0" },
				data: years.map(String)
			},

			grid: { left: 60, right: 100, top: 20, bottom: 30 },

			xAxis: {
				type: "category",
				data: months,
				axisLabel: { color: "#CBD5E1" },
				axisLine: { lineStyle: { color: "#475569" } }
			},

			yAxis: {
				type: "value",
				axisLabel: { color: "#CBD5E1" },
				splitLine: { lineStyle: { color: "#334155", type: "dashed" } }
			},

			series
		};
	},

	getChargesChartConfig() {
		return this.buildLineChart("charges");
	},

	getUnitCostChartConfig() {
		return this.buildLineChart("unitCost");
	},

	getConsumptionChartConfig() {
		return this.buildLineChart("consumption");
	},

	/* ===============================
	   TABLE DATA
	=============================== */

	_buildTable(valueKey, valueLabel) {
		const data = this.getYearlyMonthlyData();
		const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		const years = Object.keys(data).map(Number).sort((a, b) => b - a).slice(0, 5);

		const rows = [];
		for (let m = 1; m <= 12; m++) {
			const row = { Month: months[m - 1] };
			years.forEach(year => {
				const d = data[year]?.[m];
				row[year + ' ' + valueLabel] = d ? Number(d[valueKey].toFixed(2)) : 0;
			});
			rows.push(row);
		}
		return rows;
	},

	getChargesTable() {
		return this._buildTable("charges", "Charges ($)");
	},

	getConsumptionTable() {
		return this._buildTable("consumption", "Consumption (CCF)");
	},

	getUnitCostTable() {
		return this._buildTable("unitCost", "Unit Cost ($/CCF)");
	},

	/* ===============================
	   DRILL-DOWN: CHARGES BY LOCATION
	=============================== */

	getLocationBreakdownConfig() {
		const raw = fetch_analytics_data.data || [];
		const clickedMonth = appsmith.store.otyClickedMonth;
		const clickedYear = appsmith.store.otyClickedYear;
		const chartType = appsmith.store.otyClickedChart || "charges";

		const byLoc = {};

		raw.forEach(r => {
			if (!this._matchesSelection(r)) return;
			const loc = (r.location_description || "Unknown").trim();

			const dateStr = r.time_period || '';
			if (!dateStr) return;

			const parts = dateStr.split("-");
			const year = Number(parts[0]);
			const month = Number(parts[1]);

			if (clickedYear && year !== clickedYear) return;
			if (clickedMonth && month !== clickedMonth) return;

			const charges = parseFloat(r.total_charges) || 0;
			const consumption = parseFloat(r.consumption) || 0;

			if (!byLoc[loc]) byLoc[loc] = { charges: 0, consumption: 0 };
			byLoc[loc].charges += charges;
			byLoc[loc].consumption += consumption;
		});

		// Calculate unit cost
		Object.values(byLoc).forEach(d => {
			d.unitCost = d.consumption > 0 ? d.charges / d.consumption : 0;
		});

		const sorted = Object.entries(byLoc)
			.map(([loc, d]) => ({ loc, value: d[chartType] || 0 }))
			.filter(d => d.value > 0)
			.sort((a, b) => b.value - a.value)
			.slice(0, 15);

		const isCharges = chartType === "charges";
		const isConsumption = chartType === "consumption";

		const formatValue = (v) => {
			if (isCharges) return '$' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v.toFixed(0));
			if (isConsumption) return (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v.toFixed(0));
			return '$' + v.toFixed(2);
		};

		return {
			backgroundColor: "#1E293B",

			tooltip: {
				trigger: "axis",
				axisPointer: { type: "shadow" },
				backgroundColor: "#0F172A",
				textStyle: { color: "#E2E8F0" }
			},
			grid: { left: 120, right: 60, top: 10, bottom: 30 },
			xAxis: {
				type: "value",
				axisLabel: {
					color: "#CBD5E1",
					formatter: (v) => formatValue(v)
				},
				splitLine: { lineStyle: { color: "#334155", type: "dashed" } }
			},
			yAxis: {
				type: "category",
				data: sorted.map(d => d.loc).reverse(),
				axisLabel: { fontSize: 11, color: "#CBD5E1" }
			},
			series: [{
				type: "bar",
				data: sorted.map(d => d.value).reverse(),
				itemStyle: { color: "#3B82F6" },
				barMaxWidth: 30,
				label: {
					show: false
				}
			}]
		};
	},

	getDrillDownTitle() {
		const chartType = appsmith.store.otyClickedChart || "charges";
		const titles = { charges: "Charges", consumption: "Consumption", unitCost: "Unit Cost" };
		const monthNames = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		const month = appsmith.store.otyClickedMonth;
		const year = appsmith.store.otyClickedYear;

		let title = (titles[chartType] || "Charges") + " by Location";
		if (month && year) title += " - " + monthNames[month] + " " + year;
		else if (year) title += " - " + year;
		return title;
	},

	/* ===============================
	   LOCATION INFO
	=============================== */

	getLocationInfo() {
		const raw = fetch_analytics_data.data || [];
		const clickedLoc = appsmith.store.otyClickedLocation;
		if (!clickedLoc) return [];

		let totalCharges = 0;
		let totalConsumption = 0;
		let totalDemand = 0;
		let sqft = 0;
		let address = '';
		let city = '';
		let state = '';
		let lat = 0;
		let lng = 0;

		raw.forEach(r => {
			const loc = (r.location_description || "Unknown").trim();
			if (loc !== clickedLoc) return;

			totalCharges += parseFloat(r.total_charges) || 0;
			totalConsumption += parseFloat(r.consumption) || 0;
			totalDemand += parseFloat(r.demand) || 0;

			if (!address && r.location_address) address = r.location_address;
			if (!city && r.city) city = r.city;
			if (!state && r.state) state = r.state;
			if (!sqft && r.square_feet) sqft = Number(r.square_feet) || 0;
			if (!lat && r.latitude) lat = Number(r.latitude) || 0;
			if (!lng && r.longitude) lng = Number(r.longitude) || 0;
		});

		const eqCons = totalConsumption * 3412 / 1000000; // mmBTU
		const eui = sqft > 0 ? (eqCons * 1000) / sqft : 0;
		const eqUnitCost = eqCons > 0 ? totalCharges / eqCons : 0;

		return [
			{ Attribute: "Location Address", Value: address || "N/A" },
			{ Attribute: "City", Value: city || "N/A" },
			{ Attribute: "State", Value: state || "N/A" },
			{ Attribute: "Charges", Value: "$" + totalCharges.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
			{ Attribute: "Consumption (KWH)", Value: totalConsumption.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
			{ Attribute: "Equivalent Energy Consumption (mmBtu)", Value: eqCons.toFixed(2) },
			{ Attribute: "Energy Use Intensity (kBtu/sqft)", Value: eui.toFixed(2) },
			{ Attribute: "Equivalent Energy Unit Cost ($/mmbtu)", Value: "$" + eqUnitCost.toFixed(2) },
			{ Attribute: "Demand (kW)", Value: totalDemand.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
			{ Attribute: "Square Feet", Value: sqft.toLocaleString(undefined, { maximumFractionDigits: 0 }) }
		];
	},

	/* ===============================
	   CHART CLICK HANDLERS
	=============================== */

	onChargesChartClick() {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const monthIdx = months.indexOf(OTYChargesChart.selectedDataPoint?.x) + 1;
		const year = Number(OTYChargesChart.selectedDataPoint?.seriesTitle);
		storeValue('otyClickedMonth', monthIdx || null);
		storeValue('otyClickedYear', year || null);
		storeValue('otyClickedChart', 'charges');
		showModal(showChart.name);
	},

	onConsumptionChartClick() {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const monthIdx = months.indexOf(OTYConsumptionChart.selectedDataPoint?.x) + 1;
		const year = Number(OTYConsumptionChart.selectedDataPoint?.seriesTitle);
		storeValue('otyClickedMonth', monthIdx || null);
		storeValue('otyClickedYear', year || null);
		storeValue('otyClickedChart', 'consumption');
		showModal(showChart.name);
	},

	onUnitCostChartClick() {
		const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		const monthIdx = months.indexOf(OTYUnitCostChart.selectedDataPoint?.x) + 1;
		const year = Number(OTYUnitCostChart.selectedDataPoint?.seriesTitle);
		storeValue('otyClickedMonth', monthIdx || null);
		storeValue('otyClickedYear', year || null);
		storeValue('otyClickedChart', 'unitCost');
		showModal(showChart.name);
	},

	/* ===============================
	   DEFAULTS
	=============================== */

	setDefaults() {
		if (!appsmith.store.otyViewBy) {
			storeValue("otyViewBy", "Location");
		}
	}
};
