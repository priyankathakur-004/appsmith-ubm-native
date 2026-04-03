export default {
	// Called when dropdown value changes
	async onBuildingTypeChange() {
		await getLocationLists.run();
	},

	// Builds the WHERE condition dynamically
	buildBuildingTypeCondition() {
		const selected = (buildingTypeFilter.selectedOptionValues || []).join(',')
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
		selected

		// If nothing selected, return TRUE so all rows appear
		if (selected.length === 0) return "TRUE";

		return selected.map(v => `'${v.replace(/'/g,"''")}'`).join(", ");
		const upperValues = selected.map(v => v.toUpperCase());

		return `UPPER(lt.building_type) = ANY($1)`;
		// Quote and escape values properly
		const values = selected.map(v => `'${v.replace(/'/g, "''")}'`).join(", ");

		// Build case-insensitive SQL
		return `lt.building_type IN (${values})`;
	}
};
