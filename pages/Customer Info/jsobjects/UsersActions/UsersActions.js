export default {
	// Row-ID click handler for the Users custom widget. The widget calls
	// updateModel({selectedUserId,...}) then fires onUserOpen -> this method.
	// Awaiting each step (store first, then the queries) guarantees the detail
	// queries run with the correct id before the modal opens — otherwise the
	// model value hasn't propagated yet and the detail comes back empty.
	async openUser() {
		const id = UsersTable.model.selectedUserId;
		if (!id) return;
		await storeValue("selectedUserId", id);
		await fetch_user_detail.run();
		await fetch_user_customers.run();
		showModal("UserDetailModal");
	}
}
