export default {
	// Demo scope: internal only, on the UBM Demo customer. The customer list
	// query holds the same id, so widen both together.
	defaultCustomer: 76013,

	// Rows kept for the on-screen table. The database side caps at 500.
	maxShownRows: 200,

	// The chat widget is the only consumer of this page's queries, and Appsmith
	// does not run on-load queries for a custom widget's model, so the small
	// on-mount init widget calls this.
	async initPage() {
		// Chat state is kept for this visit only (not persisted), so every load
		// starts clean.
		await storeValue('aiMessages', [], false);
		await storeValue('aiBusy', '', false);
		if (!Number(appsmith.store.aiCustomer)) await storeValue('aiCustomer', this.defaultCustomer);
		ai_customers.run();
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

	async pickCustomer(picked) {
		await storeValue('aiCustomer', Number(picked) || 0);
		await storeValue('aiMessages', [], false);
		await this.loadFacts();
	},

	async clearChat() {
		await storeValue('aiMessages', [], false);
	},

	// One question: the AI writes a SELECT on monthly_usage, we check it and run
	// it (one retry with the error if it fails), then the AI explains the rows.
	async ask(question) {
		const q = String(question || '').trim();
		if (!q || appsmith.store.aiBusy) return;
		const before = appsmith.store.aiMessages || [];
		const history = before.filter(m => m.role === 'user').slice(-3).map(m => m.text);
		const msgs = before.concat([{ role: 'user', text: q }]);
		await storeValue('aiMessages', msgs, false);

		const reply = { role: 'assistant', text: '', sql: '', columns: [], rows: [], rowCount: 0, error: '' };
		try {
			if (typeof AI_API === 'undefined') {
				throw new Error('The AI query (AI_API) is not set up on this page yet.');
			}
			await storeValue('aiBusy', 'Writing the query…', false);
			let sql = this._cleanSql(this._text(await AI_API.run({ prompt: this._sqlPrompt(q, history) })));
			let rows;
			try {
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql });
			} catch (first) {
				reply.sql = sql;
				await storeValue('aiBusy', 'Fixing the query…', false);
				sql = this._cleanSql(this._text(await AI_API.run({ prompt: this._fixPrompt(q, sql, this._msg(first)) })));
				reply.sql = sql;
				this._checkSql(sql);
				await storeValue('aiBusy', 'Running it on the data…', false);
				rows = await run_ai_sql.run({ sql });
			}
			rows = Array.isArray(rows) ? rows : [];
			reply.sql = sql;
			reply.rowCount = rows.length;
			reply.columns = rows.length ? Object.keys(rows[0]) : [];
			reply.rows = rows.slice(0, this.maxShownRows);

			await storeValue('aiBusy', 'Writing the answer…', false);
			reply.text = this._text(await AI_API.run({ prompt: this._explainPrompt(q, sql, rows) })).trim()
				|| 'The query ran, but the AI returned no explanation. See the table below.';
		} catch (e) {
			reply.error = this._msg(e);
			reply.text = "Sorry, I couldn't answer that one.";
		}
		await storeValue('aiMessages', msgs.concat([reply]), false);
		await storeValue('aiBusy', '', false);
	},

	// The one table the AI may query. run_ai_sql builds it from
	// reports_customer_monthly_usage, already limited to the picked customer.
	_columns() {
		return [
			['month', 'date', 'first day of the billing month'],
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
		];
	},

	_sqlPrompt(question, history) {
		const f = appsmith.store.aiFacts || {};
		const cols = this._columns().map(c => `- ${c[0]} (${c[1]})${c[2] ? ': ' + c[2] : ''}`).join('\n');
		const earlier = (history || []).length
			? `Earlier questions in this chat (the new question may follow on from them):\n${history.map(h => '- ' + h).join('\n')}\n\n`
			: '';
		return `You write one PostgreSQL query that answers a question about one company's utility bills.

There is exactly one table, monthly_usage, already limited to this company. One row per location + account + meter + utility + month. Columns:
${cols}

What this company's data holds: months ${f.first_month || '?'} to ${f.last_month || '?'}, ${f.locations || '?'} locations, utilities (with units): ${f.utility_units || 'unknown'}.
Today is ${new Date().toISOString().slice(0, 10)}. "This year" and "last year" mean calendar years.

Rules:
- Return only the SQL, with no explanation and no markdown.
- One statement: SELECT, or WITH ... SELECT. Read only monthly_usage. No semicolon, no comments.
- Never add consumption across different utilities or units: group by utility and consumption_unit whenever you sum consumption. Cost can be added across utilities.
- Round dollars to 2 decimals and consumption to whole numbers.
- Name every output column in readable snake_case.
- Sort the result sensibly and return at most 100 rows.
- If the table cannot answer the question, return exactly: SELECT 'not available in this data' AS answer

${earlier}Question: ${question}`;
	},

	_fixPrompt(question, sql, error) {
		return `${this._sqlPrompt(question, [])}

Your previous query was:
${sql}

It failed with: ${error}
Return a corrected query only.`;
	},

	_explainPrompt(question, sql, rows) {
		const sample = JSON.stringify(rows.slice(0, 40));
		return `You are a utility-billing analyst. Answer the user's question in 1 to 3 short sentences, using only the query result below.
State units and use $ for costs. Do not invent numbers. If the result is empty, say no matching data was found.

Question: ${question}
SQL that was run: ${sql}
Result (${rows.length} rows${rows.length > 40 ? ', first 40 shown' : ''}): ${sample}`;
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

	// The guard for AI-written SQL. The database login is read-only and
	// monthly_usage is pre-filtered to the customer; this keeps the query to that
	// one table and to a single read statement.
	_checkSql(sql) {
		const s = String(sql || '').toLowerCase();
		if (!/^(select|with)\b/.test(s)) throw new Error('The AI did not return a SELECT query.');
		if (s.includes(';')) throw new Error('Only one statement is allowed.');
		if (/--|\/\*|\{\{|\}\}/.test(s)) throw new Error('Comments are not allowed in the query.');
		const banned = s.match(/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|prepare|listen|notify|vacuum|lock|into|set|reset)\b|pg_|dblink|lo_import|current_setting|set_config/);
		if (banned) throw new Error(`"${banned[0]}" is not allowed in the query.`);
		const allowed = new Set(['monthly_usage', 'lateral', 'unnest', 'generate_series']);
		this._columns().forEach(c => allowed.add(c[0]));
		for (const m of s.matchAll(/(\w+)\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/g)) allowed.add(m[1]);
		for (const m of s.matchAll(/\b(?:from|join)\s+("?[\w.]+"?)/g)) {
			const t = m[1].replace(/"/g, '');
			if (!allowed.has(t) && !/^\d+$/.test(t)) throw new Error(`The query may only read monthly_usage, not "${t}".`);
		}
	},

	_msg(e) {
		return String((e && (e.message || e.responseMeta?.error?.message)) || e || 'Unknown error');
	}
}
