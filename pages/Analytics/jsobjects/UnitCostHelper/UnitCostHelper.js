export default {
	getViewBy() {
		return appsmith.store.ucViewBy || 'Location';
	},

	getChartTitle() {
		var view = this.getViewBy();
		if (view === 'Service Account') return 'Location, Service Account';
		if (view === 'Meter') return 'Location, Service Account, Meter';
		if (view === 'Vendor') return 'Vendor';
		return 'Location';
	},

	getYAxisLabel() {
		return 'Unit Cost';
	},

	// Build the group key for a row given the current view mode. The Power BI
	// "Unit Cost" page has four nested view modes; we mirror those here.
	//   Location        -> location_description
	//   Service Account -> "<location>, <service_account>"
	//   Meter           -> "<location>, <service_account>, <meter>"
	//   Vendor          -> vendor_name (falls back to vendor_code)
	_rowKey(r, view) {
		var loc = r.location_description || 'Unknown';
		if (view === 'Service Account') return loc + ', ' + (r.service_account || '');
		if (view === 'Meter') return loc + ', ' + (r.service_account || '') + ', ' + (r.meter || '');
		if (view === 'Vendor') return r.vendor_name || 'Unknown';
		return loc; // Location
	},

	getGroupOptions() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var view = this.getViewBy();
		var self = this;
		var set = {};
		data.forEach(function(r) {
			var k = self._rowKey(r, view);
			if (k != null && k !== '') set[k] = true;
		});
		return Object.keys(set).sort().map(function(k) { return { label: k, value: k }; });
	},

	// Single-select side list. null/empty selection means "all groups".
	getSelectedGroup() {
		var picked = (typeof UCLocCheckbox !== 'undefined' && UCLocCheckbox && UCLocCheckbox.model && UCLocCheckbox.model.selectedValue) || null;
		if (picked) return [picked];
		return this.getGroupOptions().map(function(o) { return o.value; });
	},

	// Bucket fetch_analytics_data into:
	//   { groupKey: { 'YYYY-MM': { charges, consumption, unitCost } } }
	//
	// Unit cost = SUM(total_charges) / SUM(consumption) per (group, month).
	// `consumption` in fetch_analytics_data is already total_consumption or
	// total_gen_consumption depending on bill_type (the SQL handles that).
	// Negative `total_charges` rows (refunds/credits) are kept — that's how
	// Power BI gets the negative unit cost values like Site 10 = -$0.187.
	getMonthlyData() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var view = this.getViewBy();
		var selected = this.getSelectedGroup();
		var self = this;
		var sel = {};
		selected.forEach(function(s) { sel[s] = true; });

		var byKeyMonth = {};
		data.forEach(function(r) {
			var key = self._rowKey(r, view);
			if (!sel[key]) return;
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			if (!byKeyMonth[key]) byKeyMonth[key] = {};
			if (!byKeyMonth[key][mk]) byKeyMonth[key][mk] = { charges: 0, consumption: 0 };
			byKeyMonth[key][mk].charges += parseFloat(r.total_charges) || 0;
			byKeyMonth[key][mk].consumption += parseFloat(r.consumption) || 0;
		});

		Object.keys(byKeyMonth).forEach(function(k) {
			Object.keys(byKeyMonth[k]).forEach(function(mk) {
				var b = byKeyMonth[k][mk];
				b.unitCost = b.consumption !== 0 ? b.charges / b.consumption : 0;
			});
		});

		return byKeyMonth;
	},

	// Format YYYY-MM -> "Jan 2025"
	_formatMonthYear(mk) {
		var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var p = mk.split('-');
		return (months[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
	},

	_getAllMonths(byKeyMonth) {
		var s = {};
		Object.keys(byKeyMonth).forEach(function(k) {
			Object.keys(byKeyMonth[k] || {}).forEach(function(m) { s[m] = true; });
		});
		return Object.keys(s).sort();
	},

	// Stable color per series. Same palette as MonthlyElectricDemandHelper so
	// the dashboard feels consistent across tabs.
	_color(idx) {
		var palette = [
			'#60a5fa','#34d399','#f472b6','#fbbf24','#a78bfa','#22d3ee',
			'#fb923c','#4ade80','#f87171','#c084fc','#facc15','#2dd4bf',
			'#818cf8','#fda4af'
		];
		return palette[idx % palette.length];
	},

	getChartConfig() {
		var byKM = this.getMonthlyData();
		var self = this;

		var keys = Object.keys(byKM).sort();

		var months = this._getAllMonths(byKM);
		var monthLabels = months.map(function(m) { return self._formatMonthYear(m); });

		var series = keys.map(function(k, i) {
			var color = self._color(i);
			var data = months.map(function(mk) {
				var b = byKM[k][mk];
				if (!b) return 0;
				return Number(b.unitCost.toFixed(3));
			});
			return {
				name: k,
				type: 'line',
				itemStyle: { color: color },
				data: data
			};
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis'
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
			grid: { left: 70, right: 200, top: 40, bottom: 60 },
			xAxis: {
				type: 'category',
				data: monthLabels,
				axisLabel: { color: '#94a3b8' }
			},
			yAxis: {
				type: 'value',
				axisLabel: { color: '#94a3b8' },
				splitLine: { lineStyle: { color: '#334155' } }
			},
			series: series
		};
	},

	// Drill-through pivot table — one row per MonthYear, one column per group.
	// Shown via the shared `showTable` modal, same as the other tabs.
	getTableData() {
		var byKM = this.getMonthlyData();
		var self = this;
		var keys = Object.keys(byKM).sort();
		var months = this._getAllMonths(byKM);

		return months.map(function(mk) {
			var row = { 'MonthYear': self._formatMonthYear(mk) };
			keys.forEach(function(k) {
				var b = byKM[k][mk];
				if (!b) { row[k] = ''; return; }
				var v = b.unitCost;
				if (v < 0) {
					row[k] = '($' + Math.abs(v).toFixed(3) + ')';
				} else {
					row[k] = '$' + v.toFixed(3);
				}
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.ucViewBy) storeValue('ucViewBy', 'Location');
	}
}
