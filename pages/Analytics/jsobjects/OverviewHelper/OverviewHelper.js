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
		return s.chargesFormatted + '\nCharges\n\n'
			+ s.earliestMonth + '\nEarliest Month\n\n'
			+ s.latestMonth + '\nLatest Month\n\n'
			+ s.vendors + '\nVendors\n\n'
			+ s.utilityTypes + '\nUtility Types\n\n'
			+ s.locations + '\nLocations\n\n'
			+ s.accounts + '\nBilling Accounts\n\n'
			+ s.meters + '\nMeters';
	},

	getChargesOverYearsConfig() {
		var data = (fetch_analytics_data && fetch_analytics_data.data) || [];
		var byYearMonth = {};

		data.forEach(function(r) {
			var mk = (r.time_period || '').substring(0, 7);
			if (!mk) return;
			var parts = mk.split('-');
			var year = parts[0];
			var month = parseInt(parts[1], 10);
			if (!byYearMonth[year]) byYearMonth[year] = {};
			if (!byYearMonth[year][month]) byYearMonth[year][month] = 0;
			byYearMonth[year][month] += parseFloat(r.total_charges) || 0;
		});

		var years = Object.keys(byYearMonth).sort();
		var monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var yearColors = ['#f472b6','#c084fc','#60a5fa','#34d399','#fbbf24','#22d3ee','#fb923c'];

		var series = [];
		years.forEach(function(yr, idx) {
			var d = [];
			for (var m = 1; m <= 12; m++) {
				var v = byYearMonth[yr][m] || 0;
				d.push(Number(v.toFixed(2)));
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
			tooltip: { trigger: 'axis', backgroundColor: '#0F172A', borderColor: '#334155', textStyle: { color: '#E2E8F0' } },
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

		return {
			backgroundColor: '#1E293B',
			tooltip: { trigger: 'item', backgroundColor: '#0F172A', textStyle: { color: '#E2E8F0' } },
			legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'middle', textStyle: { color: '#E2E8F0', fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
			series: [{
				type: 'pie',
				radius: ['35%', '55%'],
				center: ['40%', '50%'],
				label: { color: '#E2E8F0', formatter: '{b}\n{c} ({d}%)' },
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
		var mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var rows = [];
		for (var m = 1; m <= 12; m++) {
			var row = { 'Month': mNames[m - 1] };
			var hasData = false;
			years.forEach(function(yr) {
				var v = (byYM[m] && byYM[m][yr]) || 0;
				if (v !== 0) { row[yr] = '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); hasData = true; }
				else { row[yr] = ''; }
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