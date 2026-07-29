export default {
	// Runs on page load (this function is flagged run-on-load) so the customer
	// dropdown and every tab (Customer / Users / Groups) populate without relying
	// on Appsmith's on-load inference, which doesn't fire the AUTOMATIC queries
	// when only custom-widget / Text-HTML models consume them. Mirrors the
	// CustomerSelect.onOptionChange fetch set (the modal queries — fetch_user_*
	// — stay MANUAL and run from openUser).
	initPage() {
		getCustomers.run();
		fetch_customer_detail.run();
		fetch_customer_contract.run();
		fetch_customer_audit.run();
		fetch_customer_users.run();
		fetch_customer_groups.run();
	},

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
