export default {
	// Read-only Vendors admin. List (server-paginated + searchable) + detail drill-in.
	// Store-reader pattern: handlers .run() queries and stash results in appsmith.store;
	// getters read ONLY the store (never a query's .data) to avoid the reactive-
	// dependency-misuse error. The list TABLE reads the query .data directly (not here).

	// Run on page load (metadata is AUTOMATIC/userSetOnLoad) — reset to the list screen
	// and clear any detail carried over from a previous session.
	async initPage() {
		await storeValue("v_screen", 1);
		await storeValue("v_detail_id", 0);
		await storeValue("v_detail_rows", []);
	},

	// Re-run the list + count for the current filters, resetting the table to page 1
	// (resetWidget clears pageNo/searchText/selection so the new result starts clean).
	async applyFilters() {
		await resetWidget("V_table", true);
		await V_countVendors.run();
		await V_fetchVendors.run();
	},

	// Clear the search box, the provider filter and the blank-only toggle, then refetch.
	async clearFilters() {
		await resetWidget("V_SearchInput", true);
		await resetWidget("V_ProviderInput", true);
		await resetWidget("V_BlankToggle", true);
		await resetWidget("V_table", true);
		await V_countVendors.run();
		await V_fetchVendors.run();
	},

	// Row click -> load the vendor's provider mappings and switch to the detail screen.
	async openDetail(vendorId) {
		if (vendorId == null) return;
		await storeValue("v_detail_id", vendorId);
		const res = await V_fetchVendorDetail.run();
		await storeValue("v_detail_rows", Array.isArray(res) ? res : []);
		await storeValue("v_screen", 2);
	},

	goBack() {
		return storeValue("v_screen", 1);
	},

	// --- store readers for the detail custom widget ---
	detailHeader() {
		const rows = appsmith.store.v_detail_rows;
		const r = (Array.isArray(rows) ? rows : [])[0];
		return r ? { id: r.id, code: r.code, pretty_name: r.pretty_name || "" } : {};
	},

	detailProviders() {
		const rows = Array.isArray(appsmith.store.v_detail_rows) ? appsmith.store.v_detail_rows : [];
		// A vendor with no providers_vendors row still returns one all-null LEFT JOIN row;
		// keep only rows that actually carry a provider mapping.
		return rows.filter(r => r && (r.provider || r.provider_id || r.pv_code || r.pv_name)).map(r => ({
			provider: r.provider || "",
			provider_id: (r.provider_id == null) ? "" : r.provider_id,
			name: r.pv_name || "",
			code: r.pv_code || "",
			remittance_name: r.remittance_name || "",
			remittance_address: r.remittance_address || "",
			main_phone: r.main_phone || "",
			custsvc_phone: r.custsvc_phone || "",
			web_address: r.web_address || "",
			priority_phone: r.priority_phone || "",
			emergency_phone: r.emergency_phone || ""
		}));
	}
}
