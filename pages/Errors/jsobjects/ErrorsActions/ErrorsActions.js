export default {
	// Runs on page load (this function is flagged run-on-load) so every table and
	// filter dropdown populates without relying on Appsmith's on-load inference.
	initPage() {
		getCustomers.run();
		fetch_error_types.run();
		fetch_comm_statuses.run();
		fetch_comm_types.run();
		fetch_comm_modules.run();
		fetch_comm_emails.run();
		fetch_payment_errors.run();
		fetch_comm_errors.run();
		fetch_validation_codes.run();
		fetch_validation_by_customer.run();
		fetch_val_vendors.run();
		fetch_val_locations.run();
	},

	// --- Payments Error Log ---
	clearFilters() {
		resetWidget("CustomerSelect", true);
		resetWidget("ErrorTypeSelect", true);
		resetWidget("PayDateFrom", true);
		resetWidget("PayDateTo", true);
		resetWidget("CreateDateFrom", true);
		resetWidget("CreateDateTo", true);
		fetch_payment_errors.run();
	},

	downloadCsv() {
		this._csv(fetch_payment_errors.data || [], [
			["payment_date", "Payment Date"], ["creation_date", "Creation Date"],
			["customer", "Customer"], ["days_on_error_log", "Days on Error Log"],
			["format", "Format"], ["event", "Event"], ["type", "Type"],
			["bill_id", "Bill ID"], ["description", "Description"]
		], "payment_error_log.csv");
	},

	// --- Communication Error Log ---
	clearCommFilters() {
		resetWidget("CommCustomer", true);
		resetWidget("CommStatus", true);
		resetWidget("CommType", true);
		resetWidget("CommModule", true);
		resetWidget("CommEmail", true);
		resetWidget("CommInitDate", true);
		resetWidget("CommChangeDate", true);
		fetch_comm_errors.run();
	},

	downloadCommCsv() {
		this._csv(fetch_comm_errors.data || [], [
			["initial_creation_date", "Initial Creation Date"], ["status", "Status"],
			["type", "Type"], ["status_change_date", "Status Change Date"],
			["customer", "Customer"], ["module", "Module"], ["email_address", "Email Address"]
		], "communication_error_log.csv");
	},

	// --- Bill Errors (validation codes) ---
	// Awaited, not fired and forgotten: the queries below read these widgets, so
	// re-running before the resets land would just reload the filters being cleared.
	async clearValFilters() {
		await Promise.all([
			resetWidget("ValCustomer", true),
			resetWidget("ValDateFrom", true),
			resetWidget("ValDateTo", true),
			resetWidget("ValStage", true),
			resetWidget("ValSeverity", true),
			resetWidget("ValCategory", true),
			resetWidget("ValSearch", true),
			resetWidget("ValVendor", true),
			resetWidget("ValLocation", true),
			resetWidget("ValAccount", true)
		]);
		// The customer and stage selects read their default from the store, so
		// resetting the widgets alone would just restore the last chart click.
		await storeValue("valCustomerPick", "");
		await storeValue("valStagePick", "");
		// The customer is cleared too, so the lists scoped to it have to reload.
		await fetch_val_vendors.run();
		await fetch_val_locations.run();
		fetch_validation_codes.run();
		fetch_validation_by_customer.run();
	},

	// Vendor and location belong to a customer, so changing the customer makes
	// any existing choice meaningless. Clear them, restock their option lists, then
	// reload the catalogue.
	async valCustomerChanged() {
		resetWidget("ValVendor", true);
		resetWidget("ValLocation", true);
		await fetch_val_vendors.run();
		await fetch_val_locations.run();
		fetch_validation_codes.run();
		fetch_validation_by_customer.run();
	},

	// --- Drill: customer -> error type -> error code -> bills ---
	// A chart click reports the clicked label. These resolve it to an id through
	// ValCharts (which only reads) and then drive the existing filters, so the
	// summary narrows the same table and modal that were already there.

	// Clicking a customer bar scopes the whole tab to that customer. The select
	// reads its default from the store, which is how its value gets set from here.
	async valPickCustomer() {
		const p = (typeof ValCustomerChart !== 'undefined' && ValCustomerChart.selectedDataPoint) || {};
		// A horizontal bar reports the category on whichever axis carries it, so
		// take whichever of the two came back as text.
		const label = (typeof p.x === 'string' && p.x) || (typeof p.y === 'string' && p.y) || '';
		const id = ValCharts.customerIdFor(label);
		if (id == null) return;
		await storeValue("valCustomerPick", id);
		await resetWidget("ValVendor", true);
		await resetWidget("ValLocation", true);
		await fetch_val_vendors.run();
		await fetch_val_locations.run();
		fetch_validation_codes.run();
		fetch_validation_by_customer.run();
	},

	// Clicking a stage tile narrows to that step of the pipeline. Both charts and
	// the table read the stage filter, so nothing needs reloading - it is applied
	// in the browser over rows already here.
	async valPickStage(stage) {
		const cur = appsmith.store.valStagePick || "";
		// Clicking the selected tile again clears it, so the tiles toggle.
		await storeValue("valStagePick", (stage && stage !== cur) ? stage : "");
	},

	// Clicking a code bar opens the bills behind it - the existing drill, reached
	// from the summary instead of from the table.
	async valPickCode() {
		const p = (typeof ValCodesChart !== 'undefined' && ValCodesChart.selectedDataPoint) || {};
		const label = (typeof p.x === 'string' && p.x) || (typeof p.y === 'string' && p.y) || '';
		const hit = ValCharts.codeFor(label);
		if (!hit) return;
		await this.valShowBills(hit.code, hit.category, hit.name);
	},

	// Row link on the catalogue: stash which check was clicked, load its bills,
	// then open the modal. The code alone is not a key - the same number means
	// different checks under different categories - so both are stored.
	async valShowBills(code, category, name) {
		// Fall back to the row object if the scalars did not come through, and say so
		// rather than returning quietly - a dead link that reports nothing is worse
		// than one that explains itself.
		let c = code, cat = category, nm = name;
		if (c == null || c === "") {
			const row = (typeof ValCodesTable !== 'undefined' && ValCodesTable.model
			             && ValCodesTable.model.selectedRow) || null;
			if (row) { c = row["Code"]; cat = row["Category"]; nm = row["Check"]; }
		}
		if (c == null || c === "") {
			showAlert("Could not read the selected code from the table.", "warning");
			return;
		}
		await storeValue("valCode", c);
		await storeValue("valCategory", cat || "");
		await storeValue("valName", nm || "");
		// A fresh code starts at page one with no leftover status or search.
		await storeValue("valBillPageNo", 1);
		await storeValue("valBillStatus", "all");
		await storeValue("valBillSearch", "");
		// Open the modal BEFORE running the query. Awaiting the query first meant any
		// failure in it threw out of this function before showModal was ever reached,
		// so a broken query and a broken link looked identical: nothing happened.
		showModal("ValDetailModal");
		try {
			await fetch_validation_bills.run();
		} catch (e) {
			// An error object stringifies to [object Object], which says nothing.
			const msg = (e && (e.message || (e.responseMeta && e.responseMeta.error
			             && e.responseMeta.error.message))) || JSON.stringify(e);
			showAlert("Could not load bills for code " + c + ": " + msg, "error");
		}
	},

	// Paging is server-side, so each step is one page of rows rather than a
	// thousand-row fetch the browser then slices.
	async valBillsPage(delta) {
		const cur = Number(appsmith.store.valBillPageNo) || 1;
		const next = Math.max(1, cur + (Number(delta) || 0));
		if (next === cur) return;
		await storeValue("valBillPageNo", next);
		fetch_validation_bills.run();
	},

	// Status and search live in SQL now: filtering in the browser would only ever
	// filter the page on screen. The widget stages its values on its own model
	// first, because triggerEvent cannot carry arguments.
	async valBillsFilter() {
		const m = (typeof ValDetailBody !== 'undefined' && ValDetailBody.model) || {};
		await storeValue("valBillStatus", m.pendingStatus || "all");
		await storeValue("valBillSearch", m.pendingSearch || "");
		await storeValue("valBillPageNo", 1);
		fetch_validation_bills.run();
	},

	downloadValCsv() {
		this._csv(fetch_validation_codes.data || [], [
			["Code", "Code"], ["Category", "Category"], ["Check", "Check"],
			["Stage", "Stage"], ["Severity", "Severity"],
			["Occurrences", "Occurrences"], ["Bills Affected", "Bills Affected"],
			["Open", "Open"], ["Resolved", "Resolved"], ["Resolved %", "Resolved %"],
			["Resolvable", "Resolvable"], ["Last Seen", "Last Seen"]
		], "bill_validation_codes.csv");
	},

	// "More Details" row link: load the full row, then open the detail modal.
	// The custom table already did updateModel({selectedRow}) before firing this,
	// so fetch_comm_detail's WHERE reads CommTable.model.selectedRow.id.
	async commDetails(row) {
		if (!row || row.id == null) return;
		await fetch_comm_detail.run();
		showModal("CommDetailModal");
	},

	// shared CSV builder
	_csv(rows, cols, fname) {
		const esc = (v) => '"' + (v == null ? "" : String(v)).split('"').join('""') + '"';
		const header = cols.map(c => esc(c[1])).join(",");
		const lines = rows.map(r => cols.map(c => esc(r[c[0]])).join(","));
		download([header].concat(lines).join("\n"), fname, "text/csv");
	}
}
