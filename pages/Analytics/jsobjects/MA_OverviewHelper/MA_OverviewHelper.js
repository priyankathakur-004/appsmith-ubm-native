export default {

	getSummary() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var charges = 0;
		var utilTypes = {};
		var locations = {};
		var vendors = {};
		var accounts = {};
		var meters = {};
		var months = {};

		data.forEach(function(r) {
			charges += parseFloat(r.total_charges) || 0;
			if (r.utility_type) utilTypes[r.utility_type] = true;
			if (r.location_description) locations[r.location_description] = true;
			if (r.vendor_name) vendors[r.vendor_name] = true;
			if (r.service_account) accounts[r.service_account] = true;
			if (r.meter) meters[r.meter] = true;
			var mk = (r.time_period || '').substring(0, 7);
			if (mk) months[mk] = true;
		});

		var sortedMonths = Object.keys(months).sort();
		var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
		var earliest = '';
		var latest = '';
		if (sortedMonths.length > 0) {
			var ep = sortedMonths[0].split('-');
			earliest = monthNames[parseInt(ep[1], 10) - 1] + ' ' + ep[0];
			var lp = sortedMonths[sortedMonths.length - 1].split('-');
			latest = monthNames[parseInt(lp[1], 10) - 1] + ' ' + lp[0];
		}

		var abs = Math.abs(charges);
		var parts = abs.toFixed(2).split('.');
		var intPart = parts[0];
		var dec = parts[1];
		var groups = [];
		while (intPart.length > 3) {
			groups.unshift(intPart.slice(-3));
			intPart = intPart.slice(0, -3);
		}
		groups.unshift(intPart);
		var fmt = '$' + groups.join(',') + '.' + dec;

		return {
			charges: charges,
			chargesFormatted: fmt,
			utilityTypes: Object.keys(utilTypes).length,
			locations: Object.keys(locations).length,
			vendors: Object.keys(vendors).length,
			accounts: Object.keys(accounts).length,
			meters: Object.keys(meters).length,
			earliestMonth: earliest,
			latestMonth: latest
		};
	},

	getSummaryText() {
		var s = this.getSummary();
		var cell = function(val, label) {
			return '<div style="padding:10px 12px;">'
				+ '<div style="font-size:17px;font-weight:700;color:#F1F5F9;">' + val + '</div>'
				+ '<div style="font-size:13px;color:#94A3B8;margin-top:2px;">' + label + '</div></div>';
		};
		return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;">'
			+ cell(s.chargesFormatted, 'Charges')
			+ cell(s.utilityTypes, 'Utility Types')
			+ cell(s.earliestMonth, 'Earliest Month')
			+ cell(s.locations, 'Locations')
			+ cell(s.latestMonth, 'Latest Month')
			+ cell(s.accounts, 'Billing Accounts')
			+ cell(s.vendors, 'Vendors')
			+ cell(s.meters, 'Meters')
			+ '</div>';
	},

	getChargesOverYearsConfig() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byYearMonth = {};
		var byYearMonthLoc = {};

		data.forEach(function(r) {
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			var parts = mk.split('-');
			var year = parts[0];
			var month = parseInt(parts[1], 10);
			var loc = r.location_description || r.address || 'Unknown';
			var charges = parseFloat(r.total_charges) || 0;
			if (!byYearMonth[year]) byYearMonth[year] = {};
			if (!byYearMonth[year][month]) byYearMonth[year][month] = 0;
			byYearMonth[year][month] += charges;
			var ymKey = year + '-' + month;
			if (!byYearMonthLoc[ymKey]) byYearMonthLoc[ymKey] = {};
			if (!byYearMonthLoc[ymKey][loc]) byYearMonthLoc[ymKey][loc] = 0;
			byYearMonthLoc[ymKey][loc] += charges;
		});

		var years = Object.keys(byYearMonth).sort();
		var monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var yearColors = ['#f472b6','#c084fc','#60a5fa','#34d399','#fbbf24','#22d3ee','#fb923c'];

		var locTooltips = {};
		Object.keys(byYearMonthLoc).forEach(function(ymKey) {
			var locs = byYearMonthLoc[ymKey];
			var sorted = Object.keys(locs).map(function(l) { return { name: l, value: locs[l] }; })
				.sort(function(a, b) { return b.value - a.value; }).slice(0, 8);
			var maxVal = sorted.length > 0 ? sorted[0].value : 1;
			var bars = sorted.map(function(item) {
				var pct = Math.round((item.value / maxVal) * 100);
				var fmt = '$' + Math.round(item.value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
				return '<div style="display:flex;align-items:center;margin:2px 0;">'
					+ '<div style="width:60px;font-size:11px;color:#CBD5E1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.name + '</div>'
					+ '<div style="flex:1;height:14px;background:#1E293B;border-radius:2px;margin:0 6px;">'
					+ '<div style="width:' + pct + '%;height:100%;background:#3B82F6;border-radius:2px;"></div></div>'
					+ '<div style="font-size:11px;color:#CBD5E1;white-space:nowrap;">' + fmt + '</div></div>';
			}).join('');
			locTooltips[ymKey] = '<div style="padding:4px 0;"><div style="font-weight:bold;font-size:12px;color:#E2E8F0;margin-bottom:4px;">Charges by Location</div>' + bars + '</div>';
		});

		var series = [];
		years.forEach(function(yr, idx) {
			var d = [];
			for (var m = 1; m <= 12; m++) {
				var v = byYearMonth[yr][m] || 0;
				var ymKey = yr + '-' + m;
				d.push({
					value: Number(v.toFixed(2)),
					tooltip: { formatter: locTooltips[ymKey] || '' }
				});
			}
			series.push({
				name: yr,
				type: 'line',
				symbol: 'circle',
				symbolSize: 8,
				lineStyle: { width: 2 },
				itemStyle: { color: yearColors[idx % yearColors.length] },
				data: d
			});
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'item', backgroundColor: '#0F172A', borderColor: '#334155', textStyle: { color: '#E2E8F0' }, extraCssText: 'max-width:350px;' },
			legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'middle', textStyle: { color: '#E2E8F0', fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
			grid: { left: 70, right: 120, top: 20, bottom: 40 },
			xAxis: { type: 'category', data: monthLabels, axisLabel: { color: '#CBD5E1', fontSize: 11 }, axisLine: { lineStyle: { color: '#475569' } }, splitLine: { show: false } },
			yAxis: { type: 'value', axisLabel: { color: '#CBD5E1' }, axisLine: { lineStyle: { color: '#475569' } }, splitLine: { lineStyle: { color: '#334155', type: 'dashed' } } },
			series: series
		};
	},

	getCostBreakdownConfig() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byType = {};
		data.forEach(function(r) {
			var t = r.utility_type || 'Unknown';
			if (!byType[t]) byType[t] = 0;
			byType[t] += parseFloat(r.total_charges) || 0;
		});

		var colors = { ELECTRIC: '#3B82F6', NATURALGAS: '#84CC16', LIGHTING: '#FBBF24', SEWER: '#6B7280', WATER: '#22D3EE', OIL2: '#065F46', STEAM: '#F59E0B' };
		var rows = Object.keys(byType).map(function(k) { return { name: k, value: Number(byType[k].toFixed(2)) }; }).sort(function(a, b) { return b.value - a.value; });
		var total = rows.reduce(function(s, r) { return s + r.value; }, 0);
		rows.forEach(function(r) {
			var mVal = '$' + (Math.abs(r.value) / 1000000).toFixed(2) + 'M';
			var pct = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
			r.label = { formatter: r.name + '\n' + mVal + ' (' + pct + '%)' };
		});

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'item', backgroundColor: '#0F172A', textStyle: { color: '#E2E8F0' } },
			legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'middle', textStyle: { color: '#E2E8F0', fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
			series: [{
				type: 'pie',
				radius: ['35%', '55%'],
				center: ['40%', '50%'],
				label: { color: '#E2E8F0' },
				labelLine: { length: 15, length2: 20, lineStyle: { color: '#64748B' } },
				data: rows,
				color: rows.map(function(r) { return colors[r.name] || '#94A3B8'; })
			}]
		};
	},

	getMapMarkers() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byLoc = {};
		data.forEach(function(r) {
			var key = (r.latitude || '') + ',' + (r.longitude || '');
			if (!key || key === ',') return;
			if (!byLoc[key]) byLoc[key] = { lat: parseFloat(r.latitude) || 0, lng: parseFloat(r.longitude) || 0, address: r.address || '', charges: 0 };
			byLoc[key].charges += parseFloat(r.total_charges) || 0;
		});
		return Object.keys(byLoc).map(function(k) {
			var d = byLoc[k];
			return { lat: d.lat, long: d.lng, title: d.address + ' ($' + Math.round(d.charges).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ')' };
		});
	},

	getUtilityTable() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byType = {};
		data.forEach(function(r) {
			var t = r.utility_type || 'Unknown';
			var uom = r.total_consumption_uom || '';
			if (!byType[t]) byType[t] = { charges: 0, consumption: 0, uom: uom };
			byType[t].charges += parseFloat(r.total_charges) || 0;
			byType[t].consumption += parseFloat(r.consumption) || 0;
			if (uom) byType[t].uom = uom;
		});
		return Object.keys(byType).sort(function(a, b) { return byType[b].charges - byType[a].charges; }).map(function(t) {
			var d = byType[t];
			var unitCost = d.consumption !== 0 ? d.charges / d.consumption : 0;
			return { 'Utility Type': t, 'Charges': '$' + Math.abs(d.charges).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), 'Unit Cost': '$' + unitCost.toFixed(3), 'Unit': d.uom };
		});
	},

	getUtilitySummaryHtml() {
		var tbl = this.getUtilityTable();
		var thStyle = 'padding:14px;color:#94A3B8;font-size:12px;font-weight:600;border-bottom:1px solid #475569;';
		var tdStyle = 'padding:14px;color:#E2E8F0;font-size:12px;border-bottom:1px solid #1E293B;';
		var header = '<tr style="background:#334155;">'
			+ '<th style="' + thStyle + 'text-align:left;">Utility Type</th>'
			+ '<th style="' + thStyle + 'text-align:right;">Charges</th>'
			+ '<th style="' + thStyle + 'text-align:right;">Unit Cost</th>'
			+ '<th style="' + thStyle + 'text-align:right;">Unit</th></tr>';
		var rows = tbl.map(function(r) {
			return '<tr>'
				+ '<td style="' + tdStyle + '">' + r['Utility Type'] + '</td>'
				+ '<td style="' + tdStyle + 'text-align:right;">' + r['Charges'] + '</td>'
				+ '<td style="' + tdStyle + 'text-align:right;">' + r['Unit Cost'] + '</td>'
				+ '<td style="' + tdStyle + 'text-align:right;">' + r['Unit'] + '</td></tr>';
		}).join('');
		return '<table style="width:100%;border-collapse:collapse;background:#1E293B;">' + header + rows + '</table>';
	},

	getChargesOverYearsTable() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byYM = {};
		var yearsSet = {};
		data.forEach(function(r) {
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			var parts = mk.split('-');
			var year = parts[0];
			var month = parseInt(parts[1], 10);
			yearsSet[year] = true;
			if (!byYM[month]) byYM[month] = {};
			if (!byYM[month][year]) byYM[month][year] = 0;
			byYM[month][year] += parseFloat(r.total_charges) || 0;
		});
		var years = Object.keys(yearsSet).sort().reverse();
		var yrKeys = years.map(function(yr) { return yr + '\u2009'; });
		var mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var rows = [];
		for (var m = 1; m <= 12; m++) {
			var row = { 'Month': mNames[m - 1] };
			var hasData = false;
			years.forEach(function(yr, yi) {
				var v = (byYM[m] && byYM[m][yr]) || 0;
				if (v !== 0) { row[yrKeys[yi]] = '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); hasData = true; }
				else { row[yrKeys[yi]] = ''; }
			});
			if (hasData) rows.push(row);
		}
		return rows;
	},

	getCostBreakdownTable() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byType = {};
		data.forEach(function(r) {
			var t = r.utility_type || 'Unknown';
			if (!byType[t]) byType[t] = 0;
			byType[t] += parseFloat(r.total_charges) || 0;
		});
		return Object.keys(byType).sort(function(a, b) { return byType[b] - byType[a]; }).map(function(t) {
			return { 'Utility Type': t, 'Charges': '$' + Math.abs(byType[t]).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') };
		});
	},

	getMapTable() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byLoc = {};
		data.forEach(function(r) {
			var key = (r.latitude || '') + ',' + (r.longitude || '');
			if (!key || key === ',') return;
			if (!byLoc[key]) byLoc[key] = { lat: parseFloat(r.latitude) || 0, lng: parseFloat(r.longitude) || 0, address: r.address || '', charges: 0 };
			byLoc[key].charges += parseFloat(r.total_charges) || 0;
		});
		return Object.keys(byLoc).map(function(k) {
			var d = byLoc[k];
			return { 'Location Latitude, Location Longitude': d.lat.toFixed(2) + ', ' + d.lng.toFixed(2), 'Charges YTD': '$' + Math.round(d.charges).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','), 'Location Address': d.address };
		});
	},

	getTableData() {
		var chartName = appsmith.store.chartName || '';
		if (chartName === 'OV_ChargesOverYears') return this.getChargesOverYearsTable();
		if (chartName === 'OV_CostBreakdown') return this.getCostBreakdownTable();
		if (chartName === 'OV_Map') return this.getMapTable();
		return this.getUtilityTable();
	},

	setDefaults() {}
}