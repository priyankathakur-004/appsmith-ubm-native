export default {
		getTableData() {
				let data = [];

				if (Tabs.selectedTab === 'Rank of Locations')
						data = RankLocationHelper.getTableData();

				if (Tabs.selectedTab === 'Weather Sensitivity') {
						if (appsmith.store.chartName === 'WS_Time_Series')
								data = WeatherHelper.getTimeSeriesTable();

						if (appsmith.store.chartName === 'WS_Correlation')
								data = WeatherHelper.getCorrelationTable();

						if (appsmith.store.chartName === 'WS_Scatter')
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
		},
	
}