export default {
	getViewBy() {
		return appsmith.store.cvViewBy || 'Location';
	},

	getChartTitle() {
		var view = this.getViewBy();
		if (view === 'Service Account') return 'Location, Service Account';
		if (view === 'Vendors') return 'Vendors';
		return 'Location';
	},

	_rowKey(r, view) {
		var loc = r.location_description || 'Unknown';
		if (view === 'Service Account') return loc + ', ' + (r.service_account || '');
		if (view === 'Vendors') return r.vendor_name || 'Unknown';
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
		var picked = (typeof CVLocCheckbox !== 'undefined' && CVLocCheckbox && CVLocCheckbox.model && CVLocCheckbox.model.selectedValue) || null;
		if (picked) return [picked];
		return null;
	},

	getVendorOptions() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var set = {};
		data.forEach(function(r) {
			var v = r.vendor_name || 'Unknown';
			set[v] = true;
		});
		return Object.keys(set).sort().map(function(k) { return { label: k, value: k }; });
	},

	getSelectedVendors() {
		var view = this.getViewBy();
		if (view !== 'Location') return null;
		var arr = null;
		if (typeof CVVendorSelect !== 'undefined' && CVVendorSelect && CVVendorSelect.selectedOptionValueArr) {
			arr = CVVendorSelect.selectedOptionValueArr;
		}
		if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
		return arr;
	},

	_getRawPoints() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var view = this.getViewBy();
		var selected = this.getSelectedGroup();
		var self = this;
		var sel = null;
		if (selected) {
			sel = {};
			selected.forEach(function(s) { sel[s] = true; });
		}

		/* vendor filter only for Location view */
		var vendors = this.getSelectedVendors();
		var vSet = null;
		if (vendors) {
			vSet = {};
			vendors.forEach(function(v) { vSet[v] = true; });
		}

		var points = [];
		data.forEach(function(r) {
			if (vSet && !vSet[r.vendor_name || 'Unknown']) return;
			var key = self._rowKey(r, view);
			if (sel && !sel[key]) return;
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			points.push({
				key: key,
				mk: mk,
				consumption: parseFloat(r.consumption) || 0,
				charges: parseFloat(r.total_charges) || 0
			});
		});

		return points;
	},

	_getMonthlyDetail() {
		var raw = this._getRawPoints();
		var byKeyMonth = {};
		raw.forEach(function(p) {
			if (!byKeyMonth[p.key]) byKeyMonth[p.key] = {};
			if (!byKeyMonth[p.key][p.mk]) byKeyMonth[p.key][p.mk] = { consumption: 0, charges: 0 };
			byKeyMonth[p.key][p.mk].consumption += p.consumption;
			byKeyMonth[p.key][p.mk].charges += p.charges;
		});
		return byKeyMonth;
	},

	_formatMonthYear(mk) {
		var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var p = mk.split('-');
		return (months[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
	},

	_color(idx) {
		var palette = [
			'#60a5fa','#34d399','#f472b6','#fbbf24','#a78bfa','#22d3ee',
			'#fb923c','#4ade80','#f87171','#c084fc','#facc15','#2dd4bf',
			'#818cf8','#fda4af'
		];
		return palette[idx % palette.length];
	},

	_linearRegression(points) {
		var n = points.length;
		if (n < 2) return null;
		var sx = 0, sy = 0, sxy = 0, sx2 = 0;
		points.forEach(function(p) {
			sx += p[0];
			sy += p[1];
			sxy += p[0] * p[1];
			sx2 += p[0] * p[0];
		});
		var denom = n * sx2 - sx * sx;
		if (denom === 0) return null;
		var slope = (n * sxy - sx * sy) / denom;
		var intercept = (sy - slope * sx) / n;
		return { slope: slope, intercept: intercept };
	},

	_fmtNum(v) {
		var s = '';
		var abs = Math.abs(v);
		var parts = abs.toFixed(2).split('.');
		var intPart = parts[0];
		var dec = parts[1];
		var groups = [];
		while (intPart.length > 3) {
			groups.unshift(intPart.slice(-3));
			intPart = intPart.slice(0, -3);
		}
		groups.unshift(intPart);
		s = groups.join(',') + '.' + dec;
		if (v < 0) return '($' + s + ')';
		return '$' + s;
	},

	_fmtCons(v) {
		var abs = Math.abs(v);
		var intPart = Math.round(abs).toString();
		var groups = [];
		while (intPart.length > 3) {
			groups.unshift(intPart.slice(-3));
			intPart = intPart.slice(0, -3);
		}
		groups.unshift(intPart);
		return groups.join(',');
	},

	_fmtAxisK(v) {
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
		return '' + v;
	},

	_pickScale(maxVal) {
		if (maxVal >= 800000) return { divisor: 1000000, suffix: 'M' };
		return { divisor: 1000, suffix: 'K' };
	},

	getChartConfig() {
		var byKM = this._getMonthlyDetail();
		var self = this;
		var view = this.getViewBy();
		var label = view === 'Service Account' ? 'Location, Service Acct' : view === 'Vendors' ? 'Vendor' : 'Location';

		var keys = Object.keys(byKM).sort();
		var rawPoints = [];
		keys.forEach(function(k) {
			var months = Object.keys(byKM[k]).sort();
			months.forEach(function(mk) {
				var d = byKM[k][mk];
				rawPoints.push({ x: Number(d.consumption.toFixed(2)), y: Number(d.charges.toFixed(2)), key: k, mk: mk });
			});
		});

		var maxX = 0;
		var maxY = 0;
		rawPoints.forEach(function(p) {
			if (Math.abs(p.x) > maxX) maxX = Math.abs(p.x);
			if (Math.abs(p.y) > maxY) maxY = Math.abs(p.y);
		});

		var xScale = this._pickScale(maxX);
		var yScale = this._pickScale(maxY);

		var allScaled = [];
		var seriesMap = {};
		rawPoints.forEach(function(p) {
			var sx = Number((p.x / xScale.divisor).toFixed(4));
			var sy = Number((p.y / yScale.divisor).toFixed(4));
			allScaled.push([sx, sy]);
			var tip = 'Month Year   ' + self._formatMonthYear(p.mk)
				+ '\n' + label + '   ' + p.key
				+ '\nConsumption   ' + self._fmtCons(p.x)
				+ '\nCharges   ' + self._fmtNum(p.y);
			if (!seriesMap[p.key]) seriesMap[p.key] = [];
			seriesMap[p.key].push({ value: [sx, sy], name: tip });
		});

		var series = [];
		keys.forEach(function(k, i) {
			if (!seriesMap[k]) return;
			series.push({
				name: k,
				type: 'scatter',
				symbolSize: 10,
				itemStyle: { color: self._color(i) },
				data: seriesMap[k]
			});
		});
		keys = series.map(function(s) { return s.name; });

		var reg = this._linearRegression(allScaled);
		if (reg && allScaled.length >= 2) {
			var xs = allScaled.map(function(p) { return p[0]; });
			var minXs = Math.min.apply(null, xs);
			var maxXs = Math.max.apply(null, xs);
			var y1 = reg.slope * minXs + reg.intercept;
			var y2 = reg.slope * maxXs + reg.intercept;
			series.push({
				name: 'Trend',
				type: 'line',
				showSymbol: false,
				lineStyle: { type: 'dashed', color: '#64748b', width: 2 },
				itemStyle: { color: '#64748b' },
				data: [[minXs, Number(y1.toFixed(4))], [maxXs, Number(y2.toFixed(4))]],
				tooltip: { show: false },
				z: 0
			});
		}

		return {
			backgroundColor: '#1E293B',
			tooltip: {
				trigger: 'item',
				formatter: '{b}',
				backgroundColor: '#ffffff',
				textStyle: { color: '#1e293b', fontSize: 13 },
				borderColor: '#e2e8f0',
				borderWidth: 1,
				confine: true,
				extraCssText: 'white-space:pre; font-family:system-ui; line-height:1.8; padding:10px 14px;'
			},
			legend: {
				type: 'scroll',
				orient: 'vertical',
				right: 10,
				top: 'middle',
				textStyle: { color: '#e2e8f0', fontSize: 12 },
				icon: 'circle',
				itemWidth: 10,
				itemHeight: 10,
				data: keys
			},
			grid: { left: 70, right: 200, top: 40, bottom: 80 },
			xAxis: {
				type: 'value',
				name: 'Consumption (KWH)',
				nameLocation: 'middle',
				nameGap: 40,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8', formatter: '{value}' + xScale.suffix },
				splitLine: { lineStyle: { color: 'rgba(51,65,85,0.25)', type: [2, 4], width: 1 } }
			},
			yAxis: {
				type: 'value',
				name: 'Charges ($)',
				nameLocation: 'middle',
				nameGap: 55,
				nameTextStyle: { color: '#e2e8f0' },
				axisLabel: { color: '#94a3b8', formatter: '${value}' + yScale.suffix },
				splitLine: { lineStyle: { color: 'rgba(51,65,85,0.25)', type: [2, 4], width: 1 } }
			},
			dataZoom: [
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
					left: 5,
					width: 14,
					borderColor: '#334155',
					backgroundColor: '#0f172a',
					fillerColor: 'rgba(59,130,246,0.18)',
					handleStyle: { color: '#e2e8f0', borderColor: '#64748b' },
					textStyle: { color: '#94a3b8' },
					showDetail: false
				},
				{
					type: 'inside',
					xAxisIndex: 0,
					zoomOnMouseWheel: true,
					moveOnMouseWheel: false,
					throttle: 50
				},
				{
					type: 'inside',
					yAxisIndex: 0,
					zoomOnMouseWheel: true,
					moveOnMouseWheel: false,
					throttle: 50
				}
			],
			series: series
		};
	},

	getTableData() {
		var byKM = this._getMonthlyDetail();
		var self = this;
		var keys = Object.keys(byKM).sort();
		var view = this.getViewBy();
		var label = view === 'Service Account' ? 'Location, Service Acct' : view === 'Vendors' ? 'Vendor' : 'Location';

		var rows = [];
		keys.forEach(function(k) {
			var months = Object.keys(byKM[k]).sort().reverse();
			months.forEach(function(mk) {
				var d = byKM[k][mk];
				var row = {};
				row[label] = k;
				row['Month'] = self._formatMonthYear(mk);
				row['Consumption'] = Number(d.consumption.toFixed(2));
				row['Charges'] = Number(d.charges.toFixed(2));
				rows.push(row);
			});
		});

		return rows;
	},

	setDefaults() {
		if (!appsmith.store.cvViewBy) storeValue('cvViewBy', 'Location');
	}
}
