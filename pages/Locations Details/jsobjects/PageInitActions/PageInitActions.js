export default {
	// Runs on page load so every table and dropdown populates. Appsmith's
	// on-load inference misses custom-widget defaultModel dependencies, so we
	// run the queries explicitly (this function is flagged run-on-load).
	initPage() {
		getVirtualAccounts.run();
		getTotalVirtualAccounts.run();
		fetch_location_metrics.run();
		getLocationAttributes.run();
		getBillingAccounts.run();
		fetch_monthly_view.run();
	}
}
