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
		await storeValue('aiSavedLoading', false, false);
		// Fall back to the default when the remembered customer is no longer
		// offered in the dropdown.
		const offered = ((await ai_customers.run()) || []).map(c => Number(c.id));
		if (!offered.includes(Number(appsmith.store.aiCustomer))) await storeValue('aiCustomer', this.defaultCustomer);
		await this.loadFacts();
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
	},

	// ---- saved charts (option 1: kept in this browser) -------------------------
	// A saved chart keeps the question, its SQL and the chart settings, never
	// the numbers: the Saved tab re-runs the SQL, so it always shows the latest
	// data and needs no AI call. aiSaved is persisted by the browser (the
	// default for storeValue); the loaded rows (aiSavedData) are not.

	async saveAnswer(index) {
		const msgs = appsmith.store.aiMessages || [];
		const i = Number(index);
		const m = msgs[i];
		if (!m || m.role !== 'assistant' || !m.sql) return;
		const cust = Number(appsmith.store.aiCustomer) || 0;
		const saved = appsmith.store.aiSaved || [];
		if (saved.some(x => Number(x.cust) === cust && x.sql === m.sql)) return;
		const item = {
			id: String(Date.now()), cust, question: (msgs[i - 1] || {}).text || '',
			sql: m.sql, chart: m.chart || null, savedAt: new Date().toISOString()
		};
		await storeValue('aiSaved', [item].concat(saved).slice(0, 100));
		// Show it straight away with the rows already on screen.
		const data = Object.assign({}, appsmith.store.aiSavedData || {});
		data[item.id] = { rows: m.rows, columns: m.columns, rowCount: m.rowCount };
		await storeValue('aiSavedData', data, false);
	},

	async removeSaved(id) {
		await storeValue('aiSaved', (appsmith.store.aiSaved || []).filter(x => String(x.id) !== String(id)));
	},

	// Reload every saved chart of the picked customer with the latest data, one
	// query at a time, showing each as it arrives.
	async loadSaved() {
		const cust = Number(appsmith.store.aiCustomer) || 0;
		const list = (appsmith.store.aiSaved || []).filter(x => Number(x.cust) === cust);
		if (!list.length || appsmith.store.aiSavedLoading) return;
		await storeValue('aiSavedLoading', true, false);
		const data = {};
		list.forEach(x => { data[x.id] = { loading: true }; });
		await storeValue('aiSavedData', Object.assign({}, data), false);
		for (const x of list) {
			if ((Number(appsmith.store.aiCustomer) || 0) !== cust) break;
			try {
				// Saved SQL lives in the browser, so it is checked again before it runs.
				this._checkSql(x.sql);
				const rows = await run_ai_sql.run({ sql: x.sql, cust });
				const r = Array.isArray(rows) ? rows : [];
				data[x.id] = { rows: r.slice(0, this.maxShownRows), columns: r.length ? Object.keys(r[0]) : [], rowCount: r.length };
			} catch (e) {
				data[x.id] = { error: 'Could not load this chart. ' + this._friendly(e) };
			}
			await storeValue('aiSavedData', Object.assign({}, data), false);
		}
		await storeValue('aiSavedLoading', false, false);
	},

	async clearChat() {
		await storeValue('aiMessages', [], false);
	},

	// One question: the AI writes a SELECT on monthly_usage, we check it and run
	// it (one retry with the error if it fails), then the AI explains the rows.
	// If only the explaining step fails, the rows are still shown.
	async ask(question) {
		const q = String(question || '').trim();
		if (!q || appsmith.store.aiBusy) return;
		// The customer is fixed for the whole question and passed to the query.
		const cust = Number(appsmith.store.aiCustomer) || 0;
		const before = appsmith.store.aiMessages || [];
		const history = before.filter(m => m.role === 'user').slice(-3).map(m => m.text);
		const msgs = before.concat([{ role: 'user', text: q }]);
		await storeValue('aiMessages', msgs, false);

		const reply = { role: 'assistant', text: '', sql: '', columns: [], rows: [], rowCount: 0, chart: null, error: '' };
		let rows = null;
		try {
			if (typeof AI_API === 'undefined') {
				throw new Error('The AI query (AI_API) is not set up on this page yet.');
			}
			await storeValue('aiBusy', 'Writing the query…', false);
			let sql = this._cleanSql(await this._ai(this._sqlPrompt(q, history)));
			try {
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql, cust });
			} catch (first) {
				reply.sql = sql;
				await storeValue('aiBusy', 'Fixing the query…', false);
				sql = this._cleanSql(await this._ai(this._fixPrompt(q, sql, this._msg(first))));
				reply.sql = sql;
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql, cust });
			}
			rows = Array.isArray(rows) ? rows : [];
			reply.sql = sql;
			// The AI's "cannot answer" row: say so plainly, with no table or summary.
			if (rows.length === 1 && /not available/i.test(String(rows[0].answer || ''))) {
				reply.text = "That isn't in the data I can see. I can answer questions about your monthly usage and cost, the charges on your bills (including late fees) and late bills, by location, vendor, utility, account or meter.";
				await storeValue('aiMessages', msgs.concat([reply]), false);
				await storeValue('aiBusy', '', false);
				return;
			}
			reply.rowCount = rows.length;
			reply.columns = rows.length ? Object.keys(rows[0]) : [];
			reply.rows = rows.slice(0, this.maxShownRows);

			await storeValue('aiBusy', 'Writing the answer…', false);
			const out = this._parseAnswer(await this._ai(this._explainPrompt(q, sql, rows)));
			reply.text = out.answer || 'Here are the results.';
			reply.chart = this._checkChart(out.chart, reply.columns, reply.rows);
		} catch (e) {
			if (rows) {
				reply.text = 'Here are the results. (The AI could not write a summary just now.)';
			} else {
				reply.text = "Sorry, I couldn't answer that one.";
				reply.error = this._friendly(e);
			}
		}
		await storeValue('aiBusy', '', false);
		// Customer changed while answering: that chat was cleared, drop the reply.
		if ((Number(appsmith.store.aiCustomer) || 0) !== cust) return;
		await storeValue('aiMessages', msgs.concat([reply]), false);
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
		if (/not set up/i.test(m)) return m;
		// Anything else: show the real error (shortened) so it can be fixed.
		return 'Something went wrong: ' + m.slice(0, 300);
	},

	// The tables the AI may query. run_ai_sql builds each one, already limited
	// to the picked customer, from UBM's reporting tables.
	_tables() {
		return {
			monthly_usage: {
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
					['consumption', 'numeric', 'usage for the month, in consumption_unit'],
					['consumption_unit', 'text', 'unit of consumption, e.g. kWh, therms, gallons'],
					['cost', 'numeric', 'total charges in US dollars'],
					['cdd', 'numeric', 'cooling degree days for the month'],
					['hdd', 'numeric', 'heating degree days for the month']
				]
			},
			line_items: {
				about: 'Every line on every processed bill. One row per bill line. Use it for kinds of charges (supply, delivery, demand, taxes, fees, late fees, penalties), individual bills, rates and invoice dates. Dated by invoice, so its months do not match monthly_usage month by month.',
				cols: [
					['bill_id', 'integer', 'UBM bill id'],
					['invoice_date', 'date', 'bill statement date'],
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
				]
			},
			late_bills: {
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
				]
			}
		};
	},

	_sqlPrompt(question, history) {
		const f = appsmith.store.aiFacts || {};
		const tables = this._tables();
		const described = Object.keys(tables).map(name =>
			`${name}: ${tables[name].about}\n` +
			tables[name].cols.map(c => `- ${c[0]} (${c[1]})${c[2] ? ': ' + c[2] : ''}`).join('\n')
		).join('\n\n');
		const earlier = (history || []).length
			? `Earlier questions in this chat (the new question may follow on from them):\n${history.map(h => '- ' + h).join('\n')}\n\n`
			: '';
		return `You write one PostgreSQL query that answers a question about one company's utility bills.

There are exactly three tables, each already limited to this company:

${described}

What this company's data holds: months ${f.first_month || '?'} to ${f.last_month || '?'}, ${f.locations || '?'} locations, utilities (with units): ${f.utility_units || 'unknown'}. Charge categories on its bills: ${f.charge_categories || 'unknown'}.
Today is ${new Date().toISOString().slice(0, 10)}. "This year" and "last year" mean calendar years.
The user is this company: "my", "our", "we" and "us" in the question mean this company's data.

Rules:
- Return only the SQL, with no explanation and no markdown.
- One statement: SELECT, or WITH ... SELECT. Read only the three tables above; they can be joined on location_id. No semicolon, no comments.
- Pick the table that fits the question. Total cost and usage come from monthly_usage; breakdowns of a bill's charges come from line_items; late or missing bills come from late_bills.
- Never add consumption or quantities across different utilities or units: group by the utility and unit whenever you sum them. Dollars can be added across utilities.
- For anything per square foot, use only sites with square_feet of at least 500 (smaller values are placeholders), and return how many sites were left out in a separate column.
- Round dollars to 2 decimals and consumption to whole numbers.
- Name every output column in readable snake_case.
- Sort the result sensibly and return at most 100 rows. When the question asks for a top N, return exactly N rows.
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

	// The summary step also picks the chart, so a chart costs no extra AI call.
	// The chart is drawn from the database rows; the AI only names the columns.
	_explainPrompt(question, sql, rows) {
		const sample = JSON.stringify(rows.slice(0, 100));
		const cols = rows.length ? Object.keys(rows[0]).join(', ') : '(none)';
		return `You are a utility-billing analyst. Reply with JSON only (no markdown), in this shape:
{"answer": "...", "chart": null}
or
{"answer": "...", "chart": {"type": "bar", "x": "column", "y": ["column"], "series": null, "title": "...", "y_label": "..."}}

answer: 1 to 3 short sentences answering the question, using only the result below. The user is the company the data belongs to: speak to them about their own data ("your cost", "your locations"), never "this customer" or "the company". State units and use $ for costs. Do not invent numbers. If the result is empty, say no matching data was found. The result is shown to the user as a table and chart under your answer, so do not mention rows, queries, SQL or how much of the result you were given.

chart: how to plot the result, or null when a chart adds nothing (one row, a single value, text answers).
- Use only these result columns: ${cols}
- type "bar" for rankings and comparisons between categories; "line" for trends over time (x is the month or date column).
- x: the category or month column. y: one or more numeric columns measured in the same unit; never put dollars and usage on one chart, pick the one the question is about.
- series: when the result is long form (for example month, utility, value), the column whose values become separate bars or lines, with exactly one y column. Otherwise null.
- title: a short chart title that describes exactly what the result holds (say "top 10" only if it has 10 rows). y_label: the unit, for example "$", "kWh" or "therms".

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
				if (o && typeof o.answer === 'string') return { answer: o.answer.trim(), chart: o.chart || null };
			} catch (e) { /* not JSON: use the text as it is */ }
		}
		return { answer: t, chart: null };
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

	_cleanSql(text) {
		let s = String(text || '').replace(/```(?:sql)?/gi, '').trim();
		const start = s.search(/\b(with|select)\b/i);
		if (start > 0) s = s.slice(start);
		return s.replace(/;\s*$/, '').trim();
	},

	// The guard for AI-written SQL. The database login is read-only and the
	// tables are pre-filtered to the customer; this keeps the query to those
	// tables and to a single read statement.
	_checkSql(sql) {
		const s = String(sql || '').toLowerCase();
		if (!/^(select|with)\b/.test(s)) throw new Error('The AI did not return a SELECT query.');
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
