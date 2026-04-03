export default {
	async loadUserActivityData(userId=false) {
		try {
			if (!userId) {
				userId = appsmith.store.lastUserId;
				if (!userId) {
					showAlert("No user selected to load activity data", "warning");
					return { total_count: 0, rows: [] };
				}
			} else {
				// Store the current userId for future use
				storeValue("lastUserId", userId);
			}
			// Run count query
			const countRes = await getUserActivityDataCount.run({
				user_id: userId
			});

			// Run rows query
			const rowsRes = await getUserActivityData.run({
				user_id: userId
			});

			// Merge result
			const mergedData = {
				total_count: countRes?.[0]?.total_count || 0,
				rows: rowsRes || []
			};

			showModal(userActivityModal.name);

			return mergedData;
		} catch (error) {
			showAlert("Failed to load user activity data", "error");
			throw error;
		}
	},

};
