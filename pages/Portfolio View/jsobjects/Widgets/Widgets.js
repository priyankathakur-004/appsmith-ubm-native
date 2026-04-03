export default {
  // Original report mapping
  widgetOptions: {
    "Highest Cost Locations": "HighestCostLocations",
    "Charges by Vendor": "ChargesByVendor",
    "Costs by Utility Type": "CostsbyUtilityType",
    "Costs by Charge Type": "CostsbyChargeType",
    "Monthly Cost by Location": "MonthlyCostbyLocation",
    "Highest Unit Cost Locations": "HighestUnitCostLocations",
    "Highest Consumption Locations": "HighestConsumptionLocations",
    "Monthly Consumption by Location": "MonthlyConsumptionbyLocation"
  },

  // Function to get array suitable for Select widget
  getWidgetArray: function() {
    return Object.keys(this.widgetOptions).map(key => ({
      label: key,
      value: this.widgetOptions[key]
    }));
  }
};
