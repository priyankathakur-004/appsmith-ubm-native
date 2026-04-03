export default {
  buildFilterSQL() {
    let filters = [];

    // Main customer filter
    filters.push(`l.customer_id = ${CustomerSelect.selectedOptionValue}`);

    // Search filter
    if (SearchInput.text) {
      const s = SearchInput.text.replace(/'/g, "''");
      filters.push(`(
        lt.location_description ILIKE '%${s}%' OR
        lt.building_type ILIKE '%${s}%' OR
        lt.location_city ILIKE '%${s}%' OR
        lt.location_address ILIKE '%${s}%' OR
        lt.location_state ILIKE '%${s}%' OR
        lt.location_postcode ILIKE '%${s}%'
      )`);
    }

    // Building type multi-select filter
    if (buildingTypeFilter.selectedOptionValues.length > 0) {
      const types = buildingTypeFilter.selectedOptionValues
        .map(v => `'${v.replace(/'/g, "''")}'`)
        .join(",");
      filters.push(`lt.building_type IN (${types})`);
    }

    // Combine all filters
    return filters.length ? "WHERE " + filters.join(" AND ") : "";
  }
}
