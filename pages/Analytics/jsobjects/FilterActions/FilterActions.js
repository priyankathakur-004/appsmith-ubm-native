export default {
		getDates() {
				const currentYear = new Date().getFullYear();
				const startYear = 1990;

				const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

				let data = [];

				for (let year = currentYear; year >= startYear; year--) {

					let children = [];

					for (let m = 11; m >= 0; m--) {
						children.push({
							label: months[m],
							value: `${year}-${String(m+1).padStart(2,'0')}-01`
						});
					}

					data.push({
						label: year.toString(),
						value: year.toString(),
						children: children
					});
				}

				return data;
		},

    setView(viewName) {
        storeValue('activeView', viewName);
    },

    async applyFilters() {
        await fetch_analytics_data.run();
        await fetch_demand_loadfactor.run();
    },

    async loadSavedView() {
        const saved = appsmith.store.savedAnalyticsView;
        if (saved) {
            try {
                const state = JSON.parse(saved);
                if (state.view) storeValue('activeView', state.view);
                showAlert('Saved view loaded', 'success');
            } catch(e) {
                showAlert('No saved view found', 'warning');
            }
        } else {
            showAlert('No saved view found', 'warning');
        }
    },

    async onLocationAttrChange() {
        await fetch_attribute_values.run();
    },
	
	 async OnCustomerChange() {
		 	fetch_utility_types.run();
			fetch_locations.run();
		 	fetch_bill_types.run()
		 	fetch_location_attributes.run();
		 	this.applyFilters();
	 }
}