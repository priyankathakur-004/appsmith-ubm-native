export default {
	// Runs on page load so every table and dropdown populates. Appsmith's
	// on-load inference misses custom-widget defaultModel dependencies, so we
	// run the queries explicitly (this function is flagged run-on-load).
	initPage() {
		getCustomers.run();
		getBuildingTypes.run();
		getCities.run();
		getStates.run();
		getTotalLocations.run();
		getLocationLists.run();
		// the hierarchy tree + accounts load when the Hierarchies tab is opened (see that tab's onTabSelected), not on page load
	}
}
