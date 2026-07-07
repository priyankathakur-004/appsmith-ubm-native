export default {
		getTableData() {
				let data = [];

				/* Bill Health charts (Warnings over Time, Impacted Locations, Late Fees): the menu's
				   onClick computes the table (a trigger context) and stashes it in the store, so this
				   data path never reads those queries directly (which would entangle data + run trigger). */
				if (['WO_BillsImpacted', 'WO_WarningCount', 'IL_Locations', 'LF_LateFees', 'LF_Bills', 'LB_Bills', 'RB_Matrix', 'RB_Utility', 'RBL_Matrix', 'RC_Matrix', 'RC_Treemap'].includes(appsmith.store.chartName))
						return appsmith.store.woTable || [];

				if (Tabs.selectedTab === 'Rank of Locations')
						data = MA_RankLocationHelper.getTableData();

				if (Tabs.selectedTab === 'Weather Sensitivity') {
						if (appsmith.store.chartName === 'Time Series')
								data = MA_WeatherHelper.getTimeSeriesTable();

						if (appsmith.store.chartName === 'Correlation')
								data = MA_WeatherHelper.getCorrelationTable();

						if (appsmith.store.chartName === 'Scatter')
								data = MA_WeatherHelper.getScatterTable();
				}
			
				if (Tabs.selectedTab === 'Energy Consumption') {
						if (appsmith.store.chartName === 'EC_Location')
							data = MA_EnergyConsumptionHelper.getLocationTable();

						if (appsmith.store.chartName === 'EC_Meter')
							data = MA_EnergyConsumptionHelper.getMeterTable();

						if (appsmith.store.chartName === 'EC_Utility')
							data = MA_EnergyConsumptionHelper.getUtilityTable();
				}

				if (Tabs.selectedTab === 'Monthly Energy Consumption') {
						if (appsmith.store.chartName === 'MEC_Monthly')
							data = MA_MonthlyEnergyHelper.getMonthlyTable();
				}

				if (Tabs.selectedTab === 'Utility Tree') {
						data = MA_UtilityTreeHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Location Details') {
						data = MA_LocationDetailsHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Per Square Feet') {
						data = MA_PerSquareFeetHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Monthly Electric Demand') {
						data = MA_MonthlyElectricDemandHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Unit Cost') {
						data = MA_UnitCostHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Charges') {
						data = MA_ChargesHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Charges Forecast') {
						data = MA_ChargesForecastHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Consumption') {
						data = MA_ConsumptionHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Charges vs Consumption') {
						data = MA_ChargesVsConsumptionHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Overview') {
						data = MA_OverviewHelper.getTableData();
				}

				if (Tabs.selectedTab === 'Over the Years') {
						if (appsmith.store.chartName === 'OTY_Charges')
							data = MA_OverTheYearsHelper.getChargesTable();

						if (appsmith.store.chartName === 'OTY_Consumption')
							data = MA_OverTheYearsHelper.getConsumptionTable();

						if (appsmith.store.chartName === 'OTY_UnitCost')
							data = MA_OverTheYearsHelper.getUnitCostTable();
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
	
		getTableHtml() {
				const data = this.getTableData();
				if (!data || !data.length) return '<div style="padding:20px;color:#94A3B8;text-align:center;">No data available</div>';
				const keys = Object.keys(data[0]);
				const thStyle = 'padding:10px 14px;color:#F1F5F9;font-size:13px;font-weight:700;border-bottom:2px solid #475569;white-space:nowrap;';
				const tdStyle = 'padding:10px 14px;color:#E2E8F0;font-size:12px;border-bottom:1px solid #334155;';
				const header = '<tr style="background:#334155;">' + keys.map(k => '<th style="' + thStyle + 'text-align:left;">' + k + '</th>').join('') + '</tr>';
				const rows = data.map(r => '<tr>' + keys.map(k => '<td style="' + tdStyle + '">' + (r[k] != null ? r[k] : '') + '</td>').join('') + '</tr>').join('');
				return '<div style="max-height:600px;overflow:auto;"><table style="width:100%;border-collapse:collapse;background:#1E293B;">' + header + rows + '</table></div>';
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
			removeValue('cnViewBy');
			removeValue('cvViewBy');
			removeValue('cvVendor');
		},

		setDefaults() {
			if (Tabs.selectedTab === 'Weather Sensitivity' || Tabs.selectedTab === 'Monthly Electric Demand' || Tabs.selectedTab === 'Unit Cost' || Tabs.selectedTab === 'Consumption' || Tabs.selectedTab === 'Charges vs Consumption') {
				 UtilityTypeSelect.setSelectedOption("ELECTRIC");
			}
			if (Tabs.selectedTab === 'Consumption') {
				MA_ConsumptionHelper.setDefaults();
			}
			if (Tabs.selectedTab === 'Charges vs Consumption') {
				MA_ChargesVsConsumptionHelper.setDefaults();
			}
			removeValue('mecSelectedLocation');
			removeValue('ecSelectedLocation');
			removeValue('otySelectedLocation');
		}
}