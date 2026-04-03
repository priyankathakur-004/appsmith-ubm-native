export default {
		getTableData() {
				let data = [];

				if (Tabs.selectedTab === 'Rank of Locations')
						data = RankLocationHelper.getTableData();

				if (Tabs.selectedTab === 'Weather Sensitivity') {
						if (appsmith.store.chartName === 'Time Series')
								data = WeatherHelper.getTimeSeriesTable();

						if (appsmith.store.chartName === 'Correlation')
								data = WeatherHelper.getCorrelationTable();

						if (appsmith.store.chartName === 'Scatter')
								data = WeatherHelper.getScatterTable();
				}
			
				if (Tabs.selectedTab === 'Energy Consumption') {
						if (appsmith.store.chartName === 'EC_Location')
							data = EnergyConsumptionHelper.getLocationTable();

						if (appsmith.store.chartName === 'EC_Meter')
							data = EnergyConsumptionHelper.getMeterTable();

						if (appsmith.store.chartName === 'EC_Utility')
							data = EnergyConsumptionHelper.getUtilityTable();
				}

				if (Tabs.selectedTab === 'Monthly Energy Consumption') {
						if (appsmith.store.chartName === 'MEC_Monthly')
							data = MonthlyEnergyHelper.getMonthlyTable();
				}

				if (Tabs.selectedTab === 'Over the Years') {
						if (appsmith.store.chartName === 'OTY_Charges')
							data = OverTheYearsHelper.getChargesTable();

						if (appsmith.store.chartName === 'OTY_Consumption')
							data = OverTheYearsHelper.getConsumptionTable();

						if (appsmith.store.chartName === 'OTY_UnitCost')
							data = OverTheYearsHelper.getUnitCostTable();
				}

				/* Auto format numbers */
				return data.map(row => {
						const r = {};

						Object.keys(row).forEach(k => {
								const v = row[k];
								r[k] = typeof v === "number" ? Number(v.toFixed(2)) : v;
						});

						return r;
				});

		},
	
		exportCSV() {
				const data = this.getTableData();

				if (!data.length) {
						showAlert("No data to export", "warning");
						return;
				}

				const headers = Object.keys(data[0]);
				const csv = headers.join(",") + "\n" + data.map(r => headers.map(h => r[h]).join(",")).join("\n");
				download(csv, "analytics.csv", "application/csv");

		},

		clear() {
			removeValue('chartName');
			removeValue('viewType');
			removeValue('selectedSite');
			removeValue('selectedLocation');
			removeValue('dateRange');
			removeValue('filters');
			removeValue('analyticsData');
			removeValue('demandData');
			removeValue('ecActiveView');
			removeValue('ecUOM');
			removeValue('mecActiveView');
			removeValue('mecChartType');
			removeValue('mecUOM');
			removeValue('mecSelectedLocation');
			removeValue('ecSelectedLocation');
			removeValue('otySelectedLocation');
		},

		setDefaults() {
			if (Tabs.selectedTab === 'Weather Sensitivity') {
				 UtilityTypeSelect.setSelectedOption("ELECTRIC");
			}
			removeValue('mecSelectedLocation');
			removeValue('ecSelectedLocation');
			removeValue('otySelectedLocation');
		}
}