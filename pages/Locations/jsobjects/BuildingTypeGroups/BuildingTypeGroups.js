export default {
  groups: {
    "": [""],
    "ACUTE": ["ACUTE"],
    "ADMIN OFFICE": ["ADMIN OFFICE"],
    "AUCTIONS": [
      "AUCTIONS",
      "AUCTIONS - AUCTIONS",
      "AUCTIONS _ AUCTIONS",
      "AUCTIONS - AUCTIONS, MAIN ADDRESS",
      "AUCTIONS _ AUCTIONS, MAIN ADDRESS",
      "AUCTIONS - AUCTIONS, MAIN ADDRESS, VEHICLE STORAGE",
      "AUCTIONS _ AUCTIONS, MAIN ADDRESS, VEHICLE STORAGE",
      "AUCTIONS - PARKING",
      "AUCTIONS _ PARKING",
      "AUCTIONS - STORAGE, PARKING",
      "AUCTIONS _ STORAGE, PARKING",
      "AUCTIONS - VEHICLE STORAGE",
      "AUCTIONS _ VEHICLE STORAGE"
    ],
    "BUILDING": ["BUILDING", "Building"],
    "CAMPUS": ["CAMPUS", "Campus"],
    "OFFICE": ["OFFICE", "OFFICE - OFFICE", "OFFICE _ OFFICE"],
    "PARKING": [
      "PARKING - PARKING",
      "PARKING _ PARKING",
      "PARKING - STORAGE",
      "PARKING _ STORAGE",
      "PARKING - VEHICLE STORAGE",
      "PARKING _ VEHICLE STORAGE",
      "PARKING - VEHICLE STORAGE, PARKING",
      "PARKING _ VEHICLE STORAGE, PARKING"
    ],
    "WAREHOUSE - AUTOMOBILE BODY & REPAIR": [
      "WAREHOUSE - AUTOMOBILE BODY & REPAIR",
      "WAREHOUSE _ AUTOMOBILE BODY AND REPAIR"
    ],
  },

  getDropdownOptions() {
    const opts = Object.keys(this.groups).map(k => ({
      label: k || "All",
      value: k
    }));
    return opts;
  },

  // Helper: flatten all selected group values into one array for SQL
  getSelectedValues(selectedGroups) {
    if (!selectedGroups || selectedGroups.length === 0) return [];
    const allValues = selectedGroups.flatMap(g => this.groups[g] || []);
    return [...new Set(allValues)]; // remove duplicates
  }
};
