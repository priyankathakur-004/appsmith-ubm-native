export default {
	// Demo scope: internal only, on the UBM Demo customer. The customer list
	// query holds the same id, so widen both together.
	defaultCustomer: 76013,

	// Rows kept with each answer, for the table and its CSV download. The
	// database side caps at 500, so this keeps the whole result.
	maxShownRows: 500,

	// The chat widget is the only consumer of this page's queries, and Appsmith
	// does not run on-load queries for a custom widget's model, so the small
	// on-mount init widget calls this.
	async initPage() {
		// Chat state is kept for this visit only (not persisted), so every load
		// starts clean.
		await storeValue('aiMessages', [], false);
		await storeValue('aiBusy', '', false);
		await storeValue('aiSavedData', {}, false);
		await storeValue('aiSavedRows', [], false);
		await storeValue('aiSavedLoading', false, false);
		// Fall back to the default when the remembered customer is no longer
		// offered in the dropdown.
		const offered = ((await ai_customers.run()) || []).map(c => Number(c.id));
		if (!offered.includes(Number(appsmith.store.aiCustomer))) await storeValue('aiCustomer', this.defaultCustomer);
		await this.loadFacts();
		await this._moveBrowserSaves();
		await this.loadSavedList();
	},

	// The customer's data range and utilities: shown in the header and given to
	// the AI so it knows which values exist. Kept in the store because this
	// object also runs the query (it cannot read the query's result reactively).
	async loadFacts() {
		await storeValue('aiFacts', {}, false);
		if (!Number(appsmith.store.aiCustomer)) return;
		const rows = await ai_customer_facts.run();
		await storeValue('aiFacts', (rows || [])[0] || {}, false);
	},

	async pickCustomer(picked, savedTab) {
		await storeValue('aiCustomer', Number(picked) || 0);
		await storeValue('aiMessages', [], false);
		await storeValue('aiSavedData', {}, false);
		await this.loadFacts();
		if (savedTab) await this.loadSaved();
		else await this.loadSavedList();
	},

	// ---- saved charts (ubm_app.ask_ubm_saved_charts on UBM_Appsmith_DB) -------
	// Shared by everyone who views the customer. A saved chart keeps the
	// question, its SQL and the chart settings, never the numbers: the Saved tab
	// re-runs the SQL, so it always shows the latest data and needs no AI call.
	// aiSavedRows holds the picked customer's list; aiSavedData the rows each
	// saved chart loaded. Neither is persisted.

	// Text goes into SQL by literal substitution (prepared statements are off),
	// so it travels as one JSON value with its single quotes doubled here; the
	// query reads the fields back with ->>.
	_payload(obj) {
		return JSON.stringify(obj).split("'").join("''");
	},

	_savedFromRow(r) {
		let chart = r.chart;
		if (typeof chart === 'string') {
			try { chart = JSON.parse(chart); } catch (e) { chart = null; }
		}
		return {
			id: String(r.id), cust: Number(r.cust), title: r.title, question: r.question, sql: r.sql,
			chart: chart || null, savedBy: r.created_by || '', savedAt: String(r.created_at || ''),
			// For the audit under the chart: the tables and fields its SQL reads.
			sources: this._sources(r.sql)
		};
	},

	// The picked customer's saved charts, without loading their data: enough for
	// the Saved tab count and the Save / Saved state of each answer.
	async loadSavedList() {
		const cust = Number(appsmith.store.aiCustomer) || 0;
		try {
			const rows = cust ? await ai_saved_list.run({ cust }) : [];
			if ((Number(appsmith.store.aiCustomer) || 0) !== cust) return [];
			const list = (Array.isArray(rows) ? rows : []).map(r => this._savedFromRow(r));
			await storeValue('aiSavedRows', list, false);
			return list;
		} catch (e) {
			await storeValue('aiSavedRows', [], false);
			return [];
		}
	},

	async saveAnswer(index) {
		const msgs = appsmith.store.aiMessages || [];
		const i = Number(index);
		const m = msgs[i];
		if (!m || m.role !== 'assistant' || !m.sql) return;
		const cust = Number(appsmith.store.aiCustomer) || 0;
		if ((appsmith.store.aiSavedRows || []).some(x => x.sql === m.sql)) return;
		const question = (msgs[i - 1] || {}).text || '';
		try {
			const added = await ai_saved_add.run({ payload: this._payload({
				cust, title: (m.chart && m.chart.title) || question.slice(0, 120) || 'Saved answer',
				question, sql: m.sql, chart: m.chart || null, by: appsmith.user.email || 'unknown'
			}) });
			const id = ((added || [])[0] || {}).id;
			// Show it straight away with the rows already on screen.
			if (id) {
				const data = Object.assign({}, appsmith.store.aiSavedData || {});
				data[String(id)] = { rows: m.rows, columns: m.columns, rowCount: m.rowCount, refreshedAt: (m.audit && m.audit.askedAt) || new Date().toISOString() };
				await storeValue('aiSavedData', data, false);
			}
			await this.loadSavedList();
		} catch (e) {
			showAlert('Could not save this chart. ' + this._friendly(e), 'error');
		}
	},

	async removeSaved(id) {
		const cust = Number(appsmith.store.aiCustomer) || 0;
		try {
			await ai_saved_remove.run({ id: Number(id) || 0, cust });
			await this.loadSavedList();
		} catch (e) {
			showAlert('Could not remove this chart. ' + this._friendly(e), 'error');
		}
	},

	// "AG Studio" under a chart: hands the answer to the AG Studio page, which
	// opens it there as a new report that can be restyled, combined with other
	// charts and saved. The customer, question, SQL, chart settings and the rows
	// already on screen travel through the store (taken once by that page);
	// the AG Studio customer is set to this one so both show the same data.
	async openInStudio(key) {
		const k = String(key || '');
		const cust = Number(appsmith.store.aiCustomer) || 0;
		let item = null;
		if (k[0] === 'm') {
			const msgs = appsmith.store.aiMessages || [];
			const i = Number(k.slice(1));
			const m = msgs[i];
			if (m && m.role === 'assistant' && m.sql) {
				item = { question: (msgs[i - 1] || {}).text || '', sql: m.sql, chart: m.chart || null, columns: m.columns || [], rows: m.rows || [] };
			}
		} else if (k[0] === 's') {
			const id = k.slice(1);
			const saved = (appsmith.store.aiSavedRows || []).find(x => String(x.id) === id);
			const data = (appsmith.store.aiSavedData || {})[id] || {};
			if (saved && Array.isArray(data.rows)) {
				item = { question: saved.question || '', sql: saved.sql, chart: saved.chart || null, columns: data.columns || [], rows: data.rows };
			}
		}
		if (!cust || !item || !item.rows.length) {
			showAlert('This answer has no data to open in AG Studio.', 'warning');
			return;
		}
		await storeValue('selectedCustomerId', cust);
		await storeValue('agImport', Object.assign({ cust, at: Date.now() }, item));
		navigateTo('AG-grid-charts', {}, 'SAME_WINDOW');
	},

	// Reload every saved chart of the picked customer with the latest data, one
	// query at a time, showing each as it arrives.
	async loadSaved() {
		if (appsmith.store.aiSavedLoading) return;
		const cust = Number(appsmith.store.aiCustomer) || 0;
		await storeValue('aiSavedLoading', true, false);
		const list = await this.loadSavedList();
		const data = {};
		list.forEach(x => { data[x.id] = { loading: true }; });
		await storeValue('aiSavedData', Object.assign({}, data), false);
		for (const x of list) {
			if ((Number(appsmith.store.aiCustomer) || 0) !== cust) break;
			try {
				// Saved SQL comes from a shared table, so it is checked again before it runs.
				this._checkSql(x.sql);
				const rows = await run_ai_sql.run({ sql: x.sql, cust });
				const r = Array.isArray(rows) ? rows : [];
				data[x.id] = { rows: r.slice(0, this.maxShownRows), columns: r.length ? Object.keys(r[0]) : [], rowCount: r.length, refreshedAt: new Date().toISOString() };
			} catch (e) {
				data[x.id] = { error: 'Could not load this chart. ' + this._friendly(e) };
			}
			await storeValue('aiSavedData', Object.assign({}, data), false);
		}
		await storeValue('aiSavedLoading', false, false);
	},

	// One-off move of charts saved in this browser (the earlier version) into the
	// shared table. Anything that fails stays in the browser for the next load.
	async _moveBrowserSaves() {
		const old = appsmith.store.aiSaved;
		if (!Array.isArray(old) || !old.length) return;
		const left = [];
		for (const x of old) {
			try {
				await ai_saved_add.run({ payload: this._payload({
					cust: Number(x.cust) || 0,
					title: (x.chart && x.chart.title) || String(x.question || '').slice(0, 120) || 'Saved answer',
					question: x.question || '', sql: x.sql, chart: x.chart || null,
					by: appsmith.user.email || 'unknown'
				}) });
			} catch (e) {
				left.push(x);
			}
		}
		await storeValue('aiSaved', left);
	},

	async clearChat() {
		await storeValue('aiMessages', [], false);
	},

	// One question: the AI writes a SELECT on monthly_usage, we check it and run
	// it (one retry with the error if it fails), then the AI explains the rows.
	// If only the explaining step fails, the rows are still shown. Every reply
	// carries an audit (see _audit) and every question is logged.
	async ask(question) {
		const q = String(question || '').trim();
		if (!q || appsmith.store.aiBusy) return;
		// The customer is fixed for the whole question and passed to the query.
		const cust = Number(appsmith.store.aiCustomer) || 0;
		const started = Date.now();
		const before = appsmith.store.aiMessages || [];
		const history = before.filter(m => m.role === 'user').slice(-3).map(m => m.text);
		const msgs = before.concat([{ role: 'user', text: q }]);
		await storeValue('aiMessages', msgs, false);

		const reply = { role: 'assistant', text: '', sql: '', columns: [], rows: [], rowCount: 0, chart: null, error: '', audit: null };
		// What happened on the way to the answer, in order, for the audit.
		const steps = [];
		let rows = null;
		let method = null;
		let status = 'answered';
		try {
			if (typeof AI_API === 'undefined') {
				throw new Error('The AI query (AI_API) is not set up on this page yet.');
			}
			await storeValue('aiBusy', 'Writing the query…', false);
			let sql = this._cleanSql(await this._ai(this._sqlPrompt(q, history)));
			// Kept on the reply even if running it fails, so a failure can be traced.
			reply.sql = sql;
			steps.push({ step: 'written', sql });
			try {
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql, cust });
			} catch (first) {
				// A timeout is the data's size, not a mistake the AI can fix: re-running
				// a rewrite only doubles the wait.
				if (/timed out|statement timeout|canceling statement|could not connect to our servers/i.test(this._msg(first))) throw first;
				steps.push({ step: 'failed', error: this._short(first) });
				await storeValue('aiBusy', 'Fixing the query…', false);
				sql = this._cleanSql(await this._ai(this._fixPrompt(q, sql, this._msg(first))));
				reply.sql = sql;
				steps.push({ step: 'rewritten', sql });
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql, cust });
			}
			rows = Array.isArray(rows) ? rows : [];
			// No rows usually means a filter value that does not exist (a unit or name
			// spelled differently): give the AI one chance to recheck its filters.
			if (!rows.length) {
				steps.push({ step: 'empty' });
				try {
					await storeValue('aiBusy', 'Checking the filters…', false);
					const retry = this._cleanSql(await this._ai(this._fixPrompt(q, sql,
						'it ran but returned no rows. Check every filter value (spelling, upper or lower case, units, date range) against what this company\'s data holds; if the question genuinely has no data, return the same query unchanged.')));
					if (retry && retry !== sql) {
						this._checkSql(retry);
						await storeValue('aiBusy', 'Running it on the data…', false);
						const again = await run_ai_sql.run({ sql: retry, cust });
						const used = Array.isArray(again) && again.length > 0;
						steps.push({ step: 'rechecked', sql: retry, rows: used ? again.length : 0, used });
						if (used) { rows = again; sql = retry; }
					} else {
						steps.push({ step: 'unchanged' });
					}
				} catch (e) {
					// Keep the empty result.
					steps.push({ step: 'recheckFailed', error: this._short(e) });
				}
			}
			reply.sql = sql;
			if (rows.length === 1 && /not available/i.test(String(rows[0].answer || ''))) {
				// The AI's "cannot answer" row: say so plainly, with no table or summary.
				status = 'not_available';
				reply.text = "That isn't in the data I can see. I can answer questions about your monthly usage and cost, the charges on your bills (including late fees), late bills and bill errors, by location, vendor, utility, account or meter.";
			} else {
				if (!rows.length) status = 'no_data';
				reply.rowCount = rows.length;
				reply.columns = rows.length ? Object.keys(rows[0]) : [];
				reply.rows = rows.slice(0, this.maxShownRows);

				await storeValue('aiBusy', 'Writing the answer…', false);
				const out = this._parseAnswer(await this._ai(this._explainPrompt(q, sql, rows)));
				reply.text = out.answer || 'Here are the results.';
				reply.chart = this._checkChart(out.chart, reply.columns, reply.rows);
				method = out.method;
			}
		} catch (e) {
			if (rows) {
				reply.text = 'Here are the results. (The AI could not write a summary just now.)';
			} else {
				status = 'error';
				reply.text = "Sorry, I couldn't answer that one.";
				reply.error = this._friendly(e);
				steps.push({ step: 'failed', error: this._short(e) });
			}
		}
		reply.audit = this._audit({ cust, started, steps, sql: reply.sql, method, rowCount: reply.rowCount, kept: reply.rows.length, status });
		await storeValue('aiBusy', '', false);
		// Customer changed while answering: that chat was cleared, so the reply is
		// dropped from the screen, but the question is still logged.
		const shown = (Number(appsmith.store.aiCustomer) || 0) === cust;
		if (shown) await storeValue('aiMessages', msgs.concat([reply]), false);
		const ref = await this._log(q, reply);
		if (ref && shown) {
			// The log id goes on the reply as its audit reference, if it is still
			// the reply on screen.
			const now = (appsmith.store.aiMessages || []).slice();
			const m = now[msgs.length];
			if (m && m.audit && m.audit.askedAt === reply.audit.askedAt) {
				now[msgs.length] = Object.assign({}, m, { audit: Object.assign({}, m.audit, { ref }) });
				await storeValue('aiMessages', now, false);
			}
		}
	},

	// ---- audit trail ------------------------------------------------------------
	// Each reply keeps how it was produced, shown under the answer as "How this
	// was calculated" and written to ubm_app.ask_ubm_question_log. The data used
	// (tables, fields, the rules each table applies) is read from the SQL that
	// ran, not from the AI; only method (the filters and calculation in plain
	// words) is the AI's description of that SQL.
	_audit(x) {
		return {
			askedAt: new Date(x.started).toISOString(),
			askedBy: appsmith.user.email || '',
			cust: x.cust,
			ms: Date.now() - x.started,
			status: x.status,
			steps: x.steps,
			sources: this._sources(x.sql),
			method: x.method || null,
			rowCount: x.rowCount,
			kept: x.kept,
			ref: ''
		};
	},

	// The Ask UBM tables a query reads, with the fields it names in each.
	_sources(sql) {
		// Quoted values are left out, so a filter such as 'Retail' never reads as
		// a table or field name.
		const s = String(sql || '').toLowerCase().replace(/'(?:[^']|'')*'/g, "''");
		if (!s) return [];
		const tables = this._tables();
		// "All fields" only when * reads the table itself: a * over the query's own
		// WITH steps (SELECT * FROM acct) says nothing about the table's fields.
		const star = t => new RegExp('select\\s+(distinct\\s+)?\\*\\s+from\\s+"?' + t + '"?(\\s|\\)|,|$)').test(s);
		const word = w => new RegExp('\\b' + w + '\\b').test(s);
		return Object.keys(tables)
			.filter(t => new RegExp('\\b(from|join)\\s+"?' + t + '"?(\\s|\\)|,|$)').test(s))
			.map(t => ({
				table: t,
				label: tables[t].label,
				from: tables[t].source,
				rules: tables[t].rules,
				fields: star(t) ? ['all fields'] : tables[t].cols.map(c => c[0]).filter(word)
			}));
	},

	// Writes one question to the log table. Returns its id, or '' when the log
	// is not available (the table not set up yet, say): logging never stops an
	// answer.
	async _log(question, reply) {
		const a = reply.audit || {};
		try {
			const res = await ai_log_add.run({ payload: this._payload({
				cust: a.cust || 0, question, status: a.status || '', answer: reply.text || '',
				sql: reply.sql || '', rows: Number(reply.rowCount) || 0, error: reply.error || '',
				ms: Number(a.ms) || 0, by: a.askedBy || 'unknown',
				audit: { steps: a.steps, sources: a.sources, method: a.method, chart: reply.chart, columns: reply.columns, kept: a.kept }
			}) });
			return String(((res || [])[0] || {}).id || '');
		} catch (e) {
			return '';
		}
	},

	// An error's own message, short enough for the audit.
	_short(e) {
		return String((e && e.message) || this._msg(e)).slice(0, 300);
	},

	// One AI call, retried when the service is busy (503/529 "overloaded" or a
	// 429 rate limit for a moment). Returns the reply text.
	async _ai(prompt) {
		const waits = [3000, 8000, 15000];
		for (let attempt = 0; ; attempt++) {
			try {
				return this._text(await AI_API.run({ prompt }));
			} catch (e) {
				const busy = /\b(503|529|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|rate_limit/i.test(this._msg(e));
				if (!busy || attempt >= waits.length) throw e;
				await storeValue('aiBusy', 'The AI is busy, trying again…', false);
				await new Promise(r => setTimeout(r, waits[attempt]));
			}
		}
	},

	// A plain message for the chat instead of the raw provider error.
	_friendly(e) {
		const m = this._msg(e);
		if (/\b(503|529)\b|UNAVAILABLE|high demand|overloaded/i.test(m)) return 'The AI service is busy right now. Please try again in a minute.';
		if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate_limit/i.test(m)) return 'The AI usage limit has been reached for now. Please try again in a minute.';
		if (/not allowed|may only read|SELECT query|one statement|Comments/i.test(m)) return 'The AI wrote a query this page does not allow. Try rephrasing the question.';
		if (/\b404\b|NOT_FOUND|not found for API version|is not supported|unknown model|invalid model/i.test(m)) return 'This AI model is not available on our API key. Pick another model in the AI_API query.';
		if (/credit balance|billing/i.test(m)) return 'The AI account has run out of credit. Top it up or switch the AI_API query to another provider.';
		if (/\b(401|403)\b|PERMISSION_DENIED|API key not valid|UNAUTHENTICATED/i.test(m)) return 'The AI API key was rejected. Check the AI datasource.';
		// Appsmith's server drops a request after about a minute and reports it
		// as a lost connection, so that is a timeout too.
		if (/timed out|statement timeout|canceling statement|could not connect to our servers/i.test(m)) return 'That question took too long to answer. Try narrowing it, for example to one year, one utility or one location.';
		if (/not set up/i.test(m)) return m;
		// Anything else: show the real error (shortened) so it can be fixed.
		return 'Something went wrong: ' + m.slice(0, 300);
	},

	// The tables the AI may query. run_ai_sql builds each one, already limited
	// to the picked customer, from UBM's reporting tables. label, source and
	// rules are for the audit under each answer (what the table is built from
	// and what it already does to the data); the AI sees about, cols and notes.
	// notes are the business rules from the topic notes in ask-ubm-reference/
	// (change them there first).
	_tables() {
		return {
			monthly_usage: {
				label: 'Monthly usage and cost',
				source: ['bill_management_v2.reports_customer_monthly_usage', 'bill_management_v2.locations (site details)'],
				rules: [
					'Usage is prorated to calendar months.',
					'Third-party supply: a Supply Only row shows 0 usage when the same location, utility and month has a delivery bill, so usage is counted once. Its cost is always counted.'
				],
				about: 'Monthly usage and cost, prorated to calendar months. One row per location + account + meter + utility + month. Use it for usage, total cost, trends, per-square-foot and weather questions.',
				cols: [
					['month', 'date', 'first day of the calendar month'],
					['utility', 'text', 'utility type in capitals, e.g. ELECTRIC, NATURALGAS, WATER'],
					['bill_type', 'text', 'e.g. Full Service, Distribution Only, Supply Only'],
					['location_id', 'integer', 'site id'],
					['location_name', 'text', 'site name'],
					['city', 'text', ''],
					['state', 'text', 'two-letter US state'],
					['building_type', 'text', 'e.g. Office, Retail, Warehouse'],
					['square_feet', 'numeric', 'site floor area'],
					['account', 'text', 'utility account number'],
					['meter', 'text', 'meter serial number'],
					['vendor', 'text', 'utility company name'],
					['consumption', 'numeric', "usage for the month, in consumption_unit, counted once: a Supply Only row shows 0 when the same location's delivery bill already carries that usage, but its cost is still in cost. So SUM(cost) / SUM(consumption) is the all-in rate"],
					['consumption_unit', 'text', 'unit of consumption, e.g. kWh, therms, gallons'],
					['cost', 'numeric', 'total charges in US dollars'],
					['cdd', 'numeric', 'cooling degree days for the month'],
					['hdd', 'numeric', 'heating degree days for the month']
				],
				notes: [
					'Usage means SUM(consumption) grouped by utility and consumption_unit; cost, spend or "how much we paid" means SUM(cost).',
					'A rate ($ per kWh, per therm, all-in rate) is a ratio of totals, ROUND(SUM(cost) / NULLIF(SUM(consumption), 0), 4) per utility and unit, never an average of row rates.',
					'Total cost includes every utility on the bills (electric, gas, water, sewer, waste and any other); leave none out unless the question names utilities.',
					'Electricity usage is energy (kWh). Demand (kW) is not in this table: give it only when the question asks for demand, kW or peak, from line_items.',
					'Degree days (cdd, hdd) describe a site and month, and every meter row repeats them: take one value per location and month (MAX), never a SUM across meters or accounts; across several sites, average those site values.',
					'"Electricity" or "power" is UPPER(utility) = \'ELECTRIC\'; "gas" is UPPER(utility) = \'NATURALGAS\'. Site, building, facility, store or property means location; utility company, provider or supplier means vendor; delivery vs supply means bill_type.'
				]
			},
			line_items: {
				label: 'Bill line items',
				source: ['bill_management_v2.analytics_billing_line_items'],
				rules: [
					'Processed bills only (bills still in the workflow are left out).',
					"Historical (back-loaded) bills are left out: they repeat charges already on other bills.",
					'Not every bill has its lines broken out, so totals here can be lower than total cost.'
				],
				about: 'Every line on every processed bill. One row per bill line. Use it for kinds of charges (supply, delivery, demand, taxes, fees, late fees, penalties), individual bills, rates and invoice dates. Dated by invoice, so its months do not match monthly_usage month by month. Not every bill has its lines broken out (older bills especially), so never use it for total cost; use it to split costs into kinds of charge (the written answer mentions that only bills with line detail are covered; do not add a note column for it).',
				cols: [
					['bill_id', 'integer', 'UBM bill id'],
					['invoice_date', 'timestamp', 'bill statement date (midnight)'],
					['invoice_month', 'date', 'first day of the invoice month'],
					['utility', 'text', 'utility type in capitals, e.g. ELECTRIC'],
					['vendor', 'text', 'utility company name'],
					['location_id', 'integer', 'site id'],
					['location_name', 'text', 'site name'],
					['account', 'text', 'utility account number'],
					['category', 'text', "charge group; 'Usage Information' lines are meter readings (e.g. demand kW) with charge 0"],
					['charge_code', 'text', "standard code, e.g. LATEFEE (late fee; a negative charge is a refunded late fee), OTH_PENALTY (penalty)"],
					['description', 'text', 'line name as printed on the bill'],
					['quantity', 'numeric', 'billed quantity, in unit (may be empty)'],
					['unit', 'text', 'unit of quantity, e.g. KWH, KW, THERM'],
					['charge', 'numeric', 'amount in US dollars']
				],
				notes: [
					"Supply, delivery, distribution, taxes, fees and other kinds of charge are the bill's own categories: group or filter by category, matched case-insensitively against the company's categories listed below, not by charge_code.",
					"Usage Information lines are readings, not charges (charge 0): leave them out of dollar totals. Those with UPPER(unit) = 'KW' are demand readings; peak demand is MAX(quantity) of them per account or location and month. Demand charges are dollar lines in a demand category.",
					"Late fees are charge_code = 'LATEFEE' only, refunds (negative charges) netted off. Penalties (charge_code = 'OTH_PENALTY') are separate: include them only when the question asks about penalties.",
					'Never add quantities across different units (kWh and kW are different things).'
				]
			},
			late_bills: {
				label: 'Late bills',
				source: ['bill_management_v2.reports_new_virtual_accounts', 'latest bill per service from analytics_bills_items, bill_metas, bill_items and bill_records', 'bill_management_v2.locations (building type)'],
				rules: [
					'Open or Unknown services that have a billing account.',
					'Days late = business days (Mon–Fri) since the expected bill date.',
					"Late = the expected date has passed and the latest bill is from the last 6 months (UBM's Late Bills rule)."
				],
				about: "Bills still to arrive, the same data as UBM's Late Bills report. One row per open service (account + meter + utility) with its latest bill and when the next one was expected. Count DISTINCT billing_account WHERE is_late for the number of late accounts, as the report does.",
				cols: [
					['billing_account', 'text', 'utility billing account number'],
					['service_account', 'text', 'service account id'],
					['meter', 'text', 'meter id'],
					['utility', 'text', 'utility type in capitals'],
					['vendor', 'text', 'utility company name'],
					['location_id', 'integer', 'site id'],
					['location_name', 'text', 'site name'],
					['building_type', 'text', ''],
					['account_status', 'text', 'Open or Unknown'],
					['last_bill_date', 'date', 'statement date of the latest bill received'],
					['last_bill_type', 'text', 'live, historical, setup or special'],
					['last_due_date', 'date', 'due date of the latest bill'],
					['days_of_service', 'integer', 'days covered by the latest bill'],
					['expected_bill_date', 'date', 'when the next bill was expected'],
					['days_late', 'integer', 'business days since the expected date; 0 or less when not yet due'],
					['is_late', 'boolean', "late by UBM's rule: expected date reached and latest bill within the last 6 months"]
				],
				notes: [
					"Late, overdue or missing bills means WHERE is_late. Services with status Open and Unknown both count, as in UBM's Late Bills report.",
					'An account with several meters has several rows: the number of late accounts is COUNT(DISTINCT billing_account), not a row count.',
					'days_late is business days once overdue, not calendar days.',
					"A service with no bill for more than 6 months has stopped billing and is not late. For \"stopped billing\" questions use last_bill_date < CURRENT_DATE - INTERVAL '6 months'.",
					'Due soon or expected next week: a range on expected_bill_date with NOT is_late.'
				]
			},
			bill_errors: {
				label: 'Bill errors',
				source: ['bill_management_v2.bill_errors', 'bill_records', 'bill_validation_definitions (error names)', 'providers_pretty_name and customers_vendors_pretty_name (vendor names)'],
				rules: [
					'Errors raised in the last 24 months.',
					'Current bills only: errors on deleted or replaced bills are left out.'
				],
				about: "Validation errors UBM raised on this company's current bills in the last 2 years (the Error Explorer's data; errors on deleted or replaced bills are left out). One row per error; a bill can have many. Use it for bill errors: which accounts or vendors have most, common error types, open vs resolved. An error type is code + error_name (one code can mean different checks). Count errors with COUNT(*) and affected bills with COUNT(DISTINCT bill_ref). It is large: always aggregate and filter dates with ranges on raised_at. For bill ids or locations, join error_bills ON error_bills.bill_ref = bill_errors.bill_ref.",
				cols: [
					['error_id', 'integer', 'error id'],
					['code', 'integer', 'validation check code, e.g. 3004'],
					['error_name', 'text', 'what the check found, e.g. Duplicate bill'],
					['category', 'text', 'the component that raised it, e.g. Bill Validator, Bill Analyser'],
					['severity', 'integer', '10 to 80, higher is more serious; there are no official labels, show the number'],
					['stage', 'text', 'processing stage the check belongs to, e.g. integrity_check, data_audit_1'],
					['status', 'text', 'open or resolved'],
					['raised_at', 'timestamp', 'when the error was raised'],
					['bill_ref', 'integer', 'bill the error is on; count affected bills with it, join error_bills with it'],
					['invoice_date', 'timestamp', 'statement date of the bill'],
					['vendor', 'text', 'utility company name'],
					['account', 'text', 'utility account number'],
					['utility', 'text', 'utility type in capitals (may be empty)'],
					['meter', 'text', 'meter serial (may be empty)'],
					['message', 'text', 'the error message, with specifics such as amounts or day counts']
				],
				notes: [
					"\"How many errors\" counts open and resolved errors together, and also returns how many are open (COUNT(*) FILTER (WHERE LOWER(status) = 'open')) in its own column. Open, unresolved or outstanding means status open; fixed, cleared or resolved means status resolved.",
					'Show severity as its number (higher is more serious); never invent labels such as "critical". For "serious" or "high severity" use a severity threshold and say which.',
					"Show a stage in plain words: INITCAP(REPLACE(stage, '_', ' ')), e.g. Data Audit 1.",
					'An error type is code and error_name together: group by both.',
					'The table already holds only the last 24 months: add a raised_at filter only when the question names a period, never one for the 24 months themselves. Errors older than that are not in the table: say so instead of answering for them.'
				]
			},
			error_bills: {
				label: 'Bills with errors',
				source: ['bills in Bill errors', 'bill_metas_bill_records (UBM bill id)', 'bill_items_virtual_accounts and locations (location)'],
				rules: [
					"Each bill's location is the first one its lines map to, so location totals are close but not exact."
				],
				about: 'One row per bill that has errors in bill_errors, with its UBM bill id and location. Join to bill_errors on bill_ref; use it only when the question needs bill ids or locations. Each bill has one location (the first its lines map to), so location totals are close but not exact. To rank individual bills, group by bill_ref (always filled) and show bill_id beside it.',
				cols: [
					['bill_ref', 'integer', 'matches bill_errors.bill_ref'],
					['bill_id', 'integer', 'UBM bill id'],
					['location_id', 'integer', 'site id (may be empty)'],
					['location_name', 'text', 'site name (may be empty)']
				]
			}
		};
	},

	_sqlPrompt(question, history) {
		const f = appsmith.store.aiFacts || {};
		const tables = this._tables();
		const described = Object.keys(tables).map(name =>
			`${name}: ${tables[name].about}\n` +
			tables[name].cols.map(c => `- ${c[0]} (${c[1]})${c[2] ? ': ' + c[2] : ''}`).join('\n') +
			((tables[name].notes || []).length ? `\nRules for ${name}:\n` + tables[name].notes.map(n => '* ' + n).join('\n') : '')
		).join('\n\n');
		const earlier = (history || []).length
			? `Earlier questions in this chat (the new question may follow on from them):\n${history.map(h => '- ' + h).join('\n')}\n\n`
			: '';
		return `You write one PostgreSQL query that answers a question about one company's utility bills.

There are exactly ${Object.keys(tables).length} tables, each already limited to this company:

${described}

What this company's data holds: months ${f.first_month || '?'} to ${f.last_month || '?'}, ${f.locations || '?'} locations, utilities (with units): ${f.utility_units || 'unknown'}. Charge categories on its bills: ${f.charge_categories || 'unknown'}.
Today is ${new Date().toISOString().slice(0, 10)}. "This year" and "last year" mean calendar years. "Last 12 months" means the 12 full months before the current month, leaving out the current, part-billed month. A fiscal year is taken as the calendar year unless the question says which month it starts.
The user is this company: "my", "our", "we" and "us" in the question mean this company's data.

Rules:
- Return only the SQL, with no explanation and no markdown.
- One statement: SELECT, or WITH ... SELECT. Read only the tables above; they can be joined on location_id (and bill_errors to error_bills on bill_ref). No semicolon, no comments.
- Pick the table that fits the question. Total cost and usage come from monthly_usage; breakdowns of a bill's charges come from line_items; late or missing bills come from late_bills; bill errors and validation problems come from bill_errors.
- Compare text values case-insensitively (UPPER(col) = 'KWH', ILIKE '%cherry creek%'): units, utilities, names and categories vary in case and spelling.
- Never add consumption or quantities across different utilities or units: group by the utility and unit whenever you sum them. Dollars can be added across utilities.
- For anything per square foot, use only sites with square_feet of at least 500 (smaller values are placeholders), and return how many sites were left out in a separate column.
- Filter dates with ranges, e.g. invoice_date >= '2025-01-01' AND invoice_date < '2026-01-01', never EXTRACT or a cast on the column inside WHERE; it keeps the query fast on large customers.
- Round dollars to 2 decimals and consumption to whole numbers. Divide with NULLIF(..., 0) so an empty total gives an empty value, not an error.
- Each row of the result is one kind of thing: never mix, for example, vendor totals and account rows in one result.
- Name every output column in readable snake_case.
- Sort the result sensibly and return at most 100 rows. When the question asks for a top N, return exactly N rows. When sorting by a number, add NULLS LAST, and for a top or bottom N leave out rows where that number is empty.
- If the tables cannot answer the question, return exactly: SELECT 'not available in this data' AS answer

${earlier}Question: ${question}`;
	},

	_fixPrompt(question, sql, error) {
		return `${this._sqlPrompt(question, [])}

Your previous query was:
${sql}

It failed with: ${error}
Return a corrected query only.`;
	},

	// The summary step also picks the chart and describes the method for the
	// audit, so neither costs an extra AI call. The chart is drawn from the
	// database rows; the AI only names the columns.
	_explainPrompt(question, sql, rows) {
		const sample = JSON.stringify(rows.slice(0, 100));
		const cols = rows.length ? Object.keys(rows[0]).join(', ') : '(none)';
		// A period that runs past the company's data (the last 12 months when
		// bills stop in February, say) must not read as a full period.
		const f = appsmith.store.aiFacts || {};
		const coverage = f.first_month && f.last_month
			? `This company's monthly usage and cost data covers ${f.first_month} to ${f.last_month}. If the SQL reads monthly_usage and the period asked about starts before or ends after those months, say which months the figures actually cover (for example "your data runs to ${f.last_month}, so this covers ...") instead of naming the whole period as if it were complete.`
			: '';
		return `You are a utility-billing analyst. Reply with JSON only (no markdown), in this shape:
{"answer": "...", "chart": null, "method": {"filters": ["..."], "calculation": "..."}}
or
{"answer": "...", "chart": {"type": "bar", "x": "column", "y": ["column"], "series": null, "title": "...", "y_label": "..."}, "method": {"filters": ["..."], "calculation": "..."}}

answer: 1 to 3 short sentences answering the question, using only the result below. The user is the company the data belongs to: speak to them about their own data ("your cost", "your locations"), never "this customer" or "the company". State units and use $ for costs. Do not invent numbers. If the result is empty, say no matching data was found. The result is shown to the user as a table and chart under your answer, so do not mention rows, queries, SQL or how much of the result you were given. If the SQL reads line_items, end with a short note that the figures cover bills with line-item detail, which may not include every bill. If the question asks about a fiscal year without saying which month it starts, say the figures use calendar years. ${coverage}

chart: how to plot the result, or null when a chart adds nothing (one row, a single value, text answers).
- Use only these result columns: ${cols}
- type "bar" for rankings and comparisons between categories; "line" for trends over time (x is the month or date column).
- x: the category or month column. y: one or more numeric columns measured in the same unit; never put dollars and usage on one chart, pick the one the question is about.
- series: when the result is long form (for example month, utility, value), the column whose values become separate bars or lines, with exactly one y column. Otherwise null.
- title: a short chart title that describes exactly what the result holds (say "top 10" only if it has 10 rows). y_label: the unit, for example "$", "kWh" or "therms".
- Each x value (each x and series pair when there is a series) must appear in only one row. If the result mixes groupings, for example vendor totals and account rows, use chart null.

method: how the SQL below produced the result, for someone checking the numbers by hand. Describe only what the SQL does, in plain words, without SQL syntax or table names.
- filters: every condition that limits the rows, one per item, with its exact values and dates, for example "Utility is ELECTRIC" or "Invoice date from 2025-01-01 up to, not including, 2026-01-01". Leave out the company limit (applied automatically). Use [] when there are none.
- calculation: one or two sentences on what is added up, counted, averaged or divided, what it is grouped by, how it is sorted and how many rows are kept.

Question: ${question}
SQL that was run: ${sql}
Result (${rows.length} rows${rows.length > 100 ? ', first 100 given here' : ''}): ${sample}`;
	},

	// The summary reply is JSON; fall back to treating it all as the answer.
	_parseAnswer(text) {
		const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
		const start = t.indexOf('{');
		const end = t.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				const o = JSON.parse(t.slice(start, end + 1));
				if (o && typeof o.answer === 'string') return { answer: o.answer.trim(), chart: o.chart || null, method: this._checkMethod(o.method) };
			} catch (e) { /* not JSON: use the text as it is */ }
		}
		return { answer: t, chart: null, method: null };
	},

	// Keep the method only as short plain text: it is shown and logged as is.
	_checkMethod(m) {
		if (!m || typeof m !== 'object') return null;
		const filters = (Array.isArray(m.filters) ? m.filters : [])
			.filter(f => typeof f === 'string' && f.trim())
			.slice(0, 15)
			.map(f => f.trim().slice(0, 200));
		const calculation = typeof m.calculation === 'string' ? m.calculation.trim().slice(0, 600) : '';
		return filters.length || calculation ? { filters, calculation } : null;
	},

	// Keep the chart only if it names real columns with numbers in them.
	_checkChart(chart, columns, rows) {
		if (!chart || typeof chart !== 'object' || rows.length < 2) return null;
		const has = c => columns.includes(c);
		const numeric = c => rows.slice(0, 20).some(r => r[c] != null && r[c] !== '' && !isNaN(Number(r[c])));
		const type = chart.type === 'line' ? 'line' : 'bar';
		const y = (Array.isArray(chart.y) ? chart.y : [chart.y]).filter(c => has(c) && numeric(c));
		const series = chart.series && has(chart.series) && chart.series !== chart.x ? chart.series : null;
		if (!has(chart.x) || !y.length) return null;
		// A label on more than one row (vendor totals next to account rows, say)
		// has no single value to draw: neither the last row nor the sum is safe.
		const seen = new Set();
		for (const r of rows) {
			const k = String(r[chart.x]) + '\u0000' + (series ? String(r[series]) : '');
			if (seen.has(k)) return null;
			seen.add(k);
		}
		return {
			type, x: chart.x, y: series ? [y[0]] : y, series,
			title: String(chart.title || '').slice(0, 120),
			y_label: String(chart.y_label || '').slice(0, 30)
		};
	},

	// The AI datasource's response shape differs by provider and version, so
	// pull the text out of whichever shape comes back. Walks the response with a
	// local stack: a method calling itself reads as a cycle to Appsmith.
	_text(res) {
		const out = [];
		const stack = [res];
		while (stack.length) {
			const r = stack.pop();
			if (r == null) continue;
			if (typeof r === 'string') { out.push(r); continue; }
			if (typeof r !== 'object') continue;
			if (Array.isArray(r)) { for (let i = r.length - 1; i >= 0; i--) stack.push(r[i]); continue; }
			const c = r.candidates && r.candidates[0] && r.candidates[0].content;
			if (c && Array.isArray(c.parts)) { out.push(c.parts.map(p => p.text || '').join('')); continue; }
			const ch = r.choices && r.choices[0];
			if (ch) { out.push((ch.message && ch.message.content) || ch.text || ''); continue; }
			const k = ['response', 'text', 'content', 'output', 'data', 'parts', 'message'].find(x => r[x] != null);
			if (k) stack.push(r[k]);
		}
		return out.join('');
	},

	// Drop any prose before the SQL, keeping opening brackets that belong to it:
	// "(SELECT ... LIMIT 10) UNION ALL (SELECT ...)" must keep its first "(".
	_cleanSql(text) {
		let s = String(text || '').replace(/```(?:sql)?/gi, '').trim();
		const m = s.match(/[(\s]*\b(with|select)\b/i);
		if (m && m.index > 0) s = s.slice(m.index);
		return s.replace(/;\s*$/, '').trim();
	},

	// The guard for AI-written SQL. The database login is read-only and the
	// tables are pre-filtered to the customer; this keeps the query to those
	// tables and to a single read statement.
	_checkSql(sql) {
		const s = String(sql || '').toLowerCase();
		if (!/^[(\s]*(select|with)\b/.test(s)) throw new Error('The AI did not return a SELECT query.');
		// Brackets must balance (ignoring quoted text): the query is wrapped in a
		// subquery, and a stray ")" ends that early.
		let depth = 0;
		for (const ch of s.replace(/'[^']*'/g, '')) {
			if (ch === '(') depth++;
			else if (ch === ')' && --depth < 0) break;
		}
		if (depth !== 0) throw new Error('The query has unbalanced brackets.');
		if (s.includes(';')) throw new Error('Only one statement is allowed.');
		if (/--|\/\*|\{\{|\}\}/.test(s)) throw new Error('Comments are not allowed in the query.');
		const banned = s.match(/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|prepare|listen|notify|vacuum|lock|into|set|reset)\b|pg_|dblink|lo_import|current_setting|set_config/);
		if (banned) throw new Error(`"${banned[0]}" is not allowed in the query.`);
		const tables = this._tables();
		const allowed = new Set(Object.keys(tables).concat(['lateral', 'unnest', 'generate_series']));
		// Column names too: EXTRACT(YEAR FROM month) and the like read as FROM.
		Object.keys(tables).forEach(t => tables[t].cols.forEach(c => allowed.add(c[0])));
		for (const m of s.matchAll(/(\w+)\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/g)) allowed.add(m[1]);
		for (const m of s.matchAll(/\b(?:from|join)\s+("?[\w.]+"?)/g)) {
			const t = m[1].replace(/"/g, '');
			if (!allowed.has(t) && !/^\d+$/.test(t)) throw new Error(`The query may only read the Ask UBM tables, not "${t}".`);
		}
	},

	// Everything the failed call says about itself: Appsmith may put the
	// provider's error in the message, the response data or nested fields.
	_msg(e) {
		if (e == null) return 'Unknown error';
		if (typeof e !== 'object') return String(e);
		const parts = [e.message, e.responseMeta && e.responseMeta.error && e.responseMeta.error.message];
		try { parts.push(JSON.stringify(e)); } catch (x) { /* circular: skip */ }
		return parts.filter(Boolean).join(' | ') || 'Unknown error';
	}
}
