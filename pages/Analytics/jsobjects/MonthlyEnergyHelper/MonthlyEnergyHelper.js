export default {
    getBTUConversionFactor(utilityType, uom) {
        const btuFactors = {
            'ELECTRIC': 3412.14,
            'NATURALGAS': 102800,
            'OIL2': 138500,
            'STEAM': 1000,
            'WATER': 0,
            'SEWER': 0
        };
        const baseBTU = btuFactors[utilityType] || 0;
        const selectedUOM = uom || appsmith.store.mecUOM || 'BTU';
        if (selectedUOM === 'Wh') return baseBTU * 0.29307107;
        if (selectedUOM === 'Joule') return baseBTU * 1055.06;
        return baseBTU;
    },

    getUOMLabel() {
        const uom = appsmith.store.mecUOM || 'BTU';
        if (uom === 'Wh') return 'Watt hour';
        if (uom === 'Joule') return 'Joule';
        return 'mmBTU';
    },

    getActiveView() {
        return appsmith.store.mecActiveView || 'Consumption';
    },

    getChartType() {
        return appsmith.store.mecChartType || 'scatter';
    },

    getChartTitle() {
        const view = this.getActiveView();
        const uomLabel = this.getUOMLabel();
        const titles = {
            'Consumption': 'Monthly energy consumption by location',
            'UnitCost': 'Monthly unit cost by location',
            'EnergyUseIntensity': 'Monthly energy use intensity by location'
        };
        return titles[view] || titles['Consumption'];
    },

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
				const stored = appsmith.store.mecSelectedLocations;
				if (stored && stored.length > 0) {
						return stored;
				}
				return this.getLocationOptions().map(o => o.value);
		},

    getMonthlyData() {
        const raw = fetch_analytics_data.data || [];
        const uom = appsmith.store.mecUOM || 'BTU';
        const selectedLocs = this.getSelectedLocations();
        const byLocMonth = {};

        raw.forEach(r => {
            const loc = r.location_description || 'Unknown';
            if (!selectedLocs.includes(loc)) return;

            const date = r.time_period || '';
            const month = date.substring(0, 7);
            if (!month) return;

            if (!byLocMonth[loc]) byLocMonth[loc] = {};
            if (!byLocMonth[loc][month]) byLocMonth[loc][month] = { consumption: 0, charges: 0, sqft: parseFloat(r.square_feet) || 0 };

            const factor = this.getBTUConversionFactor(r.utility_type, uom);
            const cons = parseFloat(r.consumption) || 0;
            byLocMonth[loc][month].consumption += (cons * factor) / 1000000;
            byLocMonth[loc][month].charges += parseFloat(r.total_charges) || 0;
        });

        return byLocMonth;
    },

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
            return monthNames[parseInt(parts[1])-1] + ' ' + parts[0];
        });

        const locations = Object.keys(byLocMonth).sort();

        const header = ['Month'].concat(locations);
        const rows = sortedMonths.map((m, i) => {
            const row = [monthLabels[i]];
            locations.forEach(loc => {
                const d = (byLocMonth[loc] || {})[m];
                if (!d) { row.push(null); return; }
                let val = d.consumption;
                if (view === 'UnitCost') val = d.charges;
                if (view === 'EnergyUseIntensity') val = d.sqft > 0 ? d.consumption / d.sqft : 0;
                row.push(Number(val.toFixed(2)));
            });
            return row;
        });

        const source = [header].concat(rows);

        const series = locations.map(() => ({
            type: chartType
        }));

        let yName = 'Equivalent Energy Consumption (' + uomLabel + ')';
        if (view === 'UnitCost') yName = 'Total Charges ($)';
        if (view === 'EnergyUseIntensity') yName = 'Energy Use Intensity (' + uomLabel + '/sqft)';

        return {
            dataset: { source: source },
            tooltip: {
                trigger: chartType === 'scatter' ? 'item' : 'axis',
                axisPointer: { type: 'shadow' }
            },
            legend: {
                type: 'scroll',
                top: 10
            },
            grid: {
                left: 15,
                right: 15,
                bottom: 30,
                top: 60,
                containLabel: true
            },
            xAxis: [{ type: 'category' }],
            yAxis: [{
                type: 'value',
                name: yName,
                nameLocation: 'middle',
                nameGap: 55
            }],
            series: series
        };
    },

    setDefaults() {
        if (!appsmith.store.mecActiveView) storeValue('mecActiveView', 'Consumption');
        if (!appsmith.store.mecChartType) storeValue('mecChartType', 'scatter');
        if (!appsmith.store.mecUOM) storeValue('mecUOM', 'BTU');
    }
}