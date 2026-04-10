export default {
	getViewBy() {
		return appsmith.store.ucViewBy || 'Location';
	},

	getChartTitle() {
		return this.getViewBy();
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
				b.unitCost = b.consumption !== 0 ? b.charges / b.consumption : null;
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

		// Drop groups that have no value at all
		var keys = Object.keys(byKM).filter(function(k) {
			return Object.keys(byKM[k]).some(function(mk) {
				return byKM[k][mk].unitCost != null;
			});
		}).sort();

		// Drop months with no group reporting a value
		var months = this._getAllMonths(byKM).filter(function(mk) {
			return keys.some(function(k) { return byKM[k][mk] && byKM[k][mk].unitCost != null; });
		});
		var monthLabels = months.map(function(m) { return self._formatMonthYear(m); });

		var series = keys.map(function(k, i) {
			var color = self._color(i);
			var data = months.map(function(mk) {
				var b = byKM[k][mk];
				if (!b || b.unitCost == null) return null;
				return Number(b.unitCost.toFixed(3));
			});
			return {
				name: k,
				type: 'line',
				connectNulls: false,
				symbol: 'circle',
				symbolSize: 6,
				lineStyle: { color: color, width: 2 },
				itemStyle: { color: color },
				data: data
			};
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'axis',
				backgroundColor: '#0f172a',
				borderColor: '#334155',
				textStyle: { color: '#e2e8f0' },
				formatter: function(params) {
					if (!params || !params.length) return '';
					var header = params[0].axisValueLabel || params[0].name || '';
					var lines = ['<b>' + header + '</b>'];
					params.forEach(function(p) {
						if (p.value == null) return;
						var v = Number(p.value);
						var disp = v < 0
							? '($' + Math.abs(v).toFixed(3) + ')'
							: '$' + v.toFixed(3);
						lines.push(p.marker + p.seriesName + '&nbsp;&nbsp;' + disp);
					});
					return lines.join('<br/>');
				}
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
				name: 'MonthYear',
				nameLocation: 'middle',
				nameGap: 35,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8', rotate: 35 },
				axisLine: { lineStyle: { color: '#334155' } }
			},
			yAxis: {
				type: 'value',
				name: 'Unit Cost',
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: {
					color: '#94a3b8',
					formatter: function(v) {
						return v < 0
							? '($' + Math.abs(v).toFixed(1) + ')'
							: '$' + Number(v).toFixed(1);
					}
				},
				axisLine: { lineStyle: { color: '#334155' } },
				splitLine: { lineStyle: { color: '#334155', type: 'dashed' } }
			},
			series: series
		};
	},

	// Drill-through pivot table — one row per MonthYear, one column per group.
	// Shown via the shared `showTable` modal, same as the other tabs.
	getTableData() {
		var byKM = this.getMonthlyData();
		var self = this;
		var keys = Object.keys(byKM).filter(function(k) {
			return Object.keys(byKM[k]).some(function(mk) {
				return byKM[k][mk].unitCost != null;
			});
		}).sort();
		var months = this._getAllMonths(byKM);

		return months.map(function(mk) {
			var row = { 'MonthYear': self._formatMonthYear(mk) };
			keys.forEach(function(k) {
				var b = byKM[k][mk];
				row[k] = (!b || b.unitCost == null) ? null : Number(b.unitCost.toFixed(3));
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.ucViewBy) storeValue('ucViewBy', 'Location');
	}
}
