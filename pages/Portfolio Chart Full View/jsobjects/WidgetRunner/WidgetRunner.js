export default {
  QUERY_MAP: {
    "Highest Cost Locations": "HighestCostLocations",
    "Charges by Vendor": "ChargesByVendor",
    "Costs by Utility Type": "CostsbyUtilityType",
    "Costs by Charge Type": "CostsbyChargeType",
    "Monthly Cost by Location": "MonthlyCostbyLocation",
    "Highest Unit Cost Locations": "HighestUnitCostLocations",
    "Highest Consumption Locations": "HighestConsumptionLocations",
    "Monthly Consumption by Location": "MonthlyConsumptionbyLocation",
  },

  runAll() {
		setTimeout(() => {
			const widget = getWidget.data?.[0] || {};

			const queryName = this.QUERY_MAP[widget.name];
			if (!queryName) {
				return console.warn("Missing query:", widget.name);
			}

			// Extract filters
			const params = this.extractFilters(widget.payload);
			console.log("Executing:", queryName, params);

			// Run the mapped query function
			const queryFn = appsmith.store?.queries?.[queryName] || eval(queryName);
			if (queryFn?.run) {
				queryFn.run(params);
			} else {
				console.warn("Query function not found for:", queryName);
			}
		},2000);
  },

  extractFilters(payload) {
    const filters = {
      customer_id: appsmith.store.selectedCustomerId || null,
      utility_type: null,
      utility_type_list: [],
      location_ids: [],
      date_start: null,
      date_end: null,
      year: null,
      time_type: "all",
    };

    if (!payload?.filters) return filters;

    payload.filters.forEach(f => {
      switch (f.filter) {
        case "utility_type":
          filters.utility_type = f.utility_type?.utility_type || null;
          break;

        case "utility_type_list":
          filters.utility_type_list = f.utility_type_list?.list || [];
          break;

        case "location_id":
          filters.location_ids = f.location_id?.location_ids || [];
          break;

        case "year":
          filters.year = f.year?.year || null;
          this.applyYearFilter(filters, f.year);
          break;

        case "time_period":
          if (!f.time_period) break;
          this.applyTimePeriod(filters, f.time_period);
          break;
      }
    });

    return filters;
  },

  applyYearFilter(filters, yearObj) {
    const year = yearObj?.year;
    if (!year) return;

    filters.time_type = "year";
    filters.date_start = `${year}-01-01`;
    filters.date_end = `${year}-12-31`;
  },

  applyTimePeriod(filters, tp) {
    const type = tp?.type || "all";
    filters.time_type = type;

    if (type === "year_to_date") {
      filters.date_start = moment().startOf("year").format("YYYY-MM-DD");
      filters.date_end = moment().format("YYYY-MM-DD");
    } else if (type === "custom") {
      filters.date_start = tp.start_date;
      filters.date_end = tp.end_date;
    } else if (type === "last_x_months") {
      const months = tp.months || 6;
      filters.date_start = moment().subtract(months, "months").startOf("month").format("YYYY-MM-DD");
      filters.date_end = moment().format("YYYY-MM-DD");
    } else if (type === "period") {
      filters.date_start = tp.period?.start_date || null;
      filters.date_end = tp.period?.end_date || null;
    } else if (type === "all") {
      filters.date_start = null;
      filters.date_end = null;
    }
  },
};
