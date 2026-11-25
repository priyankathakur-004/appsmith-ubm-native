export default {
	// Correction Rules, step 1: find bills by any combination of conditions.
	//
	// The builder widget sends a rule; this object turns it into one read-only
	// SELECT and runs it. Bills are one row per bill_id built from the bill's
	// line items; observations (A, B, ...) are line items that must, or must
	// not, appear on the same bill. Only processed bills, no historical
	// (back-loaded) copies, one customer, one date range.
	//
	// Appsmith pastes {{ }} values straight into SQL here (prepared statements
	// are off), so every column name comes from fields() below and every typed
	// value is checked and quoted in _compile.

	// The fields the builder offers. options names a value list from the
	// values query (field = that name).
	fields() {
		return {
			bill: [
				{ id: 'bill_id', label: 'Bill ID', column: 'bill_id', type: 'number' },
				{ id: 'statement_date', label: 'Statement date', column: 'statement_date', type: 'date' },
				{ id: 'utility', label: 'Utility', column: 'utility', type: 'enum', options: 'utility' },
				{ id: 'vendor', label: 'Vendor', column: 'vendor', type: 'enum', options: 'vendor' },
				{ id: 'account', label: 'Account number', column: 'account', type: 'text' },
				{ id: 'location_name', label: 'Location', column: 'location_name', type: 'text' },
				{ id: 'line_count', label: 'Number of lines', column: 'line_count', type: 'number' },
				{ id: 'total_charges', label: 'Total of line charges', column: 'total_charges', type: 'number' }
			],
			obs: [
				{ id: 'code', label: 'Observation type (code)', column: 'code', type: 'enum', options: 'code' },
				{ id: 'uom', label: 'Unit of measure', column: 'uom', type: 'enum', options: 'uom' },
				{ id: 'usage', label: 'Quantity', column: 'usage', type: 'number' },
				{ id: 'charge', label: 'Charge ($)', column: 'charge', type: 'number' },
				{ id: 'category', label: 'Category', column: 'category', type: 'enum', options: 'category' },
				{ id: 'description', label: 'Description', column: 'description', type: 'text', options: 'description' },
				{ id: 'utility', label: 'Utility', column: 'utility', type: 'enum', options: 'utility' },
				{ id: 'vendor', label: 'Vendor', column: 'vendor', type: 'enum', options: 'vendor', hide: true }
			],
			ops: {
				text: ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'starts', 'empty', 'not_empty'],
				enum: ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'starts', 'empty', 'not_empty'],
				number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
				date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty']
			},
			opLabels: {
				eq: 'is equal to', neq: 'is not equal to', in: 'is any of', not_in: 'is none of',
				contains: 'contains', not_contains: 'does not contain', starts: 'starts with',
				gt: 'greater than', gte: 'greater than or equal to', lt: 'less than', lte: 'less than or equal to',
				between: 'is between', empty: 'is empty', not_empty: 'is not empty'
			}
		};
	},

	initPage() {
		getCustomers.run();
		fetch_cr_values.run();
	},

	async customerChanged() {
		await storeValue('selectedCustomerId', CustomerSelect.selectedOptionValue);
		await storeValue('crResult', null, false);
		await storeValue('crSql', null, false);
		fetch_cr_values.run();
	},

	// The query's run function, taken before the first await: Appsmith re-evaluates the page
	// while an async function waits, and a later lookup of .run can come back empty.
	_runner() {
		const q = run_cr_rule;
		const fn = q && q.run;
		if (typeof fn !== 'function') return () => { throw new Error('The query is not ready yet. Wait a moment and run again.'); };
		return fn.bind(q);
	},

	_cust() {
		return Number(CustomerSelect.selectedOptionValue || appsmith.store.selectedCustomerId) || 0;
	},

	// The two row sources, already limited to the customer and date range.
	_sources(cust, rule) {
		const day = /^\d{4}-\d{2}-\d{2}$/;
		const from = String((rule && rule.dateFrom) || '');
		const to = String((rule && rule.dateTo) || '');
		if (!day.test(from) || !day.test(to)) throw new Error('Pick both dates for "Bills dated"');
		if (from > to) throw new Error('"Bills dated" starts after it ends');
		const where = "li.customer_id = " + cust +
			" AND li.bill_type <> 'historical' AND li.workflow_state = 'processed'" +
			" AND li.statement_date >= DATE '" + from + "' AND li.statement_date < DATE '" + to + "' + 1";
		return {
			bill: "SELECT li.bill_id, MAX(li.statement_date)::date AS statement_date, MAX(UPPER(li.commodity)) AS utility," +
				" MAX(li.vendor_name) AS vendor, MAX(li.account_code) AS account, MAX(li.location_description) AS location_name," +
				" COUNT(*) AS line_count, SUM(li.charge) AS total_charges" +
				" FROM bill_management_v2.analytics_billing_line_items li WHERE " + where + " GROUP BY li.bill_id",
			obs: "SELECT li.bill_id, li.code, li.uom, li.usage, li.charge, li.category, li.description, UPPER(li.commodity) AS utility," +
				" li.statement_date::date AS statement_date, li.vendor_name AS vendor" +
				" FROM bill_management_v2.analytics_billing_line_items li WHERE " + where
		};
	},

	// rule -> { sql }. Throws a plain-English Error for anything it cannot build.
	_compile(rule, cust, limit) {
		const F = this.fields();
		const OPS = F.ops, LABEL = F.opLabels;
		const CMP = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
		const src = this._sources(cust, rule);
		const fail = msg => { throw new Error(msg); };
		const ident = s => /^[a-z_][a-z0-9_]*$/.test(s) ? s : fail('Bad column name: ' + s);

		const lit = (type, v, who) => {
			if (v === null || v === undefined || v === '') fail(who + ' needs a value');
			if (type === 'number') {
				const n = Number(v);
				if (v === true || v === false || !isFinite(n)) fail('"' + v + '" is not a number');
				return String(n);
			}
			if (type === 'date') {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) fail('"' + v + '" is not a date');
				return "DATE '" + v + "'";
			}
			return "'" + String(v).replace(/'/g, "''") + "'";
		};
		// the text inside a LIKE pattern, wildcards escaped so they match literally
		const likeBody = (v, who) => {
			if (v === null || v === undefined || v === '') fail(who + ' needs a value');
			return String(v).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/'/g, "''");
		};

		const aliases = (rule && rule.aliases) || [];
		const names = {};
		aliases.forEach(a => {
			if (!/^[A-D]$/.test(a.name) || names[a.name]) fail('Observation labels must be A to D, once each');
			names[a.name] = true;
		});

		const resolve = ref => {
			const s = String(ref || ''), dot = s.indexOf('.');
			if (dot < 0) fail('Pick a field for every condition, or remove the empty ones');
			const scope = s.slice(0, dot), id = s.slice(dot + 1);
			if (scope === 'bill') {
				const f = F.bill.find(x => x.id === id) || fail('Unknown bill field: ' + id);
				return { f, scope, sql: 'bl.' + ident(f.column) };
			}
			if (names[scope]) {
				const f = F.obs.find(x => x.id === id) || fail('Unknown observation field: ' + id);
				return { f, scope, sql: 'o_' + scope.toLowerCase() + '.' + ident(f.column) };
			}
			return fail('Unknown field: ' + s);
		};
		const kind = t => t === 'number' ? 'n' : t === 'date' ? 'd' : 't';

		const cond = c => {
			const L = resolve(c.field), t = L.f.type, col = L.sql;
			const who = (L.scope === 'bill' ? '' : L.scope + ' · ') + L.f.label;
			if (OPS[t].indexOf(c.op) < 0) fail('"' + (LABEL[c.op] || c.op || 'no operator') + '" does not apply to ' + who);
			const isText = t === 'text' || t === 'enum';
			if (c.op === 'empty') return isText ? '(' + col + " IS NULL OR " + col + "::text = '')" : col + ' IS NULL';
			if (c.op === 'not_empty') return isText ? '(' + col + " IS NOT NULL AND " + col + "::text <> '')" : col + ' IS NOT NULL';
			if (c.mode === 'field') {
				if (!CMP[c.op]) fail('Comparing two fields works with equal, not equal, greater and less only');
				const R = resolve(c.valueField);
				if (kind(t) !== kind(R.f.type)) fail(L.f.label + ' and ' + R.f.label + ' are different kinds of value');
				return col + ' ' + CMP[c.op] + ' ' + R.sql;
			}
			if (CMP[c.op]) return col + ' ' + CMP[c.op] + ' ' + lit(t, c.value, who);
			if (c.op === 'in' || c.op === 'not_in') {
				const vals = (Array.isArray(c.value) ? c.value : []).filter(v => v !== '' && v !== null && v !== undefined);
				if (!vals.length) fail('Choose at least one value for ' + who);
				return col + (c.op === 'in' ? ' IN (' : ' NOT IN (') + vals.map(v => lit(t, v, who)).join(', ') + ')';
			}
			if (c.op === 'between') {
				const v = Array.isArray(c.value) ? c.value : [];
				return col + ' BETWEEN ' + lit(t, v[0], who) + ' AND ' + lit(t, v[1], who);
			}
			if (c.op === 'contains') return col + "::text ILIKE '%" + likeBody(c.value, who) + "%'";
			if (c.op === 'not_contains') return '(' + col + ' IS NULL OR ' + col + "::text NOT ILIKE '%" + likeBody(c.value, who) + "%')";
			if (c.op === 'starts') return col + "::text ILIKE '" + likeBody(c.value, who) + "%'";
			return fail('Unsupported operator ' + c.op);
		};
		const scopes = c => [c.field, c.mode === 'field' ? c.valueField : null].filter(Boolean).map(r => String(r).split('.')[0]);

		// a row with no field picked yet is left out rather than blocking the run
		const blank = k => !k.conditions && !k.field;

		// nested groups, walked with a stack (no self-calls in a JSObject).
		// allowed(scope) says which fields this tree may use; badMsg is the error.
		const tree = (root, allowed, badMsg) => {
			const out = new Map();
			const stack = [{ node: root, depth: 0, seen: false }];
			while (stack.length) {
				const top = stack[stack.length - 1];
				const kids = (top.node.conditions || []).filter(k => !blank(k));
				if (top.depth > 4) fail('Groups can nest 4 levels deep at most');
				if (!top.seen) {
					top.seen = true;
					kids.forEach(k => { if (k.conditions) stack.push({ node: k, depth: top.depth + 1, seen: false }); });
					continue;
				}
				stack.pop();
				const parts = kids.map(k => {
					if (k.conditions) return out.get(k);
					scopes(k).forEach(s => !allowed(s) && fail(badMsg));
					return cond(k);
				}).filter(Boolean);
				const j = top.node.match === 'ANY' ? ' OR ' : ' AND ';
				out.set(top.node, !parts.length ? null : parts.length === 1 ? parts[0] : '(' + parts.join(j) + ')');
			}
			return out.get(root);
		};

		const top = tree(rule || {}, s => s === 'bill', 'Bill conditions can only use bill fields');
		const present = aliases.filter(a => a.mode !== 'not_exists');
		const absent = aliases.filter(a => a.mode === 'not_exists');
		const cross = ((rule && rule.cross) || []).filter(k => !blank(k));
		const aliasConds = a => {
			const sql = tree(a, s => s === a.name || s === 'bill', a.name + "'s conditions can only use " + a.name + ' and bill fields');
			return sql ? [sql] : [];
		};
		cross.forEach(c => scopes(c).forEach(s => s !== 'bill' && !present.some(a => a.name === s) &&
			fail('Compare only observations that must exist (' + s + ')')));
		if (cross.length && !present.length) fail('Add an observation that must exist before comparing observations');
		// two observations are different lines when any of these differ
		const rowCols = ['code', 'uom', 'usage', 'charge', 'category', 'description'];
		const row = x => '(' + rowCols.map(c => x + '.' + c).join(', ') + ')';
		const sqlName = a => 'o_' + a.name.toLowerCase();

		// WHERE parts. outer = the observation joined in the outer FROM (one
		// result row per matching line), or null for one row per bill. billId is
		// the outer bill id the other observations are tied to.
		const build = (outer, billId) => {
			const where = top ? [top] : [];
			const inside = present.filter(a => a !== outer);
			if (outer) aliasConds(outer).forEach(x => where.push(x));
			if (inside.length) {
				const al = inside.map(sqlName);
				const from = ['(' + src.obs + ') ' + al[0]];
				const inner = [al[0] + '.bill_id = ' + billId];
				for (let i = 1; i < al.length; i++) {
					from.push('JOIN (' + src.obs + ') ' + al[i] + ' ON ' + al[i] + '.bill_id = ' + al[0] + '.bill_id');
					for (let k = 0; k < i; k++) inner.push(row(al[i]) + ' IS DISTINCT FROM ' + row(al[k]));
				}
				if (outer) al.forEach(x => inner.push(row(x) + ' IS DISTINCT FROM ' + row(sqlName(outer))));
				inside.forEach(a => aliasConds(a).forEach(x => inner.push(x)));
				cross.forEach(c => inner.push(cond(c)));
				where.push('EXISTS (SELECT 1 FROM ' + from.join(' ') + ' WHERE ' + inner.join(' AND ') + ')');
			} else {
				cross.forEach(c => where.push(cond(c)));
			}
			absent.forEach(a => {
				const x = sqlName(a);
				const inner = [x + '.bill_id = ' + billId].concat(aliasConds(a));
				where.push('NOT EXISTS (SELECT 1 FROM (' + src.obs + ') ' + x + ' WHERE ' + inner.join(' AND ') + ')');
			});
			return where.length ? '\nWHERE ' + where.join('\n  AND ') : '';
		};
		const order = '\nORDER BY bl.statement_date DESC, bl.bill_id DESC';

		const cols = F.bill.map(f => 'bl.' + ident(f.column)).join(', ');
		const out = {
			sql: 'SELECT ' + cols + ', COUNT(*) OVER () AS total_matches\nFROM (' + src.bill + ') bl' +
				build(null, 'bl.bill_id') + order + '\nLIMIT ' + limit,
			obs: {},
			targets: []
		};
		// matching lines are listed for each observation a change applies to,
		// else for the first observation that must exist
		const wanted = ((rule && rule.changes) || []).map(c => c.target);
		out.targets = present.filter(a => wanted.indexOf(a.name) >= 0).map(a => a.name);
		if (!out.targets.length && present.length) out.targets = [present[0].name];
		if (rule && rule.listAll) out.targets = present.map(a => a.name);
		// the per-bill totals are only needed when some condition uses a bill field;
		// otherwise a line list reads the lines alone, which is much quicker
		const usesBill = /"bill\./.test(JSON.stringify([rule && rule.conditions, aliases, cross]));
		out.targets.forEach(name => {
			const t = present.find(a => a.name === name);
			const o = sqlName(t);
			const lineCols = rowCols.map(c => o + '.' + c).join(', ') + ', COUNT(*) OVER () AS total_matches';
			const inner = usesBill
				? 'SELECT bl.bill_id, bl.statement_date, bl.vendor, bl.utility, ' + lineCols + ', DENSE_RANK() OVER (ORDER BY bl.bill_id) AS bill_rank' +
					'\nFROM (' + src.bill + ') bl\nJOIN (' + src.obs + ') ' + o + ' ON ' + o + '.bill_id = bl.bill_id' + build(t, 'bl.bill_id')
				: 'SELECT ' + o + '.bill_id, ' + o + '.statement_date, ' + o + '.vendor, ' + o + '.utility, ' + lineCols + ', DENSE_RANK() OVER (ORDER BY ' + o + '.bill_id) AS bill_rank' +
					'\nFROM (' + src.obs + ') ' + o + build(t, o + '.bill_id');
			out.obs[name] = 'SELECT x.*, MAX(x.bill_rank) OVER () AS total_bills\nFROM (\n' + inner + '\n) x' +
				'\nORDER BY x.statement_date DESC, x.bill_id DESC, x.code\nLIMIT ' + limit;
		});
		return out;
	},

	_friendly(e) {
		const m = String((e && e.message) || e || '');
		if (/timed out|statement timeout|canceling statement|could not connect to our servers/i.test(m))
			return 'The search took too long. Narrow the "Bills dated" range or add a condition.';
		return m.slice(0, 400) || 'Something went wrong.';
	},

	// Builds the SQL without running it.
	async preview(rule) {
		try {
			const built = this._compile(rule, this._cust(), 500);
			await storeValue('crSql', { sql: built.sql, obs: built.obs, error: '' }, false);
		} catch (e) {
			await storeValue('crSql', { sql: '', error: this._friendly(e) }, false);
		}
	},

	async run(rule) {
		const cust = this._cust();
		const key = String((rule && rule.key) || '');
		const runSql = this._runner();
		if (!cust) return storeValue('crResult', { key: key, error: 'Pick a customer first.' }, false);
		let built;
		try {
			built = this._compile(rule, cust, 500);
		} catch (e) {
			await storeValue('crSql', { sql: '', error: this._friendly(e) }, false);
			return storeValue('crResult', { key: key, error: this._friendly(e) }, false);
		}
		await storeValue('crRule', rule);
		await storeValue('crSql', { sql: built.sql, obs: built.obs, error: '' }, false);
		await storeValue('crResult', { key: key, loading: true }, false);
		const t0 = Date.now();
		const total = rows => rows.length ? Number(rows[0].total_matches) || rows.length : 0;
		try {
			// one after the other: the same query object cannot run twice at once
			const rows = (await runSql({ sql: built.sql })) || [];
			const obs = {};
			for (let i = 0; i < built.targets.length; i++) {
				const name = built.targets[i];
				const list = rows.length ? ((await runSql({ sql: built.obs[name] })) || []) : [];
				obs[name] = { rows: list, total: total(list) };
			}
			await storeValue('crResult', {
				key: key,
				rows: rows,
				total: total(rows),
				obs: obs,
				targets: built.targets,
				ms: Date.now() - t0,
				cust: cust,
				ranAt: new Date().toISOString()
			}, false);
		} catch (e) {
			await storeValue('crResult', { key: key, error: this._friendly(e) }, false);
		}
	},

	// Runs the rules of one page (set = { key, rules: [{ id, rule }] }) and
	// fetches each rule's matching lines. Results land in crResult.parts[id].
	async runSet(set) {
		const cust = this._cust();
		const key = String((set && set.key) || '');
		const runSql = this._runner();
		if (!cust) return storeValue('crResult', { key: key, error: 'Pick a customer first.' }, false);
		const parts = (set && set.rules) || [];
		await storeValue('crResult', { key: key, loading: true }, false);
		const t0 = Date.now();
		const out = {};
		const sqls = {};
		try {
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				let built;
				try {
					built = this._compile(part.rule, cust, 500);
				} catch (e) {
					out[part.id] = { error: this._friendly(e) };
					continue;
				}
				const lines = {};
				try {
					// one after the other: the same query object cannot run twice at once
					for (let k = 0; k < built.targets.length; k++) {
						const name = built.targets[k];
						sqls[part.id + ' ' + name] = built.obs[name];
						const rows = (await runSql({ sql: built.obs[name] })) || [];
						lines[name] = {
							rows: rows,
							total: rows.length ? Number(rows[0].total_matches) || rows.length : 0,
							bills: rows.length ? Number(rows[0].total_bills) || 0 : 0
						};
					}
					out[part.id] = { lines: lines };
				} catch (e) {
					out[part.id] = { error: this._friendly(e) };
				}
			}
			await storeValue('crSql', { sql: '', obs: sqls, error: '' }, false);
			await storeValue('crResult', { key: key, parts: out, ms: Date.now() - t0, cust: cust, ranAt: new Date().toISOString() }, false);
		} catch (e) {
			// never leave the page stuck on Running
			await storeValue('crResult', { key: key, error: this._friendly(e) }, false);
		}
	},

	// Builds the line-list SQL of a page's rules without running it.
	async previewSet(set) {
		const cust = this._cust();
		const parts = (set && set.rules) || [];
		const sqls = {};
		try {
			parts.forEach(part => {
				const built = this._compile(part.rule, cust, 500);
				built.targets.forEach(name => { sqls[part.id + ' ' + name] = built.obs[name]; });
			});
			await storeValue('crSql', { sql: '', obs: sqls, error: '' }, false);
		} catch (e) {
			await storeValue('crSql', { sql: '', obs: {}, error: this._friendly(e) }, false);
		}
	}
}
