export default {
	getViewBy() {
		return appsmith.store.chViewBy || 'Location';
	},

	getChartTitle() {
		var view = this.getViewBy();
		if (view === 'Service Account') return 'Location, Service Account';
		if (view === 'Meter') return 'Location, Service Account, Meter';
		if (view === 'Vendors') return 'Vendors';
		if (view === 'Utilities') return 'Utilities';
		return 'Location';
	},

	_rowKey(r, view) {
		var loc = r.location_description || 'Unknown';
		if (view === 'Service Account') return loc + ', ' + (r.service_account || '');
		if (view === 'Meter') return loc + ', ' + (r.service_account || '') + ', ' + (r.meter || '');
		if (view === 'Vendors') return r.vendor_name || 'Unknown';
		if (view === 'Utilities') return r.utility_type || 'Unknown';
		return loc;
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

	getSelectedGroup() {
		var picked = (typeof CHLocCheckbox !== 'undefined' && CHLocCheckbox && CHLocCheckbox.model && CHLocCheckbox.model.selectedValue) || null;
		if (picked) return [picked];
		return this.getGroupOptions().map(function(o) { return o.value; });
	},

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
			if (!byKeyMonth[key][mk]) byKeyMonth[key][mk] = { charges: 0 };
			byKeyMonth[key][mk].charges += parseFloat(r.total_charges) || 0;
		});

		return byKeyMonth;
	},

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

		var series = [];
		keys.forEach(function(k, i) {
			var color = self._color(i);
			var data = [];
			months.forEach(function(mk, idx) {
				var b = byKM[k][mk];
				if (!b) return;
				var v = Number(b.charges.toFixed(2));
				if (v === 0) return;
				data.push([idx, v]);
			});
			if (data.length === 0) return;
			series.push({
				name: k,
				type: 'line',
				itemStyle: { color: color },
				data: data
			});
		});
		keys = series.map(function(s) { return s.name; });

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
				name: 'Charges ($)',
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8' },
				splitLine: { lineStyle: { color: '#334155' } }
			},
			series: series
		};
	},

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
				var v = b.charges;
				if (v < 0) {
					row[k] = '($' + Math.abs(v).toFixed(2) + ')';
				} else {
					row[k] = '$' + v.toFixed(2);
				}
			});
			return row;
		});
	},

	setDefaults() {
		if (!appsmith.store.chViewBy) storeValue('chViewBy', 'Location');
	}
}
