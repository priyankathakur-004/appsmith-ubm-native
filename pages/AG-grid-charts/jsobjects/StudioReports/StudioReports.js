export default {
	// The customer the page opens on when none has been picked; the data query
	// falls back to the same id.
	defaultCustomer: 76013,

	// Largest report layout, in characters of JSON, that may be saved. The
	// widget checks it before sending; a layout of a dozen charts is a few tens
	// of KB, so this only stops something runaway reaching the SQL text.
	maxStateChars: 1000000,

	// ---- saved reports (ubm_app.ag_studio_saved_reports on UBM_Appsmith_DB) --
	// A report keeps the AG Studio layout (pages, widgets, filters), never the
	// rows: opening one rebuilds it on the customer's current monthly usage.
	// Reports are shared by everyone who views the customer. Store keys, none
	// persisted except agReportLast:
	//   agReports        the picked customer's list, without layouts
	//   agReportCurrent  the open report, or null for an unsaved one
	//   agReportBusy     what is in progress, shown in the widget toolbar
	//   agStudioReport   the layout the widget builds from
	//   agReportLast     {cust, id} of the report to reopen on the next visit
	//   agAskSources     Ask UBM charts in the layout: {key, question, title, sql, rows}
	//   agSuggestedName  name offered by Save for a chart opened from Ask UBM
	//   agImport         (persisted, set by the Ask UBM page) a chart to open here

	// ---- Ask UBM charts ---------------------------------------------------------
	// "Open in AG Studio" on the Ask UBM page hands over one answer (question,
	// SQL, chart settings and rows) through agImport and navigates here. The
	// answer becomes its own Studio source, ask_<key>, drawn the way Ask UBM drew
	// it. A saved report keeps each such chart's SQL (never its rows) in
	// ask_sources and re-runs it when the report opens, so it shows current data
	// like the rest of the page. The query that re-runs it is a copy of the Ask
	// UBM page's AI query (Appsmith queries belong to one page), and _askTables
	// lists that page's AI tables for the same SQL check: when the Ask UBM
	// tables change, change both copies.

	// Run once by the on-mount init widget, because Appsmith does not run
	// on-load queries that only a custom widget's model consumes.
	async initPage() {
		// The earlier browser-only "Save view" persisted a layout under this key;
		// clear it so the page never builds from a stale copy.
		await storeValue('agStudioReport', null);
		await storeValue('agReports', [], false);
		await storeValue('agReportCurrent', null, false);
		await storeValue('agReportBusy', '', false);
		await storeValue('agAskSources', [], false);
		await storeValue('agSuggestedName', '', false);
		getCustomers.run();
		fetch_studio_data.run();
		fetch_studio_demand.run();
		const list = await this.loadList();
		// A chart sent from Ask UBM wins over reopening a report. It is taken once,
		// and only if it is recent and for the customer now shown.
		const imp = appsmith.store.agImport;
		if (imp) await storeValue('agImport', null);
		if (imp && Number(imp.cust) === this._cust() && Date.now() - Number(imp.at || 0) < 10 * 60 * 1000) {
			await this.importAsk(imp);
			return;
		}
		// Reopen the report this browser had open last; failing that, the
		// customer's most recently saved one (the list comes newest first), so
		// the page only starts blank when the customer has no saved reports.
		const last = appsmith.store.agReportLast || {};
		const lastId = Number(last.cust) === this._cust() && list.some(r => r.id === String(last.id)) ? String(last.id) : '';
		const pick = lastId || (list[0] ? list[0].id : '');
		if (pick) await this.openReport(pick);
	},

	// The Customer dropdown's change handler. Reports belong to one customer,
	// so the open one is closed and the workspace starts blank.
	async pickCustomer(picked) {
		await storeValue('selectedCustomerId', Number(picked) || this.defaultCustomer);
		await this.newReport();
		fetch_studio_data.run();
		fetch_studio_demand.run();
		await this.loadList();
	},

	async loadList() {
		const cust = this._cust();
		try {
			const rows = await ag_saved_list.run({ cust });
			if (this._cust() !== cust) return [];
			const list = (Array.isArray(rows) ? rows : []).map(r => this._fromRow(r));
			await storeValue('agReports', list, false);
			return list;
		} catch (e) {
			await storeValue('agReports', [], false);
			showAlert('Could not load the saved reports. ' + this._friendly(e), 'error');
			return [];
		}
	},

	// Loads the layout and rebuilds the widget with it, on the rows already
	// fetched for this customer.
	async openReport(id) {
		const cust = this._cust();
		const key = String(id || '');
		if (!key || appsmith.store.agReportBusy) return;
		await storeValue('agReportBusy', 'Opening…', false);
		try {
			const rows = await ag_saved_get.run({ id: Number(key) || 0, cust });
			const row = (rows || [])[0];
			if (!row) {
				showAlert('That report is no longer saved. Someone may have removed it.', 'warning');
				await this.loadList();
				return;
			}
			const state = this._parse(row.state);
			if (!state || !Array.isArray(state.pages)) {
				showAlert('That report could not be read.', 'error');
				return;
			}
			if (this._cust() !== cust) return;
			// Ask UBM charts first, so the layout is built with their fields present.
			const ask = await this._loadAsk(this._parse(row.ask_sources), cust);
			if (this._cust() !== cust) return;
			await storeValue('agAskSources', ask, false);
			await storeValue('agSuggestedName', '', false);
			await storeValue('agStudioReport', state, false);
			await storeValue('agReportCurrent', this._fromRow(row), false);
			await storeValue('agReportLast', { cust, id: key });
			await storeValue('agStudioStateKey', Date.now(), false);
			// The list is otherwise only reloaded by this browser's own changes, so
			// its "saved by" lines go stale when a colleague saves.
			await this.loadList();
		} catch (e) {
			showAlert('Could not open the report. ' + this._friendly(e), 'error');
		} finally {
			await storeValue('agReportBusy', '', false);
		}
	},

	// From the widget. mode 'save' writes over the open report; 'saveAs', or
	// 'save' with nothing open, adds a new one under the given name.
	async saveReport(mode, name, state, cust) {
		if (appsmith.store.agReportBusy) return;
		const c = this._cust();
		if (Number(cust) && Number(cust) !== c) {
			showAlert('The customer changed while saving. Pick the customer again and retry.', 'warning');
			return;
		}
		const clean = this._parse(state);
		if (!clean || !Array.isArray(clean.pages)) {
			showAlert('Nothing to save yet. Add a chart or table first.', 'warning');
			return;
		}
		if (JSON.stringify(clean).length > this.maxStateChars) {
			showAlert('This layout is too large to save. Remove some widgets or pages and retry.', 'error');
			return;
		}
		const current = appsmith.store.agReportCurrent;
		const asNew = mode === 'saveAs' || !current || !current.id;
		const title = String(name || '').trim();
		if (asNew) {
			const problem = this._checkName(title, '');
			if (problem) { showAlert(problem, 'warning'); return; }
		}
		const by = appsmith.user.email || 'unknown';
		await storeValue('agReportBusy', 'Saving…', false);
		try {
			if (asNew) {
				const added = await ag_saved_add.run({ payload: this._payload({ cust: c, name: title, state: clean, ask: this._askFor(clean), by }) });
				const row = (added || [])[0];
				if (!row) {
					// The unique index turned it away: someone saved that name meanwhile.
					await this.loadList();
					showAlert('A report called "' + title + '" already exists for this customer. Pick another name.', 'warning');
					return;
				}
				await this._remember(row, clean, c);
				showAlert('Saved "' + row.name + '"', 'success');
			} else {
				const updated = await ag_saved_update.run({ payload: this._payload({
					id: Number(current.id), cust: c, state: clean, ask: this._askFor(clean), seen: current.version, by
				}) });
				const row = (updated || [])[0];
				if (!row) {
					// Removed, or saved by someone else since it was opened here.
					const list = await this.loadList();
					const now = list.find(r => r.id === String(current.id));
					if (!now) {
						await storeValue('agReportCurrent', null, false);
						await storeValue('agReportLast', null);
						showAlert('"' + current.name + '" was removed by someone else. Use Save as to keep this layout as a new report.', 'warning');
						return;
					}
					// Taking their version as seen means pressing Save again overwrites it.
					await storeValue('agReportCurrent', now, false);
					showAlert(now.updatedBy + ' saved "' + now.name + '" after you opened it. Press Save again to replace their version with yours, or Save as to keep both.', 'warning');
					return;
				}
				await this._remember(row, clean, c);
				showAlert('Saved "' + row.name + '"', 'success');
			}
			await this.loadList();
		} catch (e) {
			showAlert('Could not save the report. ' + this._friendly(e), 'error');
		} finally {
			await storeValue('agReportBusy', '', false);
		}
	},

	async renameReport(id, name) {
		if (appsmith.store.agReportBusy) return;
		const cust = this._cust();
		const key = String(id || '');
		const title = String(name || '').trim();
		const problem = this._checkName(title, key);
		if (!key || problem) { if (problem) showAlert(problem, 'warning'); return; }
		await storeValue('agReportBusy', 'Renaming…', false);
		try {
			const updated = await ag_saved_update.run({ payload: this._payload({
				id: Number(key), cust, name: title, by: appsmith.user.email || 'unknown'
			}) });
			const row = (updated || [])[0];
			if (!row) {
				showAlert('That report is no longer saved. Someone may have removed it.', 'warning');
			} else {
				const current = appsmith.store.agReportCurrent;
				if (current && current.id === key) await storeValue('agReportCurrent', this._fromRow(row), false);
				showAlert('Renamed to "' + row.name + '"', 'success');
			}
			await this.loadList();
		} catch (e) {
			showAlert('Could not rename the report. ' + this._friendly(e), 'error');
		} finally {
			await storeValue('agReportBusy', '', false);
		}
	},

	// Soft remove: the row stays in the table with deleted_at set. If it was
	// open, its layout stays on screen as an unsaved report.
	async removeReport(id) {
		if (appsmith.store.agReportBusy) return;
		const cust = this._cust();
		const key = String(id || '');
		if (!key) return;
		await storeValue('agReportBusy', 'Removing…', false);
		try {
			const removed = await ag_saved_remove.run({ payload: this._payload({
				id: Number(key), cust, by: appsmith.user.email || 'unknown'
			}) });
			const current = appsmith.store.agReportCurrent;
			if (current && current.id === key) {
				await storeValue('agReportCurrent', null, false);
				await storeValue('agReportLast', null);
			}
			const row = (removed || [])[0];
			showAlert(row ? 'Removed "' + row.name + '"' : 'That report was already removed.', row ? 'success' : 'info');
			await this.loadList();
		} catch (e) {
			showAlert('Could not remove the report. ' + this._friendly(e), 'error');
		} finally {
			await storeValue('agReportBusy', '', false);
		}
	},

	// Closes the open report and clears the workspace.
	async newReport() {
		await storeValue('agAskSources', [], false);
		await storeValue('agSuggestedName', '', false);
		await storeValue('agReportCurrent', null, false);
		await storeValue('agReportLast', null);
		await storeValue('agStudioReport', null, false);
		await storeValue('agStudioStateKey', Date.now(), false);
	},

	// Opens one Ask UBM answer as a new, unsaved report, using the rows it
	// arrived with (the SQL is only re-run when a saved report opens).
	async importAsk(imp) {
		const title = String((imp.chart && imp.chart.title) || imp.question || 'Ask UBM chart').slice(0, 120);
		const src = {
			key: Date.now().toString(36),
			question: String(imp.question || ''),
			title,
			sql: String(imp.sql || ''),
			rows: Array.isArray(imp.rows) ? imp.rows : []
		};
		if (!src.sql || !src.rows.length) {
			showAlert('That Ask UBM answer has no rows to open.', 'warning');
			return;
		}
		try {
			this._checkAskSql(src.sql);
		} catch (e) {
			showAlert('That Ask UBM answer cannot be opened here: ' + e.message, 'warning');
			return;
		}
		await storeValue('agAskSources', [src], false);
		await storeValue('agSuggestedName', title, false);
		await storeValue('agReportCurrent', null, false);
		await storeValue('agStudioReport', this._askLayout(src, imp.chart, imp.columns), false);
		await storeValue('agStudioStateKey', Date.now(), false);
		showAlert('Opened "' + title + '" from Ask UBM. Save it to keep it with this customer\'s reports.', 'info');
	},

	// One widget drawn as Ask UBM drew it: bar becomes a grouped column chart,
	// line a line chart, series the legend; an answer with no chart a grid.
	_askLayout(src, chart, columns) {
		const id = 'ask_' + src.key;
		const f = c => ({ id: id + '.' + c });
		const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(src.rows[0] || {});
		let widget;
		if (chart && chart.x && Array.isArray(chart.y) && chart.y.length) {
			const m = { categoryKey: [f(chart.x)], valueKey: chart.y.map(y => ({ id: id + '.' + y, aggregation: 'sum' })) };
			if (chart.series) m.legendKey = [f(chart.series)];
			widget = { type: chart.type === 'line' ? 'line-chart' : 'column-chart-grouped', dataMapping: m };
		} else {
			widget = { type: 'grid', dataMapping: { cols: cols.map(f) } };
		}
		widget.format = { title: { text: src.title, enabled: true } };
		return {
			selectedPageId: 'page-1',
			pages: [{ id: 'page-1', widgets: { [id]: widget }, widgetLayout: { [id]: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 22 } } }]
		};
	},

	// The Ask UBM charts a layout still uses, without their rows, for saving.
	_askFor(state) {
		const text = JSON.stringify(state);
		return (appsmith.store.agAskSources || [])
			.filter(a => text.includes('"ask_' + a.key + '.'))
			.map(a => ({ key: a.key, question: a.question, title: a.title, sql: a.sql }));
	},

	// Re-runs each saved Ask UBM chart's SQL for the customer, one at a time.
	// A chart that fails keeps its place with no rows and is reported.
	async _loadAsk(list, cust) {
		const out = [];
		const failed = [];
		for (const a of Array.isArray(list) ? list : []) {
			const src = { key: String(a.key || ''), question: String(a.question || ''), title: String(a.title || ''), sql: String(a.sql || ''), rows: [] };
			if (!src.key || !src.sql) continue;
			try {
				this._checkAskSql(src.sql);
				const rows = await ask_rows.run({ sql: src.sql, cust });
				src.rows = Array.isArray(rows) ? rows : [];
				if (!src.rows.length) failed.push('"' + (src.title || src.question) + '" has no data now');
			} catch (e) {
				failed.push('"' + (src.title || src.question) + '": ' + this._friendly(e));
			}
			out.push(src);
		}
		if (failed.length) {
			showAlert('Some Ask UBM charts in this report could not load (' + failed.join('; ') + '). Saving now would drop them.', 'warning');
		}
		return out;
	},

	// The same check the Ask UBM page applies before running AI-written SQL.
	_checkAskSql(sql) {
		const s = String(sql || '').toLowerCase();
		if (!/^[(\s]*(select|with)\b/.test(s)) throw new Error('not a SELECT query.');
		let depth = 0;
		for (const ch of s.replace(/'[^']*'/g, '')) {
			if (ch === '(') depth++;
			else if (ch === ')' && --depth < 0) break;
		}
		if (depth !== 0) throw new Error('unbalanced brackets.');
		if (s.includes(';')) throw new Error('only one statement is allowed.');
		if (/--|\/\*|\{\{|\}\}/.test(s)) throw new Error('comments are not allowed.');
		const banned = s.match(/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|prepare|listen|notify|vacuum|lock|into|set|reset)\b|pg_|dblink|lo_import|current_setting|set_config/);
		if (banned) throw new Error('"' + banned[0] + '" is not allowed.');
		const tables = this._askTables();
		const allowed = new Set(Object.keys(tables).concat(['lateral', 'unnest', 'generate_series']));
		Object.keys(tables).forEach(t => tables[t].forEach(c => allowed.add(c)));
		for (const m of s.matchAll(/(\w+)\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/g)) allowed.add(m[1]);
		for (const m of s.matchAll(/\b(?:from|join)\s+("?[\w.]+"?)/g)) {
			const t = m[1].replace(/"/g, '');
			if (!allowed.has(t) && !/^\d+$/.test(t)) throw new Error('it reads "' + t + '", which is not an Ask UBM table.');
		}
	},

	// Table and column names of the Ask UBM page's AI tables (its _tables), for
	// the check above.
	_askTables() {
		return {"monthly_usage":["month","utility","bill_type","location_id","location_name","city","state","building_type","square_feet","account","meter","vendor","consumption","consumption_unit","cost","cdd","hdd"],"line_items":["bill_id","invoice_date","invoice_month","utility","vendor","location_id","location_name","account","category","charge_code","description","quantity","unit","charge"],"late_bills":["billing_account","service_account","meter","utility","vendor","location_id","location_name","building_type","account_status","last_bill_date","last_bill_type","last_due_date","days_of_service","expected_bill_date","days_late","is_late"],"bill_errors":["error_id","code","error_name","category","severity","stage","status","raised_at","bill_ref","invoice_date","vendor","account","utility","meter","message"],"error_bills":["bill_ref","bill_id","location_id","location_name"]};
	},

	// ---- helpers ----------------------------------------------------------------

	// Same id the data query uses: the dropdown's change handler stores it
	// before anything else runs.
	_cust() {
		return Number(appsmith.store.selectedCustomerId) || Number(CustomerSelect.selectedOptionValue) || this.defaultCustomer;
	},

	// Text goes into SQL by literal substitution (prepared statements are off),
	// so it travels as one JSON value with its single quotes doubled here; the
	// queries read the fields back with ->> and ->.
	_payload(obj) {
		return JSON.stringify(obj).split("'").join("''");
	},

	_parse(v) {
		if (typeof v === 'string') {
			try { return JSON.parse(v); } catch (e) { return null; }
		}
		return (v && typeof v === 'object') ? v : null;
	},

	_fromRow(r) {
		return {
			id: String(r.id), name: r.name || '',
			createdBy: r.created_by || '', createdAt: String(r.created_at || ''),
			updatedBy: r.updated_by || '', updatedAt: String(r.updated_at || ''),
			version: String(r.version || '')
		};
	},

	// After a save: the saved layout becomes the one the widget rebuilds from,
	// and justSaved tells the widget its save landed.
	async _remember(row, state, cust) {
		const saved = Object.assign(this._fromRow(row), { justSaved: Date.now() });
		await storeValue('agStudioReport', state, false);
		await storeValue('agReportCurrent', saved, false);
		await storeValue('agReportLast', { cust, id: saved.id });
	},

	// The widget runs the same checks; repeated here because the list it
	// checked against may be older than the one in the store.
	_checkName(name, exceptId) {
		if (!name) return 'Give the report a name.';
		if (name.length > 120) return 'Keep the name to 120 characters or fewer.';
		const k = name.toLowerCase();
		const taken = (appsmith.store.agReports || []).some(r => r.id !== exceptId && String(r.name || '').trim().toLowerCase() === k);
		return taken ? 'A report called "' + name + '" already exists for this customer. Pick another name, or open that report and press Save.' : '';
	},

	_friendly(e) {
		const m = this._msg(e);
		if (/duplicate key|unique constraint|ag_studio_saved_reports_name/i.test(m)) return 'A report with that name already exists for this customer.';
		if (/relation .*ag_studio_saved_reports.* does not exist|schema "ubm_app" does not exist/i.test(m)) return 'The saved-reports table is not set up yet in UBM_Appsmith_DB.';
		if (/permission denied/i.test(m)) return 'The UBM_Appsmith_DB login may not write to the saved-reports table.';
		// Appsmith's server drops a request after about a minute and reports it
		// as a lost connection, so that is a timeout too.
		if (/timed out|statement timeout|canceling statement|could not connect to our servers/i.test(m)) return 'The database took too long to answer. Please try again.';
		return 'Something went wrong: ' + m.slice(0, 300);
	},

	_msg(e) {
		if (e == null) return 'Unknown error';
		if (typeof e !== 'object') return String(e);
		const parts = [e.message, e.responseMeta && e.responseMeta.error && e.responseMeta.error.message];
		try { parts.push(JSON.stringify(e)); } catch (x) { /* circular: skip */ }
		return parts.filter(Boolean).join(' | ') || 'Unknown error';
	}
}
