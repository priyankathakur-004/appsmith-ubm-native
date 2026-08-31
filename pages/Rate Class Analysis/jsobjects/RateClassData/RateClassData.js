export default {
	// =====================================================================
	// Rate Class Analysis
	//
	// Pick a customer and the page lists every electric account it has, with the
	// usage that would be priced. Nothing reaches the tariff API until the user
	// asks for it: Run prices one account, Run all prices the whole portfolio.
	// Listing the accounts is a single UBM query and returns in about a second,
	// where pricing them takes minutes — so which accounts are worth minutes is the
	// user's call, not the page's.
	//
	// A run prices each account's own last N months against every rate class its
	// serving utility publishes, compares that against what the account actually
	// paid, and exports the whole thing as an Excel workbook.
	//
	// The grain throughout is the PHYSICAL account (account_key from
	// RC_CustomerUsage), never the virtual account and never the bill type. In a
	// deregulated market UBM bills one meter twice — a Supply Only invoice from the
	// supplier and a Distribution Only invoice from the utility — and the two must
	// be assembled back into one account before anything is priced, or each half
	// gets compared against a bundled utility tariff it is not comparable to. See
	// the header of RC_CustomerUsage for how that key is built.
	//
	// All Genability calls go through fetch() so we never depend on the bound REST
	// queries or on hidden widgets.
	// =====================================================================

	// ---- Genability API config (Basic token shared with the REST datasource) ----
	_GENABILITY_BASE: "https://api.genability.com",
	_GENABILITY_AUTH: "Basic ZjVjOGRlNmYtZTYyMi00ZTY3LTljNjctN2Y0MDg3ODFmMDQ5OmNkZTk1ZTQwLWYxNDUtNGQzNy05ZTdiLWNhYzFkY2M1ZmRkYw==",

	// Cap the number of tariffs modeled for ONE account so a zip with hundreds of
	// tariffs can't lock up the browser. If we hit the cap we say so.
	_MAX_TARIFFS: 80,
	// How many Genability calc calls run concurrently for a single account.
	_CALC_CONCURRENCY: 6,

	// ---- Multi-account ("Run all") runs ----
	// Accounts analysed concurrently. Each one runs up to _PORTFOLIO_CALC_CONCURRENCY
	// calc calls, so in-flight Genability requests peak at the product of the two.
	_LOC_CONCURRENCY: 2,
	_PORTFOLIO_CALC_CONCURRENCY: 6,
	// Accounts are run in BATCHES, not capped. An earlier build stopped at 40
	// accounts, which quietly changed the answer for a large customer: the totals
	// covered a subset while reading as the whole portfolio. Batching keeps the tab
	// responsive and the API within its limits without dropping anything — every
	// eligible account is priced, however many there are.
	_BATCH_SIZE: 6,
	// A breather between batches so the tab can paint its progress and Genability
	// isn't hit in one unbroken stream.
	_BATCH_PAUSE_MS: 250,

	// =====================================================================
	// Dropdown option getters
	// =====================================================================
	// Reads from the store, never from the customer query's own result property.
	// Same reason as locationOptions: an object that both triggers a query and
	// reads back its result raises Appsmith's "Reactive dependency misuse" error,
	// which breaks evaluation of every function here, not just this one. The
	// initPage handler captures the run's RETURN value into the store instead.
	customerOptions() {
		const arr = appsmith.store.rc_customer_opts;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(c => ({ label: c.name, value: c.id }));
	},

	// Reads from the store rather than from the location query's own result
	// property: onCustomerChange triggers that query, and one entity both
	// triggering a query and reading it back is the "Reactive dependency misuse"
	// case that breaks evaluation of the whole object.
	// Leads with "All locations" because the dropdown narrows the account table
	// rather than choosing what to analyse — without a way back to everything, a
	// user who picks a location is stuck looking at part of the portfolio.
	locationOptions() {
		const arr = appsmith.store.rc_location_opts;
		const list = Array.isArray(arr) ? arr : [];
		return [{ label: "All locations", value: "" }]
			.concat(list.map(l => ({ label: l.name, value: l.id })));
	},

	// =====================================================================
	// Selection handlers
	// =====================================================================
	// Picking a customer loads the ACCOUNT INVENTORY and nothing else. This is the
	// whole point of the flow: one UBM query, about a second, and the user can see
	// every electric account with the usage that would be priced before deciding
	// what is worth spending minutes of tariff API time on. No pricing runs here.
	async onCustomerChange() {
		await RateClassData._clearRun();
		await storeValue("rc_inventory", []);
		await storeValue("rc_f_site", "");
		await storeValue("rc_f_vendor", "");
		await storeValue("rc_screen", 4);
		const res = await RC_fetchLocations.run();
		const arr = Array.isArray(res) ? res : ((res && (res.data || res.body)) || []);
		await storeValue("rc_location_opts", Array.isArray(arr) ? arr : []);
		await RateClassData.loadInventory();
	},

	// The location dropdown narrows the account list. It used to launch the
	// analysis, which is exactly the behaviour this flow removes: selecting
	// something should never start a run that takes minutes.
	async onLocationChange() {
		const id = (typeof RC_LocationSelect !== "undefined") ? RC_LocationSelect.selectedOptionValue : "";
		return storeValue("rc_f_location", id == null ? "" : String(id));
	},

	// Changing the term changes which months would be priced, so the inventory has
	// to be rebuilt on the new window — otherwise the table shows a 12-month figure
	// while the run would price 24.
	async onTermChange() {
		const t = (typeof RC_TermSelect !== "undefined") ? RC_TermSelect.selectedOptionValue : 12;
		await storeValue("rc_term", t);
		if ((appsmith.store.rc_inventory || []).length) await RateClassData.loadInventory();
	},

	// Everything a completed run wrote. Kept in one place so selecting a customer,
	// starting a run and resetting cannot drift apart and leave one customer's
	// results sitting under another customer's account list.
	//
	// Written non-persistently (the third argument): a portfolio run holds every
	// priced rate and its charge lines for every account, which is far more than
	// localStorage will take, and a persisted copy would also serve a stale result
	// back after a code change.
	async _clearRun() {
		await storeValue("rc_results", [], false);
		await storeValue("rc_usage", [], false);
		await storeValue("rc_all_tariffs", [], false);
		await storeValue("rc_meta", {}, false);
		await storeValue("rc_lineitems", null, false);
		await storeValue("rc_portfolio", [], false);
		await storeValue("rc_portfolio_meta", {}, false);
		await storeValue("rc_portfolio_lineitems", {}, false);
		await storeValue("rc_rates_by_acct", {}, false);
		await storeValue("rc_accounts", {}, false);
		await storeValue("rc_single_account", "", false);
		await storeValue("rc_status", "");
		await storeValue("rc_progress", "");
	},

	// =====================================================================
	// Genability fetch helpers
	// =====================================================================
	// Transient network failures are common enough against Genability that a single
	// attempt is not safe: a dropped call removes a rate from the ranking with no
	// trace, and if it was the cheapest the reported saving changes between runs.
	// Retries are spaced out rather than immediate because the usual causes (rate
	// limiting, a brief connection reset) do not clear instantly.
	_RETRIES: 3,
	_RETRY_BASE_MS: 400,

	async _withRetry(label, fn) {
		let last = null;
		for (let attempt = 0; attempt <= RateClassData._RETRIES; attempt++) {
			if (attempt > 0) {
				const wait = RateClassData._RETRY_BASE_MS * Math.pow(2, attempt - 1);
				await new Promise(res => setTimeout(res, wait));
			}
			try {
				const out = await fn();
				if (out && out.__retryable) { last = out.__retryable; continue; }
				return out;
			} catch (e) {
				last = (e && e.message) || String(e);
			}
		}
		await storeValue("rc_last_fetch_err", `${label} failed after ${RateClassData._RETRIES + 1} attempts: ${last}`);
		return { __failed: last || "unknown error" };
	},

	async _fetchLses(zip) {
		const out = await RateClassData._withRetry(`/lses ${zip}`, async () => {
			const url = `${RateClassData._GENABILITY_BASE}/rest/public/lses?zipCode=${encodeURIComponent(zip)}&serviceTypes=ELECTRICITY`;
			const res = await fetch(url, {
				method: "GET",
				headers: { "Authorization": RateClassData._GENABILITY_AUTH, "Accept": "application/json" }
			});
			// 5xx and 429 are worth another attempt; a 4xx will not fix itself.
			if (!res.ok) {
				if (res.status >= 500 || res.status === 429) return { __retryable: `HTTP ${res.status}` };
				return { __failed: `HTTP ${res.status} from /lses` };
			}
			const data = await res.json();
			const arr = (data && (data.results || data.data)) || [];
			return Array.isArray(arr) ? arr : [];
		});
		if (out && out.__failed) return [];
		return Array.isArray(out) ? out : [];
	},

	// Pull every active electric tariff for the LSE. Genability caps a page at
	// 100, and large IOUs have far more (PG&E ~600 active, ConEd ~200), so we
	// paginate via pageStart until a short page comes back — otherwise we'd
	// silently miss rate classes for big utilities. effectiveOn=today restricts
	// to currently-active schedules (excludes the thousands of historical ones).
	async _fetchTariffs(lseId, zip) {
		const pageSize = 100;
		const maxPages = 12; // safety backstop (~1200 tariffs/LSE)
		const today = moment().format("YYYY-MM-DD");
		const all = [];
		for (let page = 0; page < maxPages; page++) {
			const params = [
				`lseId=${encodeURIComponent(lseId)}`,
				`zipCode=${encodeURIComponent(zip)}`,
				`serviceTypes=ELECTRICITY`,
				`effectiveOn=${today}`,
				`populateProperties=true`,
				`pageStart=${page * pageSize}`,
				`pageCount=${pageSize}`
			].join("&");
			const got = await RateClassData._withRetry(`/tariffs lse ${lseId} page ${page}`, async () => {
				const res = await fetch(`${RateClassData._GENABILITY_BASE}/rest/public/tariffs?${params}`, {
					method: "GET",
					headers: { "Authorization": RateClassData._GENABILITY_AUTH, "Accept": "application/json" }
				});
				if (!res.ok) {
					if (res.status >= 500 || res.status === 429) return { __retryable: `HTTP ${res.status}` };
					return { __failed: `HTTP ${res.status} from /tariffs (lse ${lseId})` };
				}
				const data = await res.json();
				return (data && (data.results || data.data)) || [];
			});
			// A page that never came back would silently shorten the tariff list, so
			// stop rather than pretend the list is complete.
			if (got && got.__failed) { all.__incomplete = true; break; }
			const arr = got;
			if (!Array.isArray(arr) || arr.length === 0) break;
			for (const t of arr) all.push(t);
			if (arr.length < pageSize) break; // last page
		}
		return all;
	},

	async _calcTariff(tariff, body) {
		const out = await RateClassData._withRetry(`/calculate ${tariff.masterTariffId}`, async () => {
			const res = await fetch(`${RateClassData._GENABILITY_BASE}/rest/public/calculate/${tariff.masterTariffId}`, {
				method: "POST",
				headers: {
					"Authorization": RateClassData._GENABILITY_AUTH,
					"Content-Type": "application/json",
					"Accept": "application/json"
				},
				body: JSON.stringify(body)
			});
			let data;
			try { data = await res.json(); } catch (_) { data = null; }
			if (!res.ok) {
				if (res.status >= 500 || res.status === 429) return { __retryable: `HTTP ${res.status}` };
				const errMsg = data ? JSON.stringify(data).slice(0, 300) : `HTTP ${res.status}`;
				return { __failed: `HTTP ${res.status}: ${errMsg}` };
			}
			return data;
		});
		if (out && out.__failed) return RateClassData._normalizeCalcResponse({ __error: out.__failed }, tariff);
		return RateClassData._normalizeCalcResponse(out, tariff);
	},

	// Build a single annual /calculate body: one consumption (and demand) input
	// per month. Genability sums the per-month charges into results[0].totalCost,
	// so we get a full-year modeled bill from ONE request per tariff.
	_buildAnnualBody(months) {
		const sorted = months.slice().sort((a, b) => (a.month < b.month ? -1 : 1));
		const from = moment(sorted[0].month).startOf("month").format("YYYY-MM-DDTHH:mm:ss");
		const to = moment(sorted[sorted.length - 1].month).endOf("month").format("YYYY-MM-DDTHH:mm:ss");
		const inputs = [];
		for (const m of sorted) {
			const mStart = moment(m.month).startOf("month").format("YYYY-MM-DDTHH:mm:ss");
			const mEnd = moment(m.month).endOf("month").format("YYYY-MM-DDTHH:mm:ss");
			inputs.push({ keyName: "consumption", fromDateTime: mStart, toDateTime: mEnd, unit: "kWh", dataValue: String(m.kwh) });
			if (m.kw > 0) {
				inputs.push({ keyName: "demand", fromDateTime: mStart, toDateTime: mEnd, unit: "kW", dataValue: String(m.kw) });
			}
		}
		return { fromDateTime: from, toDateTime: to, tariffInputs: inputs };
	},

	// =====================================================================
	// Applicability filtering
	// =====================================================================
	// Keep tariffs whose monthly kWh / kW applicability windows contain this
	// location's average monthly consumption and peak demand. Tariffs with no
	// declared range are always kept (can't rule them out). We also keep ONLY the
	// GENERAL customer class and drop RESIDENTIAL + SPECIAL_USE — regardless of how
	// small the site's usage is. Every UBM customer is a commercial/industrial
	// account, so a business can't enroll on a residential tariff (incl.
	// low-income/assistance rates like "Residential - Low Income", which are
	// income-qualified and would otherwise show as a bogus "best" for a tiny
	// telecom site) or on special-use rates (street lighting, agricultural, EV,
	// standby). A usage threshold misclassifies small commercial sites (telecom
	// cabinets, small offices) as residential-eligible, so we don't gate on it.
	_filterApplicable(rows, months) {
		const n = months.length || 1;
		const avgKwh = months.reduce((s, m) => s + m.kwh, 0) / n;
		const peakKw = months.reduce((mx, m) => Math.max(mx, m.kw), 0);
		return (rows || []).filter(t => {
			if (t.serviceType && t.serviceType !== "ELECTRICITY") return false;
			const cc = String(t.customerClass || "").toUpperCase();
			if (cc && cc !== "GENERAL") return false; // drop RESIDENTIAL + SPECIAL_USE
			const r = RateClassData._readApplicabilityRanges(t);
			if (r.minKWh != null && avgKwh < r.minKWh) return false;
			if (r.maxKWh != null && avgKwh > r.maxKWh) return false;
			if (r.minKW != null && peakKw < r.minKW) return false;
			if (r.maxKW != null && peakKw > r.maxKW) return false;
			return true;
		});
	},

	_readApplicabilityRanges(t) {
		const out = { minKWh: null, maxKWh: null, minKW: null, maxKW: null };
		if (!t) return out;
		const props = Array.isArray(t.properties) ? t.properties : [];
		const byKey = {};
		for (const p of props) { if (p && p.keyName) byKey[p.keyName] = p; }
		const readNum = (p) => {
			if (!p) return null;
			const v = (p.dataValue != null) ? p.dataValue : p.value;
			if (v == null || v === "") return null;
			const num = Number(v);
			return isNaN(num) ? null : num;
		};
		out.minKWh = readNum(byKey.minimumApplicableKWh) ?? readNum(byKey.minimumMonthlyConsumption);
		out.maxKWh = readNum(byKey.maximumApplicableKWh) ?? readNum(byKey.maximumMonthlyConsumption);
		out.minKW  = readNum(byKey.minimumApplicableKW)  ?? readNum(byKey.minimumDemand);
		out.maxKW  = readNum(byKey.maximumApplicableKW)  ?? readNum(byKey.maximumDemand);
		return out;
	},

	// =====================================================================
	// Concurrency helper — run fn over items, at most `limit` in flight.
	// =====================================================================
	async _mapLimit(items, limit, fn) {
		const out = new Array(items.length);
		let next = 0;
		const worker = async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		};
		const workers = [];
		const w = Math.min(limit, items.length);
		for (let k = 0; k < w; k++) workers.push(worker());
		await Promise.all(workers);
		return out;
	},

	// =====================================================================
	// Result getters for the widgets
	// =====================================================================
	resultsRows() {
		const arr = appsmith.store.rc_results;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(r => ({
			rank: r.rank || "",
			best: r.isBest ? "★" : "",
			utility: r.lseName,
			tariff: r.tariffName,
			code: r.tariffCode,
			tou: !!r.isTOU,
			da: !!r.isDA,
			rtp: !!r.isRTP,
			modeled_annual: r.modeledAnnualCost == null ? null : Number(r.modeledAnnualCost.toFixed(2)),
			modeled_energy: r.modeledEnergy == null ? null : Number(r.modeledEnergy.toFixed(2)),
			modeled_demand: r.modeledDemand == null ? null : Number(r.modeledDemand.toFixed(2)),
			actual_annual: r.actualAnnualCost == null ? null : Number(r.actualAnnualCost.toFixed(2)),
			// Suppress savings for non-comparable rates — the numbers are real but not
			// comparable (a near-zero supplemental bill, or a TX delivery-only tariff
			// missing its competitive energy component, isn't a switchable full bill).
			annual_savings: (r.nonService || r.deliveryOnly || r.demandIncomplete || r.annualSavings == null) ? null : Number(r.annualSavings.toFixed(2)),
			savings_pct: (r.nonService || r.deliveryOnly || r.demandIncomplete || r.savingsPct == null) ? null : Number(r.savingsPct.toFixed(1)),
			status: r.error ? "Error" : (r.deliveryOnly ? "Delivery only" : (r.nonService ? "Not full-service" : (r.demandIncomplete ? "No demand charge" : "OK"))),
			masterTariffId: r.masterTariffId
		}));
	},

	bestRecommendation() {
		const arr = appsmith.store.rc_results;
		const list = Array.isArray(arr) ? arr : [];
		return list.find(r => r.isBest) || null;
	},

	usageRows() {
		const arr = appsmith.store.rc_usage;
		return Array.isArray(arr) ? arr : [];
	},

	// Every tariff Arcadia returned for the location, tagged by type and whether
	// it was modeled — feeds the "all tariffs returned" view.
	allTariffsRows() {
		const arr = appsmith.store.rc_all_tariffs;
		return Array.isArray(arr) ? arr : [];
	},

	analysisSummary() {
		const m = appsmith.store.rc_meta || {};
		if (!m.zip) return "";
		const best = RateClassData.bestRecommendation();
		const parts = [];
		parts.push(`${m.locationName || ""} (zip ${m.zip})`);
		const money = (v) => "$" + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		parts.push(`Actual ${m.monthCount}-mo cost: ${money(m.actualAnnual)}`);
		// "0/4 modeled" reads as a failure to price anything. All four priced; none
		// was comparable, which is a different statement and the one that matters.
		parts.push(m.modeledCount
			? `${m.tariffCount} rate class(es) priced, ${m.modeledCount} comparable`
			: `${m.tariffCount} rate class(es) priced, none comparable to a bundled bill`);
		if (best) {
			parts.push(`Best: ${best.tariffName} — save ${money(best.annualSavings)} (${best.savingsPct.toFixed(1)}%)`);
		} else if (m.demandSuspect) {
			parts.push("Recommendation withheld — demand (kW) data unreliable");
		} else {
			parts.push("No rate beats the current cost");
		}
		if (m.nonServiceCount) parts.push(`${m.nonServiceCount} non-full-service rate(s) excluded`);
		if (m.deliveryOnlyCount) parts.push(`${m.deliveryOnlyCount} delivery-only (deregulated) rate(s) excluded`);
		if (m.demandIncompleteCount) parts.push(`${m.demandIncompleteCount} no-demand-charge rate(s) excluded (load is demand-metered)`);
		if (m.demandMissing) parts.push(`⚠ ${m.demandMissingMonths} month(s) show 0 kW despite significant usage — demand charges under-modeled, so modeled costs & savings are unreliable (informational only)`);
		if (m.demandSpikeMonths) parts.push(`⚠ ${m.demandSpikeMonths} month(s) show an impossibly high kW vs. usage (bad demand reading) — demand charges over-modeled, so modeled costs & savings are unreliable (informational only)`);
		if (m.demandUnderMonths) parts.push(`⚠ ${m.demandUnderMonths} month(s) show a kW far too low for the usage (load factor > 100%, bad reading) — demand charges under-modeled, so modeled costs & savings are unreliable (informational only)`);
		if (m.erroredCount) parts.push(`⚠ ${m.erroredCount} rate(s) could not be priced after retries and are excluded — the cheapest rate shown may not be the cheapest available`);
		if (m.utilityUnmatched) parts.push(`⚠ the bill names ${m.servingUtility} as the utility, which serves no tariffs in zip ${m.zip} — the rates priced belong to ${(m.lseNames || []).join(", ")} instead. In a deregulated market that is expected (the bill comes from a retail supplier, the tariffs from the wires company), but check the two describe the same service before quoting a figure`);
		if (m.tariffListIncomplete) parts.push("⚠ the tariff list came back incomplete — some rate classes may be missing");
		if (m.truncated) parts.push(`(capped at ${RateClassData._MAX_TARIFFS} tariffs)`);
		if (m.stale && m.dataThrough) parts.push(`⚠ usage data ends ${m.dataThrough} — stale, modeled on current rates`);
		return parts.join("  •  ");
	},

	// =====================================================================
	// Small shared utilities (kept from the original)
	// =====================================================================
	_pickNum(obj, keys) {
		if (!obj) return null;
		for (const k of keys) {
			const v = obj[k];
			if (v == null || v === "") continue;
			const n = Number(v);
			if (isFinite(n)) return n;
		}
		return null;
	},
	_pickStr(obj, keys) {
		if (!obj) return "";
		for (const k of keys) {
			const v = obj[k];
			if (v != null && v !== "") return String(v);
		}
		return "";
	},
	_serviceLabel(s) {
		if (!s) return "";
		const m = { ELECTRICITY: "Electricity", GAS: "Gas", SOLAR_PV: "Solar" };
		return m[s] || s;
	},

	// Is this country value the United States? (Genability only covers U.S.)
	// Empty/unknown is treated as U.S. so we don't block legacy rows with no
	// country set. Normalizes "U.S.A.", "United States", etc.
	_isUSCountry(c) {
		const v = String(c || "").trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
		if (!v) return true;
		return ["US", "USA", "U S", "U S A", "UNITED STATES", "UNITED STATES OF AMERICA", "AMERICA"].indexOf(v) >= 0;
	},
	// Is this a Texas/ERCOT delivery-only "wires" utility (TDU)? Their published
	// tariffs are delivery charges only — in a deregulated market the customer buys
	// energy from a competitive retailer, which Genability doesn't have — so their
	// modeled bill isn't comparable to a bundled actual bill. Matched by name
	// precisely so full-service same-name utilities elsewhere aren't caught (e.g.
	// "CenterPoint Energy Indiana" is full-service; only the Houston TDU is wires-only).
	_isDeliveryOnlyTDU(lseName) {
		const n = String(lseName || "").toLowerCase();
		if (n.indexOf("oncor") >= 0) return true;
		if (n.indexOf("aep texas") >= 0) return true;
		if (n.indexOf("texas-new mexico") >= 0 || n.indexOf("texas new mexico") >= 0 || /\btnmp\b/.test(n)) return true;
		if (n.indexOf("centerpoint") >= 0 && n.indexOf("houston") >= 0) return true;
		return false;
	},
	_displayUnitFor(quantityUnit, quantityKey) {
		if (quantityUnit) return String(quantityUnit);
		const key = String(quantityKey || "").toLowerCase();
		if (key === "consumption") return "kWh";
		if (key === "demand") return "kW";
		return "";
	},

	// Reduce a Genability calc response to a total + grouped line items.
	_normalizeCalcResponse(res, tariff) {
		const result = (res && res.results && res.results[0]) || res || {};
		const items = Array.isArray(result.items) ? result.items : [];
		const groups = new Map();
		// Split the bill into energy / demand / other so the comparison can show
		// WHERE a rate's cost comes from (demand charges are usually the swing
		// factor vs. a customer's actual/negotiated rate).
		let energyCost = 0, demandCost = 0, otherCost = 0;
		for (const it of items) {
			const name = RateClassData._pickStr(it, ["chargeName", "rateGroupName", "name"]);
			if (!name) continue;
			const cost = RateClassData._pickNum(it, ["itemCost", "cost", "totalCost"]) ?? 0;
			const qty = RateClassData._pickNum(it, ["quantity", "itemQuantity", "qty", "quantityValue", "dataValue", "chargePeriodQuantity", "value"]) ?? 0;
			const rawUnit = RateClassData._pickStr(it, ["quantityUnit", "unit", "uom"]);
			const qtyKey = RateClassData._pickStr(it, ["quantityKey", "chargePeriodKey"]);
			const unit = RateClassData._displayUnitFor(rawUnit, qtyKey);
			const rate = RateClassData._pickNum(it, ["rate", "itemRate", "chargePeriodRate", "unitCost", "rateValue"]);

			// Classify by the charge's billing basis.
			const k = (qtyKey || "").toLowerCase();
			const u = (unit || "").toLowerCase();
			if (k === "consumption" || u === "kwh") energyCost += cost;
			else if (k.indexOf("demand") >= 0 || u === "kw") demandCost += cost;
			else otherCost += cost;

			const groupKey = name + "|" + (qtyKey || unit || "");
			const g = groups.get(groupKey) || { name, qty: 0, qty_unit: unit, cost: 0, rateSum: 0, rateCount: 0 };
			g.qty += qty;
			g.cost += cost;
			if (rate != null && rate !== 0) { g.rateSum += rate; g.rateCount += 1; }
			if (!g.qty_unit && unit) g.qty_unit = unit;
			groups.set(groupKey, g);
		}
		const lines = Array.from(groups.values()).map(g => {
			let rate = 0;
			if (g.qty !== 0) rate = g.cost / g.qty;
			else if (g.rateCount > 0) rate = g.rateSum / g.rateCount;
			return { name: g.name, qty: g.qty, qty_unit: g.qty_unit, rate: rate, cost: g.cost };
		});
		return {
			masterTariffId: tariff && tariff.masterTariffId,
			tariffName: tariff && tariff.tariffName,
			tariffCode: tariff && tariff.tariffCode,
			lseName: tariff && tariff.lseName,
			serviceType: RateClassData._serviceLabel(tariff && tariff.serviceType),
			adjustedTotalCost: Number(result.totalCost != null ? result.totalCost : (result.adjustedTotalCost || 0)),
			subTotalCost: Number(result.subTotalCost != null ? result.subTotalCost : (result.totalCost || 0)),
			taxCost: Number(result.taxCost || 0),
			energyCost: energyCost,
			demandCost: demandCost,
			otherCost: otherCost,
			lines: lines,
			error: res && res.__error ? res.__error : null
		};
	},


	// =====================================================================
	// Shared per-location pipeline (steps 2-5)
	// =====================================================================
	// Takes ONE location's 12-month profile and returns the ranked rate list +
	// meta, or { error } — it never writes to the store, so the single-location
	// screen and the portfolio run can share it without fighting over rc_*.
	//
	//   months  – newest-first [{ month, kwh, kw, actual }]
	//   ctx     – { zip, locationName, actualAnnual, monthCount }
	//   cache   – per-run { lses: {}, tariffs: {} }; a customer whose sites share
	//             a utility then pays for the LSE/tariff lookup only once
	//   opts    – { concurrency, onProgress, onNote }
	async _analyzeLocation(months, ctx, cache, opts) {
		const zip = ctx.zip;
		const locationName = ctx.locationName;
		const actualAnnual = ctx.actualAnnual;
		const monthCount = ctx.monthCount;
		const o = opts || {};
		const concurrency = o.concurrency || RateClassData._CALC_CONCURRENCY;
		const report = async (m) => { if (o.onProgress) await o.onProgress(m); };
		const note = async (m) => { if (o.onNote) await o.onNote(m); };
		// --- 2. Look up serving utilities (LSEs) for the zip ---
		await report("Finding utilities for zip " + zip + "…");
		let lses = await RateClassData._cachedLses(zip, cache);
		// /lses returns more than utilities: state incentive programmes are carried
		// as pseudo-LSEs in the same list ("State of Texas Incentives" came back
		// alongside CenterPoint for 77049). They publish no retail service, so
		// pricing them is meaningless, and naming them in the unmatched-utility
		// warning made it read as though two companies served the site.
		lses = lses.filter(l => !/\bincentive/i.test(String(l && l.name || "")));
		// A ZIP is almost never served by one utility: Genability also returns the
		// rural co-ops and munis whose territory overlaps it, plus state incentive
		// "LSEs". A site cannot switch to a co-op — co-ops serve a defined membership
		// territory — so pricing their schedules alongside the incumbent's produces a
		// cheapest-rate winner the customer could never buy. When the caller knows who
		// actually serves the account (the vendor on the bill), keep only that LSE.
		if (ctx.servingUtility) {
			const want = RateClassData._normUtility(ctx.servingUtility);
			const hit = lses.filter(l => {
				const have = RateClassData._normUtility(l.name);
				return have === want || have.indexOf(want) >= 0 || want.indexOf(have) >= 0;
			});
			// Only narrow on a match. An unrecognised vendor name must not silently
			// empty the list — better to model every LSE and say so than to model none.
			if (hit.length) lses = hit;
		}
		if (!lses.length) {
			const fe = appsmith.store.rc_last_fetch_err;
			const msg = `Step 2: Genability /lses returned no utilities for zip ${zip}. ${fe ? "Fetch error: " + fe : "(If this is a CORS/network block, the Genability API may not be reachable from the browser.)"}`;
			return { error: msg, alert: "No utilities found for zip " + zip };
		}
		await note(`Step 2 OK: ${lses.length} utility/utilities for zip ${zip}.`);

		// --- 3. Pull every electric tariff across those LSEs, dedupe ---
		await report("Loading tariffs…");
		const tariffLists = await Promise.all(
			lses.map(lse => RateClassData._cachedTariffs(lse.lseId, zip, cache))
		);
		const byMtid = {};
		for (const list of tariffLists) {
			for (const t of list) {
				if (t && t.masterTariffId != null) byMtid[t.masterTariffId] = t;
			}
		}
		const allTariffs = Object.values(byMtid);

		// Genability's /tariffs returns EVERY record for the LSE: real rate
		// schedules AND riders/surcharges/add-ons (TCJA credit, smart-meter
		// rider, transmission service charge, etc.). Modeling a rider alone is
		// meaningless (it's one line, sometimes a credit → negative "bill"),
		// so keep only actual rate classes: DEFAULT (the standard rate) and
		// ALTERNATIVE (optional schedules a customer could switch to — these
		// are the commercial / General Power / large-power rates). NOTE:
		// Genability spells it "ALTERNATIVE", not "ALTERNATE"; matching the
		// wrong spelling silently drops every commercial rate and leaves only
		// the single Residential DEFAULT. RIDER / OPTIONAL_EXTRA are surcharges.
		const rateClasses = allTariffs.filter(t => {
			const tt = String(t && t.tariffType || "").toUpperCase();
			if (tt !== "DEFAULT" && tt !== "ALTERNATIVE" && tt !== "ALTERNATE") return false;
			// Drop rates not open to new enrollment — not options a customer could
			// switch to. Large IOUs carry hundreds of legacy "(Closed)" rates, and
			// "Grandfathered" rates are only kept by existing customers.
			const nm = String(t && t.tariffName || "").toLowerCase();
			if (nm.indexOf("closed") >= 0 || nm.indexOf("grandfathered") >= 0) return false;
			// Drop special-purpose EV-charging-infrastructure rates. These come
			// back GENERAL-classed (so the customerClass filter misses them) but a
			// hospital/office/plant can't take a "Public Electric Vehicle Charging"
			// rate — it models cheap (no demand) and would win as a bogus "best".
			// Utilities name these several ways: "Public Electric Vehicle Charging",
			// "EV Public Charging", "EV Level 3 DC Fast Charger", etc. Match the "EV"
			// abbreviation only as a whole word AND alongside a charging context, so
			// legitimate rates ("Level"/"Development") aren't caught by accident.
			// Unmetered schedules exist for street lighting, signage and similar fixed
			// loads billed on assumed usage. They model cheap because they carry no
			// demand component, so on a metered account they win as a bogus "best" —
			// seen taking the top slot on 5,980 kWh and 71,700 kWh accounts alike.
			// A site with a meter reading cannot take one.
			if (/\bunmeter(ed)?\b/.test(nm)) return false;
			const isEvCharging = nm.indexOf("electric vehicle") >= 0
				|| nm.indexOf("vehicle charging") >= 0
				|| (/\bev\b/.test(nm) && (/charg/.test(nm) || /\bdc fast\b/.test(nm) || /fast charger/.test(nm)));
			if (isEvCharging) return false;
			if (t && t.isActive === false) return false;
			return true;
		});
		const ridersDropped = allTariffs.length - rateClasses.length;

		// Collapse economically-identical variants of the same rate: net-metering
		// (NEM 2.0/3.0, "Net Metering") and fuel-mix labels ("Renewable and
		// Non-Renewable Resources"/-RNR). Without on-site generation these model
		// the same, so they're duplicate rows that burn calc calls and crowd out
		// distinct rates under the cap. Key = tariff name with those qualifier
		// phrases stripped (keeps "Direct Access", "Time of Use", voltage tiers,
		// etc. distinct — those genuinely change the cost).
		const seenNorm = {};
		const dedupedClasses = [];
		for (const t of rateClasses) {
			const norm = String(t && t.tariffName || "")
				.replace(/\bnet metering\b/gi, "")
				.replace(/\brenewable and non-?renewable resources\b/gi, "")
				.replace(/\(?\s*NEM\s*\d?(?:\.\d)?\s*\)?/gi, "")
				.replace(/[,\-]\s*(?:RNR|NEM)\b/gi, "")
				.replace(/[\s,\-]+$/g, "")
				.replace(/\s+/g, " ").trim().toLowerCase();
			if (seenNorm[norm]) continue;
			seenNorm[norm] = true;
			dedupedClasses.push(t);
		}

		// Then keep only those whose applicability ranges fit this location's
		// typical monthly usage (drops e.g. large-demand-only rates).
		let tariffs = RateClassData._filterApplicable(dedupedClasses, months);
		// Sort by customerCount (how many customers are actually on the rate)
		// so when we cap we model the MAINSTREAM rates, not an arbitrary first-N.
		// Big IOUs can still have >80 applicable rate classes after filtering.
		tariffs.sort((a, b) => (Number(b.customerCount) || 0) - (Number(a.customerCount) || 0));
		let truncated = false;
		if (tariffs.length > RateClassData._MAX_TARIFFS) {
			truncated = true;
			tariffs = tariffs.slice(0, RateClassData._MAX_TARIFFS);
		}
		if (!tariffs.length) {
			const msg = `Step 3: pulled ${allTariffs.length} tariff record(s); ${rateClasses.length} were rate classes (dropped ${ridersDropped} riders/surcharges) but 0 matched this usage profile after applicability filtering. ${rateClasses.length === 0 ? "(No DEFAULT/ALTERNATE rate schedules found for this LSE/zip.)" : "Try relaxing the applicability filter."}`;
			return { error: msg, alert: "No applicable electric rate classes for this usage profile" };
		}
		await note(`Step 3 OK: ${tariffs.length} rate class(es) to model (dropped ${ridersDropped} riders/surcharges/closed & off-class rates).`);

		// Tag the FULL returned set for the "all tariffs" view (Sunny wants to
		// see everything Arcadia returned, not just what we model). Ranking
		// still uses only the modeled rate classes; this list is display-only.
		const modeledIds = {};
		for (const t of tariffs) modeledIds[t.masterTariffId] = true;
		const allTariffsTagged = allTariffs.map(t => {
			const tt = String(t && t.tariffType || "").toUpperCase();
			const isRateClass = (tt === "DEFAULT" || tt === "ALTERNATIVE" || tt === "ALTERNATE");
			return {
				utility: t.lseName || "",
				code: t.tariffCode || "",
				name: t.tariffName || "",
				type: t.tariffType || "",
				category: isRateClass ? "Rate Class" : (tt === "RIDER" ? "Rider/Surcharge" : (t.tariffType || "Other")),
				customerClass: t.customerClass || "",
				tou: !!t.hasTimeOfUseRates,
				da: /direct access/i.test(String(t.tariffName || "")),
				rtp: /hourly pricing|real[\s-]?time|day[\s-]?ahead|\brtp\b/i.test(String(t.tariffName || "")),
				modeled: !!modeledIds[t.masterTariffId]
			};
		}).sort((a, b) => {
			// Rate classes first, modeled ones at the very top, then by name.
			const rank = (r) => (r.category === "Rate Class" ? (r.modeled ? 0 : 1) : 2);
			const d = rank(a) - rank(b);
			return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
		});
		// Returned rather than stored: the portfolio run holds one of these per
		// location, so only the single-location screen writes it to the store.

		// --- 4. Model an annual bill for each tariff (1 call each, throttled) ---
		let done = 0;
		const total = tariffs.length;
		const modelOne = async (t) => {
			const body = RateClassData._buildAnnualBody(months);
			const block = await RateClassData._calcTariff(t, body);
			done += 1;
			if (done % concurrency === 0 || done === total) {
				await report(`Modeling rates… ${done}/${total}`);
			}
			const modeled = block.error ? null : Number(block.adjustedTotalCost || 0);
			const savings = (modeled == null) ? null : (actualAnnual - modeled);
			return {
				masterTariffId: t.masterTariffId,
				tariffCode: t.tariffCode || "",
				tariffName: t.tariffName || "",
				lseName: t.lseName || "",
				// The utility's standard-offer schedule: what this site would be billed on
				// had it never signed a competitive supply contract. This is the baseline
				// the "what did the contract save us" number is measured against — NOT the
				// cheapest rate on the list.
				isUtilityDefault: String(t.tariffType || "").toUpperCase() === "DEFAULT",
				customerCount: Number(t.customerCount) || 0,
				serviceType: RateClassData._serviceLabel(t.serviceType),
				isTOU: !!t.hasTimeOfUseRates,
				isDA: /direct access/i.test(String(t.tariffName || "")),
				// Hourly / real-time / day-ahead pricing: like TOU, savings depend on
				// shifting load to cheap hours and are modeled on a default profile —
				// even more profile-sensitive than TOU, so flag it as an estimate.
				isRTP: /hourly pricing|real[\s-]?time|day[\s-]?ahead|\brtp\b/i.test(String(t.tariffName || "")),
				modeledAnnualCost: modeled,
				modeledEnergy: block.error ? null : Number(block.energyCost || 0),
				modeledDemand: block.error ? null : Number(block.demandCost || 0),
				modeledOther: block.error ? null : Number(block.otherCost || 0),
				actualAnnualCost: actualAnnual,
				annualSavings: savings,
				savingsPct: (savings == null || actualAnnual === 0) ? null : (savings / actualAnnual) * 100,
				lines: block.lines || [],
				error: block.error || null
			};
		};

		const results = await RateClassData._mapLimit(tariffs, concurrency, modelOne);

		// --- 5. Rank by savings (highest first); flag the best positive saver ---
		// First weed out "rates" that aren't full-requirements service. Some
		// GENERAL-class schedules are supplemental — Parallel Generation (for
		// on-site generators), Hourly Pricing for Incremental Load (prices only
		// load above a baseline), standby/buyback — and model a whole facility's
		// usage at a near-zero bill, producing fake 90–100% "savings". A real
		// full-service rate must bill a credible $/kWh; below this floor it's
		// structurally not comparable. (~$0.02/kWh is well under any real all-in
		// retail rate, so this only catches the degenerate ones.)
		const annualKwh = months.reduce((s, m) => s + m.kwh, 0);
		const peakKw = months.reduce((mx, m) => Math.max(mx, m.kw), 0);
		// Detect a broken demand (kW) feed. A month with real consumption but
		// 0 kW is physically impossible (5,000 kWh/mo ⇒ ≥7 kW average), so it's
		// missing source data, not a genuinely demand-free month. When demand is
		// missing, demand charges are under-modeled: every rate looks cheaper
		// than it is (inflated savings) and — worse — with peakKw stuck near 0
		// the "no-demand-charge" exclusion below can't fire, so a low-demand /
		// transmission-voltage rate wins as a bogus "best" (e.g. Ross Park Mall,
		// both months 0 kW → "General - Transmission" +49.5%). Small telecom-type
		// sites (a few hundred kWh, genuinely ~0 kW) stay under the floor.
		const demandMissingMonths = months.filter(m => m.kwh >= 5000 && (Number(m.kw) || 0) <= 0).length;
		// Spurious HIGH demand: a kW reading so large the implied monthly load
		// factor is physically impossible. LF = kWh / (kW × ~730 h/mo); below ~2%
		// the peak is >50× the average, which is a metering error, not real load
		// (e.g. 842 Margery 3,808 kWh @ 3,450 kW = 0.15%). These inflate demand
		// charges wildly and make every rate's cost meaningless. Require kW > 50 so
		// genuinely tiny/peaky small sites aren't caught.
		const demandSpikeMonths = months.filter(m => (Number(m.kw) || 0) > 50 && m.kwh > 0
			&& (m.kwh / ((Number(m.kw) || 1) * 730)) < 0.02).length;
		// Under-reported demand: a NONZERO kW so low the implied load factor exceeds
		// 100% — impossible, since average demand can't exceed the peak (e.g. La Plaza
		// 1,521,793 kWh @ 391 kW = 533% LF). The demand reading is undercounted, so
		// demand-based rates are under-modeled exactly like the 0-kW case. Using >1.0
		// (100%) makes this a zero-false-positive signal.
		const demandUnderMonths = months.filter(m => (Number(m.kw) || 0) > 0
			&& (m.kwh / ((Number(m.kw) || 1) * 730)) > 1.0).length;
		const demandMissing = demandMissingMonths > 0;
		// Any of these failure modes means demand can't be trusted — withhold the pick.
		const demandSuspect = demandMissing || demandSpikeMonths > 0 || demandUnderMonths > 0;
		const MIN_EFFECTIVE_RATE = 0.02; // $/kWh
		// Below this modeled demand $/kW-year a rate effectively doesn't bill
		// demand (~$0.50/kW-mo; real demand charges are $2–25/kW-mo).
		const MIN_DEMAND_PER_KW_YR = 6;
		results.forEach(r => {
			r.nonService = (r.annualSavings != null && annualKwh > 0
				&& (Number(r.modeledAnnualCost) / annualKwh) < MIN_EFFECTIVE_RATE);
			// ERCOT / Texas delivery-only "wires" utilities (Oncor, AEP Texas,
			// TNMP, CenterPoint Houston) model DELIVERY charges only — the energy
			// comes from a competitive retailer Genability doesn't have — so their
			// bill isn't comparable to a bundled actual bill (it shows fake positive
			// savings). TX co-ops / munis are full-service and stay comparable.
			r.deliveryOnly = RateClassData._isDeliveryOnlyTDU(r.lseName);
			// A demand-metered site (peak > 500 kW) can't be on a rate that bills
			// ~no demand — those are small-customer rates that model cheap only
			// because they omit demand charges (e.g. "Small General" $0 demand
			// winning for a 16 MW plant). A real full-requirements rate for a large
			// load always bills demand.
			r.demandIncomplete = (r.annualSavings != null && peakKw > 500
				&& (Number(r.modeledDemand) || 0) < peakKw * MIN_DEMAND_PER_KW_YR);
		});
		const isComparable = (r) => r.annualSavings != null && !r.nonService && !r.deliveryOnly && !r.demandIncomplete;
		const ok = results.filter(isComparable);
		const flagged = results.filter(r => r.annualSavings != null && !isComparable(r));
		const failed = results.filter(r => r.annualSavings == null);
		ok.sort((a, b) => b.annualSavings - a.annualSavings);
		// Only crown a "best" when we trust the inputs. With demand data missing
		// OR a spurious spike, the top rate is unreliable (under- or over-modeled
		// demand) — rank the list for reference but withhold the recommendation.
		ok.forEach((r, i) => { r.rank = i + 1; r.isBest = (!demandSuspect && i === 0 && r.annualSavings > 0); });
		// Non-comparable (non-service / delivery-only / demand-incomplete) and
		// errored rates go to the bottom, unranked.
		const ranked = ok.concat(flagged, failed);
		const deliveryOnlyCount = results.filter(r => r.annualSavings != null && r.deliveryOnly).length;
		const nonServiceCount = results.filter(r => r.annualSavings != null && r.nonService && !r.deliveryOnly).length;
		const demandIncompleteCount = results.filter(r => r.annualSavings != null && r.demandIncomplete && !r.nonService && !r.deliveryOnly).length;

		// "Stay with the utility" baseline: the DEFAULT schedule this site would fall
		// onto, priced on the same 12 months. Where a utility publishes more than one,
		// take the one with the most customers on it — that is the standard offer
		// rather than a niche default.
		// The intent is to price the schedule the site would fall onto had it never
		// gone competitive. In practice these utilities publish their DEFAULT-typed
		// schedules for residential service and every commercial rate comes back
		// ALTERNATIVE, so on a commercial account there is usually no DEFAULT to
		// find and the comparison would be blank. Where that happens, fall back to
		// the cheapest rate the account qualifies for and record which basis was
		// used, rather than leaving the column empty.
		const defaults = ok.filter(r => r.isUtilityDefault && r.modeledAnnualCost != null)
			.sort((a, b) => b.customerCount - a.customerCount);
		const utilityDefault = defaults[0] || ok.find(r => r.modeledAnnualCost != null) || null;
		const utilityDefaultBasis = defaults.length ? "utility standard offer" : "cheapest qualifying rate";
		if (utilityDefault) {
			results.forEach(r => { r.isUtilityDefaultPick = (r.masterTariffId === utilityDefault.masterTariffId); });
		}
		const utilityDefaultCost = utilityDefault ? Number(utilityDefault.modeledAnnualCost) : null;
		// Sign is deliberately the opposite of annualSavings. annualSavings asks "how
		// much would switching TO this rate save?"; contractSavings asks "how much did
		// NOT being on the utility's rate already save?" — positive means the supply
		// contract beat the utility over these 12 months.
		const contractSavings = utilityDefaultCost == null ? null : (utilityDefaultCost - actualAnnual);

		const meta = {
			zip,
			locationName,
			actualAnnual,
			utilityDefaultCost,
			utilityDefaultName: utilityDefault ? utilityDefault.tariffName : null,
			utilityDefaultBasis: utilityDefault ? utilityDefaultBasis : null,
			utilityDefaultCode: utilityDefault ? utilityDefault.tariffCode : null,
			utilityDefaultIsTOU: utilityDefault ? !!utilityDefault.isTOU : false,
			contractSavings,
			contractSavingsPct: (contractSavings == null || !utilityDefaultCost) ? null : (contractSavings / utilityDefaultCost) * 100,
			monthCount,
			tariffCount: ranked.length,
			modeledCount: ok.length,
			nonServiceCount: nonServiceCount,
			deliveryOnlyCount: deliveryOnlyCount,
			demandIncompleteCount: demandIncompleteCount,
			demandMissing: demandMissing,
			demandMissingMonths: demandMissingMonths,
			demandSpikeMonths: demandSpikeMonths,
			demandUnderMonths: demandUnderMonths,
			demandSuspect: demandSuspect,
			peakKw: peakKw,
			ridersDropped,
			// A rate that errored is excluded from the ranking. If that rate would have
			// been the cheapest, the headline moves — so the count is surfaced rather
			// than left for someone to notice a short list.
			erroredCount: failed.length,
			erroredRates: failed.map(r => `${r.tariffCode || r.tariffName}: ${String(r.error).slice(0, 120)}`),
			tariffListIncomplete: !!allTariffs.__incomplete,
			totalReturned: allTariffs.length,
			truncated,
			dataThrough: months[0] ? months[0].month : null,
			stale: months[0] ? (moment().diff(moment(months[0].month), "months") > 3) : false,
			lseNames: lses.map(l => l.name).filter(Boolean),
			servingUtility: ctx.servingUtility || null,
			// True when we could not match the bill's vendor to any LSE in the ZIP and
			// therefore priced every utility there, co-ops included. The ranking is then
			// only as good as the reader's knowledge of who actually serves the site.
			// True when the bill's vendor could not be matched to any utility serving
			// the ZIP, so whatever was priced is not the company named on the bill.
			// In ERCOT that is normal — the bill comes from a retail supplier while
			// the tariffs belong to the wires company — but the reader has to be told,
			// otherwise the utility column and the rate list simply disagree.
			utilityUnmatched: !!(ctx.servingUtility && !lses.some(l => {
				const have = RateClassData._normUtility(l.name);
				const want = RateClassData._normUtility(ctx.servingUtility);
				return have === want || have.indexOf(want) >= 0 || want.indexOf(have) >= 0;
			}))
		};
		return { ranked, meta, allTariffs: allTariffsTagged };
	},

	// ---- Arcadia lookups, memoised for the length of one run ----------------
	// Portfolio runs hit the same zip/utility repeatedly (a customer's sites
	// cluster geographically). Without this, a 40-site run re-pulls the same
	// 600-tariff PG&E list dozens of times.
	// Utility names arrive in three dialects — the bill vendor ("Penelec"), the
	// Genability LSE name ("Pennsylvania Electric Co") and UBM's vendor list — so
	// matching needs both a normaliser and a small alias table for the cases where
	// the trading name shares no words with the legal name.
	_UTILITY_ALIASES: {
		"penelec": "pennsylvania electric",
		"met ed": "metropolitan edison",
		"metconstellation": "metropolitan edison",
		"ppl": "ppl electric",
		"west penn power": "west penn power",
		"ohio edison": "ohio edison",
		"aep ohio": "ohio power",
		"comed": "commonwealth edison",
		"com ed": "commonwealth edison",
		"jcpl": "jersey central power",
		"pseg": "public service electric"
	},

	_normUtility(name) {
		const n = String(name || "").toLowerCase()
			.replace(/[.,]/g, " ")
			.replace(/\b(co|corp|inc|llc|lp|company|the|of|and)\b/g, " ")
			.replace(/\s+/g, " ").trim();
		return RateClassData._UTILITY_ALIASES[n] || n;
	},

	async _cachedLses(zip, cache) {
		const key = String(zip);
		const c = (cache && cache.lses) || {};
		if (c[key]) return c[key];
		const v = await RateClassData._fetchLses(zip);
		if (cache && cache.lses) cache.lses[key] = v;
		return v;
	},

	async _cachedTariffs(lseId, zip, cache) {
		const key = `${lseId}|${zip}`;
		const c = (cache && cache.tariffs) || {};
		if (c[key]) return c[key];
		const v = await RateClassData._fetchTariffs(lseId, zip);
		if (cache && cache.tariffs) cache.tariffs[key] = v;
		return v;
	},


	// =====================================================================
	// Account inventory
	// =====================================================================
	// What the customer actually has, listed before any analysis runs. One UBM
	// query, about a second, against minutes to price every account against every
	// qualifying tariff. Showing the inventory first lets someone see the accounts,
	// spot missing or odd data, and choose what to run rather than committing to
	// the whole portfolio blind.
	//
	// The rows are built from the same grouping and the same window rule the run
	// uses, so the usage shown here is exactly the usage that would be priced. If
	// the table says 165,550 kWh over 12 months, that is what goes to Arcadia.
	async loadInventory() {
		const customerId = (typeof RC_CustomerSelect !== "undefined") ? RC_CustomerSelect.selectedOptionValue : null;
		if (!customerId) return;
		await storeValue("rc_inv_loading", true);
		await storeValue("rc_progress", "Loading accounts…");
		await storeValue("rc_inventory", [], false);
		try {
			const raw = await RC_CustomerUsage.run();
			const rows = Array.isArray(raw) ? raw : [];
			// Key on the physical account. Grouping on the virtual account or on the
			// bill type would list one meter twice \u2014 once as Supply Only and once as
			// Distribution Only \u2014 and the user would be choosing between two halves of
			// the same account, neither of which can be priced on its own.
			const byAcct = new Map();
			for (const r of rows) {
				const key = String(r.account_key != null ? r.account_key : r.location_id);
				if (!byAcct.has(key)) byAcct.set(key, []);
				byAcct.get(key).push(r);
			}
			const inv = [];
			for (const [key, list] of byAcct.entries()) {
				const spec = RateClassData._accountSpec(key, list);
				if (!spec) continue;
				inv.push({
					account_key: key,
					site: spec.site,
					location_id: spec.locationId,
					account_code: spec.acctCode || String(key),
					virtual_accounts: spec.vaLabel,
					zip: spec.zip,
					utility: spec.vendor,
					supplier: spec.supplierLabel,
					account_status: spec.accountStatus,
					bill_types: spec.billTypes,
					months: spec.monthCount,
					period_from: spec.periodFrom,
					period_to: spec.periodTo,
					annual_kwh: Math.round(spec.annualKwh),
					peak_kw: spec.peakKw,
					actual_annual: Number(spec.actualAnnual.toFixed(2)),
					supply_annual: Number(spec.supplyAnnual.toFixed(2)),
					delivery_annual: Number(spec.deliveryAnnual.toFixed(2)),
					full_service_annual: Number(spec.fullServiceAnnual.toFixed(2)),
					has_supply: spec.hasSupply,
					// The reason an account cannot be priced, or a warning about the data it
					// would be priced on. Surfaced here so a gap is visible BEFORE anyone
					// spends minutes on an account whose inputs cannot support a comparison,
					// and so the count in the results is never unexplained.
					blocker: spec.blocker,
					issue: spec.blocker || spec.warning,
					runnable: !spec.blocker
				});
			}
			inv.sort((a, b) => b.actual_annual - a.actual_annual);
			await storeValue("rc_inventory", inv, false);
		} catch (e) {
			await storeValue("rc_status", "Could not load the account list: " + ((e && e.message) || e));
		} finally {
			await storeValue("rc_inv_loading", false);
			await storeValue("rc_progress", "");
		}
	},

	// =====================================================================
	// One account, assembled from its monthly rows
	// =====================================================================
	// The single place a physical account's identity, window and totals are worked
	// out. Both the inventory listing and the run call it, so the table can never
	// describe an account differently from the way it is priced \u2014 the earlier build
	// had two copies of this logic and they had already begun to drift (the run
	// checked country, the listing did not).
	//
	// Returns null only when the account has no months at all.
	_accountSpec(key, list) {
		if (!list || !list.length) return null;
		// Identity fields are read across the whole series rather than off list[0]:
		// several of them (a post-change supply account code, a supplier name) are
		// null for the earlier months, so depending on which row happens to arrive
		// first would silently drop them.
		const firstOf = (k) => {
			for (const row of list) { const v = RateClassData._pickStr(row, [k]); if (v) return v; }
			return "";
		};
		const term = RateClassData.analysisTerm();
		// Newest `term` months, then drop anything more than a month older than that
		// window: a data gap would otherwise build a multi-year /calculate window
		// Genability rejects, and every rate would come back errored.
		const desc = list.slice().sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, term);
		const newest = moment(desc[0].month);
		const kept = desc.filter(r => newest.diff(moment(r.month), "months") <= term + 1);
		const months = kept.map(r => ({
			month: r.month,
			kwh: Number(r.kwh) || 0,
			kw: Number(r.kw) || 0,
			// Actual cost is both invoices together — that is what the site paid, and
			// the only figure comparable to a bundled utility tariff.
			actual: Number(r.actual_charges) || 0,
			supply: Number(r.supply_charges) || 0,
			delivery: Number(r.delivery_charges) || 0,
			fullService: Number(r.full_service_charges) || 0,
			// UBM's own classification of the bill. This is the actual side of the
			// charge comparison — see _buildLineItemCompare for why the line-item table
			// cannot be used for it.
			chg: {
				consumption: Number(r.chg_consumption) || 0,
				generation:  Number(r.chg_generation)  || 0,
				commodity:   Number(r.chg_commodity)   || 0,
				demand:      Number(r.chg_demand)      || 0,
				customer:    Number(r.chg_customer)    || 0,
				taxes:       Number(r.chg_taxes)       || 0,
				other:       Number(r.chg_other)       || 0
			},
			// Same categories, supplier's invoice only. The delivery side is the
			// remainder, so only one of the two needs carrying.
			chgSup: {
				consumption: Number(r.chg_consumption_sup) || 0,
				generation:  Number(r.chg_generation_sup)  || 0,
				commodity:   Number(r.chg_commodity_sup)   || 0,
				demand:      Number(r.chg_demand_sup)      || 0,
				customer:    Number(r.chg_customer_sup)    || 0,
				taxes:       Number(r.chg_taxes_sup)       || 0,
				other:       Number(r.chg_other_sup)       || 0
			}
		}));

		const site = firstOf("location_name") || `Account ${key}`;
		const acctCode = firstOf("account_code") || firstOf("client_account") || String(key);
		const zip = firstOf("postcode");
		const country = firstOf("country");
		const state = firstOf("state");
		// The bill's vendor is the serving utility. Passing it into the run stops
		// co-op and muni schedules that merely overlap the ZIP from being priced as
		// switchable options — a co-op serves a defined membership territory.
		const vendor = firstOf("vendor_name");
		const supplyVa = firstOf("supply_va_ids");
		const deliveryVa = firstOf("delivery_va_ids");
		const supplyAcct = firstOf("supply_account_code");
		const supplier = firstOf("supplier_name");

		const sum = (f) => months.reduce((t, m) => t + f(m), 0);
		const actualAnnual = sum(m => m.actual);
		const supplyAnnual = sum(m => m.supply);
		const deliveryAnnual = sum(m => m.delivery);
		const fullServiceAnnual = sum(m => m.fullService);
		const annualKwh = sum(m => m.kwh);
		const peakKw = months.reduce((mx, m) => Math.max(mx, m.kw), 0);
		const CHG_KEYS = ["consumption","generation","commodity","demand","customer","taxes","other"];
		const chgTotals = {}, chgSupply = {};
		for (const k of CHG_KEYS) {
			chgTotals[k] = sum(m => m.chg[k]);
			chgSupply[k] = sum(m => m.chgSup[k]);
		}
		// Whatever the categories do not account for. Carried explicitly so the
		// comparison still totals to what was actually billed.
		chgTotals.unclassified = actualAnnual - CHG_KEYS.reduce((t, k) => t + chgTotals[k], 0);
		chgSupply.unclassified = supplyAnnual - CHG_KEYS.reduce((t, k) => t + chgSupply[k], 0);
		// A competitive contract exists only where the supplier billed separately. A
		// Full Service invoice is the utility doing both, so there is no contract to
		// compare and reporting a saving against one would be inventing it.
		const hasSupply = supplyAnnual !== 0;

		const vaLabel = [supplyVa ? supplyVa + " (supply)" : "", deliveryVa ? deliveryVa + " (delivery)" : ""]
			.filter(Boolean).join(" / ");
		// UBM records vendor_name as the utility on the supply invoice too, so the
		// competitive supplier's trading name usually isn't recoverable. Where it
		// isn't, the supply account number identifies the supplier instead.
		const supplierLabel = (supplier && RateClassData._normUtility(supplier) !== RateClassData._normUtility(vendor))
			? supplier
			: (supplyAcct ? `acct ${supplyAcct}` : (hasSupply ? "not distinguished in UBM" : ""));

		return {
			id: String(key), site, acctCode,
			// Label carries the account number: with several accounts per site the site
			// name alone doesn't identify a row.
			name: acctCode ? `${site} — ${acctCode}` : site,
			locationId: RateClassData._pickNum(list[0], ["location_id"]),
			zip, country, state, vendor,
			supplier, supplierLabel, supplyAcct,
			vaLabel, supplyVa, deliveryVa,
			accountStatus: firstOf("account_status"),
			billTypes: firstOf("bill_types"),
			uom: firstOf("uom") || "kWh",
			months, monthCount: months.length,
			periodFrom: months.length ? months[months.length - 1].month.slice(0, 7) : "",
			periodTo: months.length ? months[0].month.slice(0, 7) : "",
			annualKwh, peakKw,
			actualAnnual, supplyAnnual, deliveryAnnual, fullServiceAnnual, hasSupply,
			chgTotals, chgSupply,
			blocker: RateClassData._blockingIssue(months, zip, country, state, vendor),
			warning: RateClassData._dataWarning(months, vendor)
		};
	},

	// Why this account cannot be priced at all. Anything returned here keeps the
	// account out of a run and onto the Not modeled list with this text as the
	// reason — never dropped silently, because a results count that doesn't match
	// the account count with no explanation is worse than no result.
	_blockingIssue(months, zip, country, state, vendor) {
		if (!months || !months.length) return "No bills in the last 24 months — nothing to price";
		// Arcadia/Genability only covers U.S. utilities. A non-U.S. postal code
		// collides with a five-digit U.S. ZIP and resolves to the wrong utility (a
		// Mexican CP 20355 → Pepco in Washington DC), producing a meaningless
		// comparison. Refuse rather than model it.
		if (country && !RateClassData._isUSCountry(country)) {
			return `Outside the US (${country}${state ? ", " + state : ""}) — Arcadia covers U.S. utilities only`;
		}
		if (!zip || String(zip).trim().length < 3) return "No ZIP on file — cannot look up tariffs";
		// No consumption means there is nothing for a tariff to price against: every
		// rate returns its fixed charge only, and comparing that to a real bill is
		// meaningless. Seen on unmetered and standby accounts.
		const kwh = months.reduce((t, m) => t + (Number(m.kwh) || 0), 0);
		if (kwh <= 0) return `No consumption across ${months.length} month(s) — nothing for a rate to price`;
		const paid = months.reduce((t, m) => t + (Number(m.actual) || 0), 0);
		if (paid === 0) return "No billed cost recorded — nothing to compare a modeled cost against";
		return "";
	},

	// Problems that don't stop the run but change how much the answer is worth.
	// Phrased as what it means for the analysis rather than as a data-quality
	// verdict, because that is the decision the reader is making.
	_dataWarning(months, vendor) {
		const term = RateClassData.analysisTerm();
		if (!vendor) return "No utility on the bills — every utility serving the ZIP will be priced";
		if (months.length < term) return `Only ${months.length} of ${term} months of data`;
		const zeroKw = months.filter(m => (Number(m.kwh) || 0) >= 5000 && (Number(m.kw) || 0) <= 0).length;
		if (zeroKw) return `${zeroKw} month(s) with usage but no demand reading — demand charges under-modeled`;
		const spike = months.filter(m => (Number(m.kw) || 0) > 50 && (Number(m.kwh) || 0) > 0
			&& ((Number(m.kwh) || 0) / ((Number(m.kw) || 1) * 730)) < 0.02).length;
		if (spike) return `${spike} month(s) with an implausibly high demand reading — demand charges over-modeled`;
		const under = months.filter(m => (Number(m.kw) || 0) > 0
			&& ((Number(m.kwh) || 0) / ((Number(m.kw) || 1) * 730)) > 1.0).length;
		if (under) return `${under} month(s) with a demand reading too low for the usage — demand charges under-modeled`;
		return "";
	},

	// The account table, narrowed by the location dropdown if one is set.
	inventoryRows() {
		const a = appsmith.store.rc_inventory;
		const rows = Array.isArray(a) ? a : [];
		const loc = appsmith.store.rc_f_location || "";
		return loc ? rows.filter(r => String(r.location_id) === String(loc)) : rows;
	},

	// Run one account. Shares the whole pipeline with the all-accounts run so the
	// two can never produce different numbers for the same account.
	async runOneAccount() {
		const key = (typeof Lst_RC_results !== "undefined" && Lst_RC_results.model)
			? Lst_RC_results.model.runKey : null;
		if (!key) { showAlert("Pick an account to run", "warning"); return; }
		return RateClassData.runCustomerAnalysis(String(key));
	},

	// Run every eligible account the table is currently showing. Wired to Run all.
	async runAllAccounts() {
		return RateClassData.runCustomerAnalysis(null);
	},

	// =====================================================================
	// The run
	// =====================================================================
	// One entry point for both buttons. `onlyKey` set = the Run button on a single
	// account row; null = Run all. They take the same path deliberately: an account
	// priced on its own and the same account inside a portfolio run must not be
	// able to disagree, and two code paths would eventually let them.
	//
	// Accounts that cannot be modeled are reported with a reason rather than
	// dropped, so the rollup is never quietly incomplete.
	async runCustomerAnalysis(onlyKey) {
		const customerId = (typeof RC_CustomerSelect !== "undefined") ? RC_CustomerSelect.selectedOptionValue : null;
		if (!customerId) {
			showAlert("Pick a customer first", "warning");
			return;
		}

		await storeValue("rc_loading", true);
		// Clear first, then set the progress line: _clearRun resets rc_progress, so
		// setting the message before it would leave the user staring at a blank
		// status line while the 24-month query runs.
		await RateClassData._clearRun();
		await storeValue("rc_progress", "Loading usage for every account…");
		await storeValue("rc_screen", 1);

		try {
			// --- 1. One query for every account, 24 months ---
			const raw = await RC_CustomerUsage.run();
			const rows = Array.isArray(raw) ? raw : [];
			if (!rows.length) {
				const msg = "No ELECTRIC usage is recorded for this customer in the last 24 months, so there is nothing to price.";
				showAlert("No electric usage found for this customer", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				await storeValue("rc_screen", 4);
				return;
			}

			// --- 2. Assemble physical accounts, each on its own window ---
			// Per-account rather than one customer-wide window: sites stop and start
			// billing at different times, so a shared window would model a closed site
			// against months it has no bills for and read as a huge fake saving.
			const byAcct = new Map();
			for (const r of rows) {
				const id = String(r.account_key != null ? r.account_key : r.location_id);
				if (!byAcct.has(id)) byAcct.set(id, []);
				byAcct.get(id).push(r);
			}

			const specs = [];
			const skipped = [];
			for (const [id, list] of byAcct.entries()) {
				const spec = RateClassData._accountSpec(id, list);
				if (!spec) {
					skipped.push({ id, name: `Account ${id}`, zip: "", actualAnnual: 0,
						reason: "No bills in the last 24 months — nothing to price" });
					continue;
				}
				if (spec.blocker) {
					skipped.push({ id, name: spec.name, zip: spec.zip, actualAnnual: spec.actualAnnual,
						reason: spec.blocker });
					continue;
				}
				specs.push(spec);
			}

			// A single-account run takes the same path as the whole portfolio, so the
			// two cannot disagree about the same account. Filter in place only when a
			// key was given; assigning the unfiltered array to a second name and then
			// clearing it would empty both, since they are one array.
			let scopeLabel = "all accounts";
			if (onlyKey) {
				const only = specs.filter(sp => String(sp.id) === String(onlyKey));
				if (!only.length) {
					const why = (skipped.find(sp => String(sp.id) === String(onlyKey)) || {}).reason
						|| "not present in the usage data";
					showAlert("That account cannot be analysed — " + why, "warning");
					await storeValue("rc_status", "Account " + onlyKey + ": " + why);
					await storeValue("rc_loading", false);
					await storeValue("rc_screen", 4);
					return;
				}
				scopeLabel = only[0].name;
				specs.length = 0;
				for (const sp of only) specs.push(sp);
				// Only this account's exclusions are relevant to a single-account run;
				// carrying the rest would report the whole portfolio's skips under a
				// heading that says one account.
				skipped.length = 0;
			}

			// Highest actual spend first: that is where the money is, and it is the
			// order the user sees progress in.
			specs.sort((a, b) => b.actualAnnual - a.actualAnnual);

			if (!specs.length) {
				const msg = `Found ${byAcct.size} account(s) but none can be modeled. ${skipped.slice(0, 5).map(sp => sp.name + " — " + sp.reason).join("; ")}`;
				showAlert("No accounts could be modeled", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_portfolio_meta", { locationsFound: byAcct.size, locationsRun: 0, skipped }, false);
				await storeValue("rc_loading", false);
				await storeValue("rc_screen", 4);
				return;
			}

			// --- 3. Price the accounts, in batches ---
			// No cap. The run works through every eligible account in batches of
			// _BATCH_SIZE, each batch running _LOC_CONCURRENCY accounts at a time, with
			// a pause between batches so the tab can paint its progress. A cap would be
			// faster and wrong: it silently changes which accounts the totals cover.
			const cache = { lses: {}, tariffs: {} };
			const total = specs.length;
			let doneAccts = 0;
			const analysed = [];
			const batches = Math.ceil(total / RateClassData._BATCH_SIZE);
			for (let b = 0; b < batches; b++) {
				const batch = specs.slice(b * RateClassData._BATCH_SIZE, (b + 1) * RateClassData._BATCH_SIZE);
				const part = await RateClassData._mapLimit(batch, RateClassData._LOC_CONCURRENCY, async (spec) => {
					await storeValue("rc_progress",
						`Analysing account ${Math.min(doneAccts + 1, total)} of ${total} — ${spec.name} (pricing every rate its utility publishes; this takes a minute or two per account)`);
					const out = await RateClassData._analyzeLocation(
						spec.months,
						{ zip: spec.zip, locationName: spec.name, servingUtility: spec.vendor,
						  actualAnnual: spec.actualAnnual, monthCount: spec.monthCount },
						cache,
						{ concurrency: RateClassData._PORTFOLIO_CALC_CONCURRENCY }
					);
					doneAccts += 1;
					await storeValue("rc_progress", `Analysed ${doneAccts} of ${total} account(s) — last: ${spec.name}`);
					return { spec, out };
				});
				for (const x of part) analysed.push(x);
				if (b < batches - 1) await new Promise(res => setTimeout(res, RateClassData._BATCH_PAUSE_MS));
			}

			// --- 4. Roll up ---
			await storeValue("rc_progress", "Building the comparison…");
			const portfolio = [];
			const forLineItems = [];
			// Every priced rate for every account, keyed by account. The results tabs
			// and the workbook both read it, so the rate list a user sees on screen is
			// the same one that exports.
			const ratesByAcct = {};
			const acctIndex = {};
			for (const a of analysed) {
				if (!a) continue;
				const sp = a.spec, out = a.out;
				const base = {
					location_id: sp.id,                 // account_key — the drill-down key
					location: sp.name,
					site: sp.site || "",
					account_code: sp.acctCode || "",
					virtual_accounts: sp.vaLabel || "",
					vendor: sp.vendor || "",
					supplier: sp.supplierLabel || "",
					supply_account_code: sp.supplyAcct || "",
					account_status: sp.accountStatus || "",
					bill_types: sp.billTypes || "",
					period_from: sp.periodFrom,
					period_to: sp.periodTo,
					supply_annual: Number((sp.supplyAnnual || 0).toFixed(2)),
					delivery_annual: Number((sp.deliveryAnnual || 0).toFixed(2)),
					full_service_annual: Number((sp.fullServiceAnnual || 0).toFixed(2)),
					has_supply: !!sp.hasSupply,
					zip: sp.zip,
					months: sp.monthCount,
					annual_kwh: Math.round(sp.annualKwh),
					peak_kw: Math.round(sp.peakKw),
					actual_annual: Number(sp.actualAnnual.toFixed(2)),
					warning: sp.warning || ""
				};
				// Month rows and charge categories ride along so the workbook can print
				// the billed history without re-querying.
				acctIndex[sp.id] = {
					id: sp.id, name: sp.name, site: sp.site, acctCode: sp.acctCode,
					vaLabel: sp.vaLabel, zip: sp.zip, vendor: sp.vendor,
					supplierLabel: sp.supplierLabel, accountStatus: sp.accountStatus,
					periodFrom: sp.periodFrom, periodTo: sp.periodTo,
					months: sp.months, monthCount: sp.monthCount,
					annualKwh: sp.annualKwh, peakKw: sp.peakKw,
					actualAnnual: sp.actualAnnual, supplyAnnual: sp.supplyAnnual,
					deliveryAnnual: sp.deliveryAnnual, fullServiceAnnual: sp.fullServiceAnnual,
					hasSupply: sp.hasSupply, chgTotals: sp.chgTotals, chgSupply: sp.chgSupply,
					warning: sp.warning
				};

				if (out.error) {
					ratesByAcct[sp.id] = [];
					portfolio.push(Object.assign(base, {
						utility: "", tariff: "", code: "",
						modeled_annual: null, savings: null, savings_pct: null,
						rates_modeled: 0, status: "Not modeled", note: out.error
					}));
					continue;
				}
				const ranked = out.ranked || [];
				ratesByAcct[sp.id] = ranked;
				const best = ranked.find(r => r.isBest) || null;
				const top = best || ranked.find(r => r.annualSavings != null && !r.nonService && !r.deliveryOnly && !r.demandIncomplete) || null;
				const m = out.meta || {};
				let status = "OK", note = "";
				if (!top) {
					status = "No comparable rate";
					note = "Every rate Arcadia returned was a rider, delivery-only, non-full-service or errored.";
				} else if (!best && m.demandSuspect) {
					// Ranked for reference but no pick: with demand missing or spurious the
					// top rate is under- or over-modeled and cannot be recommended.
					status = "Demand data unreliable";
					note = "Recommendation withheld — kW readings missing or implausible for this account, so modeled demand charges (and therefore savings) can't be trusted.";
				} else if (!sp.hasSupply) {
					status = "Utility supply";
					note = (sp.fullServiceAnnual > 0)
						? "Billed Full Service — the utility supplies and delivers on one invoice, so there is no competitive contract to compare against. The alternative-rate figure still applies: it is what a different utility rate would have cost."
						: "No supply invoice in this window, so there is no supply contract to compare against.";
				} else if (!best) {
					status = "No saving";
					note = "No rate class modeled cheaper than the current cost.";
				}
				// The data warning is appended rather than assigned: it survives
				// whichever status branch fired above. An earlier version assigned it
				// first and every branch then overwrote it, so a short-history or
				// bad-demand account was priced with the caveat silently dropped.
				if (sp.warning) note = note ? (note + " " + sp.warning) : sp.warning;
				portfolio.push(Object.assign(base, {
					utility: top ? top.lseName : (m.lseNames || [])[0] || "",
					tariff: top ? top.tariffName : "",
					code: top ? top.tariffCode : "",
					tou: top ? !!top.isTOU : false,
					da: top ? !!top.isDA : false,
					rtp: top ? !!top.isRTP : false,
					modeled_annual: top && top.modeledAnnualCost != null ? Number(top.modeledAnnualCost.toFixed(2)) : null,
					savings: (best && best.annualSavings != null) ? Number(best.annualSavings.toFixed(2)) : null,
					savings_pct: (best && best.savingsPct != null) ? Number(best.savingsPct.toFixed(1)) : null,
					demand_suspect: !!m.demandSuspect,
					peak_kw_suspect: !!(m.demandSpikeMonths || m.demandUnderMonths),
					rates_modeled: m.modeledCount || 0,
					rates_returned: m.totalReturned || 0,
					// The headline number for this engagement: what the account actually paid
					// versus what the utility rate would have cost over the same months.
					// Positive = the supply contract came in cheaper. Only meaningful where a
					// competitive contract exists; on utility supply this would be the utility
					// compared against itself, so it is withheld and the alternative-rate
					// column carries the useful number instead.
					utility_default: m.utilityDefaultName || "",
					utility_default_basis: m.utilityDefaultBasis || "",
					utility_default_code: m.utilityDefaultCode || "",
					utility_default_annual: m.utilityDefaultCost == null ? null : Number(m.utilityDefaultCost.toFixed(2)),
					// Withheld on the same terms as the recommendation. Where the kW readings
					// are missing or impossible the modeled demand charge is wrong, and it is
					// the largest component on a demand-metered account — one account with a
					// 354,048 kW spike against 2.4m kWh priced at $5.3m and single-handedly
					// turned a portfolio that was losing money into a $4.2m saving. A number
					// that wrong should not appear at all, let alone be summed into a total.
					contract_savings: (m.contractSavings == null || !sp.hasSupply || m.demandSuspect)
						? null : Number(m.contractSavings.toFixed(2)),
					// A percentage of a base this small is arithmetic noise: a $150 utility
					// figure against a $35,000 bill prints -2511%, which says nothing except
					// that the two are not comparable. Withhold it; the dollar column stands.
					contract_savings_pct: (m.contractSavingsPct == null || m.demandSuspect
						|| !sp.hasSupply || !(m.utilityDefaultCost > 100))
						? null : Number(m.contractSavingsPct.toFixed(1)),
					status,
					note
				}));
				if (top) forLineItems.push({ locationId: sp.id, locationName: sp.name, months: sp.months,
					chgTotals: sp.chgTotals, actualAnnual: sp.actualAnnual, ranked });
			}
			portfolio.sort((a, b) => (b.savings || 0) - (a.savings || 0) || b.actual_annual - a.actual_annual);

			// --- 5. Actual charges vs. the picked rate's modeled charges ---
			await storeValue("rc_progress", "Comparing billed charges…");
			const liByLoc = await RateClassData._buildLineItemCompare(customerId, forLineItems);

			const totalActual = portfolio.reduce((t, r) => t + (r.actual_annual || 0), 0);
			const totalSavings = portfolio.reduce((t, r) => t + (r.savings > 0 ? r.savings : 0), 0);
			// Contract-vs-utility rolls up over the accounts where a utility rate was
			// actually found and priced; accounts without one are counted separately so
			// the total is never quietly built from a subset. Same basis as the header
			// cards: only accounts holding a competitive supply contract, because
			// including Full Service accounts made the summary line contradict the cards
			// directly above it.
			const withDefault = portfolio.filter(r => r.contract_savings != null && r.has_supply && !r.demand_suspect);
			const totalUtilityDefault = withDefault.reduce((t, r) => t + (r.utility_default_annual || 0), 0);
			const totalActualWithDefault = withDefault.reduce((t, r) => t + (r.actual_annual || 0), 0);
			const totalContractSavings = withDefault.reduce((t, r) => t + (r.contract_savings || 0), 0);
			const pmeta = {
				customerId,
				customerName: (typeof RC_CustomerSelect !== "undefined" && RC_CustomerSelect.selectedOptionLabel) || "",
				scope: scopeLabel,
				term: RateClassData.analysisTerm(),
				runAt: moment().format("YYYY-MM-DD HH:mm"),
				// A counter, not just the timestamp: two runs inside the same minute
				// would share a timestamp, and the results view uses this to tell a new
				// run from a re-render.
				runId: moment().format("YYYYMMDDHHmm") + "#" + (Number(appsmith.store.rc_run_seq || 0) + 1),
				locationsFound: onlyKey ? 1 : byAcct.size,
				locationsModeled: portfolio.filter(r => r.status === "OK" || r.savings != null).length,
				locationsRun: portfolio.length,
				withSaving: portfolio.filter(r => r.savings > 0).length,
				demandSuspect: portfolio.filter(r => r.status === "Demand data unreliable").length,
				notModeled: portfolio.filter(r => r.status === "Not modeled").length,
				skipped,
				totalActual: Number(totalActual.toFixed(2)),
				totalSavings: Number(totalSavings.toFixed(2)),
				totalSavingsPct: totalActual > 0 ? Number(((totalSavings / totalActual) * 100).toFixed(1)) : null,
				accountsWithDefault: withDefault.length,
				totalUtilityDefault: Number(totalUtilityDefault.toFixed(2)),
				totalActualWithDefault: Number(totalActualWithDefault.toFixed(2)),
				totalContractSavings: Number(totalContractSavings.toFixed(2)),
				totalContractSavingsPct: totalUtilityDefault > 0 ? Number(((totalContractSavings / totalUtilityDefault) * 100).toFixed(1)) : null
			};

			// Non-persistent: a portfolio run holds every priced rate and its charge
			// lines for every account, which is well past what localStorage will take,
			// and a persisted copy would serve a stale result after a code change.
			await storeValue("rc_run_seq", Number(appsmith.store.rc_run_seq || 0) + 1, false);
			await storeValue("rc_portfolio", portfolio, false);
			await storeValue("rc_portfolio_meta", pmeta, false);
			await storeValue("rc_portfolio_lineitems", liByLoc, false);
			await storeValue("rc_rates_by_acct", ratesByAcct, false);
			await storeValue("rc_accounts", acctIndex, false);
			await storeValue("rc_single_account", onlyKey ? String(onlyKey) : "", false);

			// On a single-account run the rate list is the point of the screen, so it
			// also goes where the Rates tab reads from.
			if (onlyKey && analysed.length && analysed[0]) {
				const a0 = analysed[0];
				await storeValue("rc_results", a0.out.ranked || [], false);
				await storeValue("rc_all_tariffs", a0.out.allTariffs || [], false);
				await storeValue("rc_usage", a0.spec.months.map(m => ({
					month: m.month, kwh: m.kwh, kw: m.kw, actual_charges: m.actual,
					supply_charges: m.supply, delivery_charges: m.delivery
				})), false);
				await storeValue("rc_meta", Object.assign({}, a0.out.meta || {}, { accountName: a0.spec.name }), false);
				await storeValue("rc_lineitems", liByLoc[String(a0.spec.id)] || null, false);
			}

			await storeValue("rc_status", "");
			await storeValue("rc_screen", 3);
		} catch (e) {
			const msg = "Analysis failed: " + ((e && e.message) || e);
			showAlert(msg, "error");
			await storeValue("rc_status", msg);
		} finally {
			await storeValue("rc_loading", false);
			await storeValue("rc_progress", "");
		}
	},

	// =====================================================================
	// Billed line items vs. modeled charges
	// =====================================================================
	// Build the actual-vs-modeled comparison for every location in `locs`.
	//   locs -> [{ locationId, locationName, months, ranked }]
	// Build the actual-versus-modeled charge comparison for every account in `locs`,
	// each against the rate that account's headline figure is measured on.
	//   locs -> [{ locationId, locationName, months, chgTotals, actualAnnual, ranked }]
	// Returns { "<accountKey>": compareObject }.
	//
	// The actual side comes from UBM's charge categories on the monthly feed, NOT
	// from the billing line-item table. That table was tried first and rejected: it
	// holds only a fraction of what was actually billed for these accounts — 60% on
	// one customer, 34% on another, and on some accounts no distribution or demand
	// charge at all. A comparison built on it understates what was paid by roughly
	// a third to a half and makes every contract look better than it was. The
	// categories reconcile to the same total_charges figure the rest of the page
	// uses, so the totals here cannot drift from the Accounts tab.
	async _buildLineItemCompare(customerId, locs) {
		const out = {};
		if (!locs || !locs.length) return out;
		for (const l of locs) {
			const ranked = l.ranked || [];
			// The rate the comparison is against: the utility figure the headline uses
			// if there is one, otherwise the recommendation, otherwise the best
			// comparable rate — so there is always something to show.
			const rate = ranked.find(r => r.isUtilityDefaultPick && r.modeledAnnualCost != null)
				|| ranked.find(r => r.isBest)
				|| ranked.find(r => r.annualSavings != null && !r.nonService && !r.deliveryOnly && !r.demandIncomplete)
				|| null;
			out[String(l.locationId)] = RateClassData._compareForRate(
				{ locationId: l.locationId, locationName: l.locationName, months: l.months,
				  chgTotals: l.chgTotals, actualAnnual: l.actualAnnual },
				rate);
		}
		return out;
	},

	// The actual-versus-modeled comparison for ONE account against ONE rate.
	// Pulled out of _buildLineItemCompare so the workbook can run it for every
	// priced rate, not only the one the screen happens to be showing — the
	// validated EnerNova workbook compares charge groups for every rate, and
	// rebuilding that with a second copy of this logic would let the two drift.
	_compareForRate(acct, rate) {
		const c = (acct && acct.chgTotals) || {};
		const months = (acct && acct.months) || [];
		const num = (v) => Number(v) || 0;

		// Modeled side. Genability splits a bill into energy, demand and other;
		// "other" is the fixed and rider portion and carries named lines, so
		// tax-named lines are pulled out of it to face the actual taxes figure.
		const lines = (rate && Array.isArray(rate.lines)) ? rate.lines : [];
		const mTax = lines
			.filter(x => /\btax/i.test(String(x.name || "")))
			.reduce((t, x) => t + num(x.cost), 0);
		const m = {
			energy: rate ? num(rate.modeledEnergy) : 0,
			demand: rate ? num(rate.modeledDemand) : 0,
			taxes: mTax,
			fixed: rate ? num(rate.modeledOther) - mTax : 0
		};

		// A real bill unbundles the per-kWh cost across consumption, generation and
		// commodity lines while a tariff models one bundled energy charge, so those
		// three are compared as one group. Splitting them would report a large
		// shortfall in one and an equal excess in another that mean nothing.
		const aEnergy = num(c.consumption) + num(c.generation) + num(c.commodity);
		const demandItemised = num(c.demand) > 0;

		const groups = [];
		if (demandItemised) {
			groups.push({ group: "Energy (per kWh)", actual: aEnergy, modeled: m.energy,
				basis: "actual = consumption + generation + commodity" });
			groups.push({ group: "Demand (per kW)", actual: num(c.demand), modeled: m.demand,
				basis: "actual = demand charges on the bill" });
		} else {
			// Some utilities book no separate demand charge and carry the whole amount
			// as consumption. Splitting energy from demand on the actual side would then
			// be invented, and shows as a large offsetting difference in both rows that
			// nets to nothing.
			groups.push({ group: "Energy + demand (combined)", actual: aEnergy + num(c.demand),
				modeled: m.energy + m.demand,
				basis: "this bill books no separate demand charge, so the two cannot be split on the actual side without inventing the division" });
		}
		groups.push({ group: "Fixed charges & riders", actual: num(c.customer) + num(c.other), modeled: m.fixed,
			basis: "actual = customer charge + other" });
		groups.push({ group: "Taxes", actual: num(c.taxes), modeled: m.taxes,
			basis: "actual = taxes; modeled = tax-named lines in the rate" });
		if (Math.abs(num(c.unclassified)) > 0.5) {
			groups.push({ group: "Unclassified", actual: num(c.unclassified), modeled: 0,
				basis: "billed cost UBM assigns to no category; shown rather than spread across the groups so the total stays exact" });
		}

		for (const g of groups) {
			g.actual = Number(g.actual.toFixed(2));
			g.modeled = Number(g.modeled.toFixed(2));
			g.delta = Number((g.modeled - g.actual).toFixed(2));
			g.oneSided = (g.actual > 1 && g.modeled < 1) || (g.modeled > 1 && g.actual < 1);
			g.modeledLines = lines
				.filter(x => RateClassData._groupOfModeledLine(x, demandItemised) === g.group)
				.map(x => ({ name: x.name, unit: x.qty_unit, qty: Number(num(x.qty).toFixed(2)),
					rate: Number(num(x.rate).toFixed(5)), cost: Number(num(x.cost).toFixed(2)) }));
		}

		const actualTotal = groups.reduce((t, g) => t + g.actual, 0);
		const modeledTotal = m.energy + m.demand + m.fixed + m.taxes;

		// Charges really paid that the modeled rate produces no counterpart for —
		// most often taxes, which Genability does not carry. That money is still owed
		// on the utility rate, so it inflates the headline difference by roughly this
		// much.
		const gapGroups = groups.filter(g => g.oneSided && g.actual > g.modeled);
		const structuralGap = gapGroups.reduce((t, g) => t + (g.actual - g.modeled), 0);

		return {
			locationId: acct.locationId,
			locationName: acct.locationName,
			monthCount: months.length,
			windowFrom: months.length ? months[months.length - 1].month : null,
			windowTo: months.length ? months[0].month : null,
			rate: rate ? {
				tariffName: rate.tariffName, code: rate.tariffCode, utility: rate.lseName,
				isBest: !!rate.isBest, tou: !!rate.isTOU, da: !!rate.isDA, rtp: !!rate.isRTP,
				isUtilityDefault: !!rate.isUtilityDefaultPick
			} : null,
			actualTotal: Number(actualTotal.toFixed(2)),
			modeledTotal: Number(modeledTotal.toFixed(2)),
			baselineTotal: Number(num(acct.actualAnnual).toFixed(2)),
			// The categories are sourced from the same figure as the Accounts tab, so
			// these agree by construction; the check is kept as a guard.
			variance: Number((actualTotal - num(acct.actualAnnual)).toFixed(2)),
			variancePct: num(acct.actualAnnual) ? Number(((actualTotal - num(acct.actualAnnual)) / num(acct.actualAnnual) * 100).toFixed(1)) : null,
			varianceHigh: num(acct.actualAnnual) ? Math.abs(actualTotal - num(acct.actualAnnual)) / num(acct.actualAnnual) > 0.005 : false,
			structuralGap: Number(structuralGap.toFixed(2)),
			gapGroups: gapGroups.map(g => g.group),
			groups
		};
	},

	// Which comparison group a modeled charge line belongs to. Genability already
	// classified the totals; this only has to place the named lines underneath the
	// right heading so the reader can see what makes up each figure.
	_groupOfModeledLine(line, demandItemised) {
		const n = String(line && line.name || "");
		const u = String(line && line.qty_unit || "").toLowerCase();
		if (/\btax/i.test(n)) return "Taxes";
		if (u === "kwh") return demandItemised ? "Energy (per kWh)" : "Energy + demand (combined)";
		if (u === "kw") return demandItemised ? "Demand (per kW)" : "Energy + demand (combined)";
		return "Fixed charges & riders";
	},

	// =====================================================================
	// Store readers for the widgets (pure — never call .run(), never read .data)
	// =====================================================================
	portfolioRows() {
		const arr = appsmith.store.rc_portfolio;
		return Array.isArray(arr) ? arr : [];
	},

	portfolioMeta() {
		return appsmith.store.rc_portfolio_meta || {};
	},

	// Line-item comparison for the single-location screen.
	lineItemCompare() {
		return appsmith.store.rc_lineitems || null;
	},

	// Every account's comparison, keyed by location id. The portfolio widget holds
	// the whole map and switches between accounts client-side, so drilling into an
	// account is instant and needs no round-trip back through the store.
	lineItemsByLoc() {
		return appsmith.store.rc_portfolio_lineitems || {};
	},

	portfolioSummary() {
		const m = appsmith.store.rc_portfolio_meta || {};
		if (!m.locationsFound) return "";
		const parts = [];
		parts.push(`${m.locationsRun} of ${m.locationsFound} account(s) modeled`);
		parts.push(`Actual 12-mo cost: $${(m.totalActual || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
		if (m.accountsWithDefault) {
			const v = m.totalContractSavings || 0;
			const money = `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
			const pct = m.totalContractSavingsPct != null ? ` (${Math.abs(m.totalContractSavingsPct)}%)` : "";
			parts.push(v >= 0
				? `vs. staying with the utility: saved ${money}${pct} across ${m.accountsWithDefault} account(s)`
				: `vs. staying with the utility: paid ${money}${pct} MORE across ${m.accountsWithDefault} account(s)`);
		}
		if (m.totalSavings > 0) {
			parts.push(`Modeled saving across ${m.withSaving} account(s): $${m.totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}${m.totalSavingsPct != null ? ` (${m.totalSavingsPct}% of spend)` : ""}`);
		} else {
			parts.push("No account modeled cheaper than its current cost");
		}
		if (m.demandSuspect) parts.push(`⚠ ${m.demandSuspect} account(s) have unreliable kW data — no recommendation made for those`);
		if (m.notModeled) parts.push(`${m.notModeled} account(s) could not be modeled`);
		// Nothing is dropped for volume any more, so every account missing from the
		// results is missing for a stated reason on the Not modeled tab.
		const skippedCount = (m.skipped || []).length;
		if (skippedCount > 0) parts.push(`${skippedCount} account(s) not modeled — see the Not modeled tab for why`);
		return parts.join("  •  ");
	},

	skippedRows() {
		const m = appsmith.store.rc_portfolio_meta || {};
		const s = Array.isArray(m.skipped) ? m.skipped : [];
		return s.map(x => ({
			location: x.name,
			zip: x.zip || "—",
			actual_annual: x.actualAnnual == null ? null : Number(Number(x.actualAnnual).toFixed(2)),
			reason: x.reason
		}));
	},



	// =====================================================================
	// Summary cards for the portfolio header
	// =====================================================================
	// Deliberately excludes accounts that could not be modeled from the utility
	// and savings figures, while still counting their spend in the actual total —
	// so the cards never imply coverage the run does not have. Counts of what was
	// left out ride along so the header can say so.
	summaryCards() {
		const rows = RateClassData.portfolioRows();
		const m = appsmith.store.rc_portfolio_meta || {};
		if (!rows.length) return [];
		// Card and table must report the same quantity. Both use the utility figure
		// on the row (standard offer where one exists, otherwise the cheapest
		// qualifying rate) so the header cannot say one thing while the column
		// beneath it says another.
		// Only accounts with a competitive supply contract belong in a
		// contract-versus-utility figure. Full Service accounts are already on the
		// utility, so including them would compare the utility against itself.
		// The set behind every figure in this header: a competitive contract to
		// compare, a priced utility rate, and demand data sound enough to trust the
		// pricing. An account failing the last test can be off by an order of
		// magnitude, so it is reported on its own row and kept out of the totals.
		const modeled = rows.filter(r => r.utility_default_annual != null && r.has_supply && !r.demand_suspect);
		const noContract = rows.filter(r => !r.has_supply).length;
		const suspect = rows.filter(r => r.has_supply && r.demand_suspect).length;
		const cheapest = modeled.reduce((t, r) => t + (r.utility_default_annual || 0), 0);
		const actualAll = rows.reduce((t, r) => t + (r.actual_annual || 0), 0);
		const actualModeled = modeled.reduce((t, r) => t + (r.actual_annual || 0), 0);
		// Add up the column rather than recomputing the comparison, so the header
		// cannot disagree with the rows beneath it.
		const rowDiff = modeled.reduce((t, r) => t + (r.contract_savings || 0), 0);
		const kwh = rows.reduce((t, r) => t + (r.annual_kwh || 0), 0);
		// Take the peak from accounts whose demand readings are trustworthy. The
		// highest figure in a portfolio is exactly where a metering error surfaces,
		// so reporting the raw maximum reports the worst reading as fact.
		const sane = rows.filter(r => !r.peak_kw_suspect);
		const peak = (sane.length ? sane : rows).reduce((t, r) => Math.max(t, r.peak_kw || 0), 0);
		const suspectPeaks = rows.length - sane.length;
		const supply = rows.reduce((t, r) => t + (r.supply_annual || 0), 0);
		const delivery = rows.reduce((t, r) => t + (r.delivery_annual || 0), 0);
		const fullSvc = rows.reduce((t, r) => t + (r.full_service_annual || 0), 0);
		// Positive = the supply contracts came in under the utility.
		const diff = rowDiff;
		const card = (label, value, sub, tone) => ({ label, value, sub: sub || "", tone: tone || "" });
		const money = v => "$" + Math.round(v).toLocaleString();
		return [
			card("Accounts", String(rows.length), m.notModeled ? `${m.notModeled} not modeled` : "all modeled"),
			card("Total actual cost", money(actualAll),
				`supply ${money(supply)} · delivery ${money(delivery)}`
					+ (fullSvc > 0 ? ` · full service ${money(fullSvc)}` : "")),
			card("Utility cost", modeled.length ? money(cheapest) : "—",
				`${modeled.length} account(s) compared`
					+ (noContract ? ` · ${noContract} on utility supply` : "")
					+ (suspect ? ` · ${suspect} with unsound kW` : "")
					+ ((noContract || suspect) ? ", excluded" : "")),
			card("Contract vs utility", modeled.length ? (diff >= 0 ? "+" : "-") + money(Math.abs(diff)) : "—",
				// Only the accounts carrying a utility figure are in this comparison,
				// so say so rather than implying it covers the whole portfolio.
				modeled.length
					? (diff >= 0 ? "contract cost less" : "utility would have cost less")
						+ (modeled.length < rows.length ? ` · ${modeled.length} of ${rows.length}` : "")
					: "no account had a comparable utility rate",
				modeled.length ? (diff >= 0 ? "pos" : "neg") : ""),
			card("Difference %", (modeled.length && cheapest) ? ((diff / cheapest) * 100).toFixed(1) + "%" : "—",
				modeled.length && cheapest ? "of the utility cost" : "nothing to compare against",
				(modeled.length && cheapest) ? (diff >= 0 ? "pos" : "neg") : ""),
			card("Total consumption", Math.round(kwh).toLocaleString() + " kWh", `${rows.length} account(s)`),
			card("Peak demand", Math.round(peak).toLocaleString() + " kW",
				!sane.length
					? "⚠ no account has a sound kW reading — this is the highest of the unreliable ones"
					: (suspectPeaks ? `highest of ${sane.length} account(s) with sound kW data`
					                : "highest across accounts"),
				sane.length ? "" : "neg")
		];
	},

	// =====================================================================
	// Filters
	// =====================================================================
	// Applied to the portfolio AFTER the run rather than to the query, so changing
	// a filter never re-hits Genability — the expensive part is the modeling, and
	// the answer for an account doesn't change because a sibling was filtered out.
	filteredPortfolio() {
		const rows = RateClassData.portfolioRows();
		const site = appsmith.store.rc_f_site || "";
		const vendor = appsmith.store.rc_f_vendor || "";
		return rows.filter(r =>
			(!site || String(r.site) === site) &&
			(!vendor || String(r.vendor) === vendor));
	},

	siteOptions() {
		const seen = {}, out = [{ label: "All sites", value: "" }];
		for (const r of RateClassData.portfolioRows()) {
			if (r.site && !seen[r.site]) { seen[r.site] = 1; out.push({ label: r.site, value: r.site }); }
		}
		return out;
	},

	vendorOptions() {
		const seen = {}, out = [{ label: "All utilities", value: "" }];
		for (const r of RateClassData.portfolioRows()) {
			if (r.vendor && !seen[r.vendor]) { seen[r.vendor] = 1; out.push({ label: r.vendor, value: r.vendor }); }
		}
		return out;
	},

	// Analysis term. Each account is still anchored on its own most recent data —
	// this caps how far back the window may reach, so a user can ask for 12, 24 or
	// 36 months without the query changing.
	termOptions() {
		return [
			{ label: "Last 12 months", value: 12 },
			{ label: "Last 24 months", value: 24 },
			{ label: "Last 36 months", value: 36 }
		];
	},

	analysisTerm() {
		const t = Number(appsmith.store.rc_term);
		return (t === 24 || t === 36) ? t : 12;
	},

	async onFilterChange() {
		// Filters are display-only, so nothing re-runs; this exists so the widgets
		// have a handler and the store write is explicit.
		return true;
	},

	// =====================================================================
	// Excel export
	// =====================================================================
	// The deliverable is the workbook, not the screen. It carries more than the
	// page shows on purpose: the recipients read it away from the app, and a
	// figure without the months and the rate list behind it can't be checked.
	//
	// Laid out sheet for sheet like the validated EnerNova workbook, so a result
	// produced here can be put side by side with that one.
	//
	// Two output paths. The XLSX library gives a real .xlsx where it is reachable;
	// where it isn't — its nested helpers are not reliably exposed inside the
	// Appsmith JS sandbox — the same sheets are written as SpreadsheetML 2003 XML,
	// which Excel, Numbers and LibreOffice all open with the tabs intact. The
	// fallback is never silent: the alert says which one was produced.
	_xlsxAvailable() {
		try {
			return typeof XLSX !== "undefined" && XLSX && XLSX.utils
				&& typeof XLSX.utils.aoa_to_sheet === "function"
				&& typeof XLSX.utils.book_new === "function"
				&& typeof XLSX.utils.book_append_sheet === "function"
				&& typeof XLSX.write === "function";
		} catch (e) { return false; }
	},

	_xmlEsc(v) {
		return String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			// Control characters are not legal in XML 1.0 at all, and one stray
			// character off a bill description would make the file unopenable.
			.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
	},

	// SpreadsheetML 2003. One <Worksheet> per sheet, numbers typed as Number so
	// Excel sums the columns instead of treating them as text.
	_toSpreadsheetXml(sheets) {
		const esc = RateClassData._xmlEsc;
		const parts = ['<?xml version="1.0"?>',
			'<?mso-application progid="Excel.Sheet"?>',
			'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
			' xmlns:o="urn:schemas-microsoft-com:office:office"',
			' xmlns:x="urn:schemas-microsoft-com:office:excel"',
			' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'];
		for (const sh of sheets) {
			// Excel refuses a sheet name over 31 characters or carrying [ ] : * ? / \
			const name = esc(String(sh.name).replace(/[\[\]:\*\?\/\\]/g, " ").slice(0, 31));
			parts.push('<Worksheet ss:Name="' + name + '"><Table>');
			for (const row of sh.rows) {
				const r = Array.isArray(row) ? row : [];
				parts.push("<Row>");
				for (const cell of r) {
					if (cell == null || cell === "") { parts.push("<Cell/>"); continue; }
					const isNum = (typeof cell === "number") && isFinite(cell);
					parts.push('<Cell><Data ss:Type="' + (isNum ? "Number" : "String") + '">'
						+ esc(isNum ? cell : String(cell)) + "</Data></Cell>");
				}
				parts.push("</Row>");
			}
			parts.push("</Table></Worksheet>");
		}
		parts.push("</Workbook>");
		return parts.join("");
	},

	// Numbers stay numbers throughout the sheet builders so the workbook arrives
	// sortable and summable rather than as text that merely looks like money.
	_money(v) { return v == null ? "" : Number(Number(v).toFixed(2)); },
	_cents(cost, kwh) { return (kwh > 0 && cost != null) ? Number(((cost / kwh) * 100).toFixed(2)) : ""; },

	// Every rate priced for one account, in the order the screen ranks them:
	// comparable ones cheapest first, then flagged, then errored. Nothing hidden.
	_ratesFor(acctId) {
		const map = appsmith.store.rc_rates_by_acct || {};
		const list = map[String(acctId)];
		return Array.isArray(list) ? list : [];
	},

	buildWorkbook() {
		const pm = RateClassData.portfolioMeta();
		const rows = RateClassData.filteredPortfolio();
		const accounts = appsmith.store.rc_accounts || {};
		const customer = pm.customerName
			|| ((typeof RC_CustomerSelect !== "undefined" && RC_CustomerSelect.selectedOptionLabel) || "Customer");
		const term = pm.term || RateClassData.analysisTerm();
		const money = RateClassData._money, cents = RateClassData._cents;
		const froms = rows.map(r => r.period_from).filter(Boolean).sort();
		const tos = rows.map(r => r.period_to).filter(Boolean).sort();
		const windowLabel = froms.length ? (froms[0] + " to " + tos[tos.length - 1]) : "";
		const sheets = [];

		// ---- Executive Summary ------------------------------------------------
		// A row per account PER RATE, not one row per account: the question the
		// workbook answers is what each utility rate would have cost, and the
		// account's own figures repeat down its block so any single row can be read
		// on its own, filtered or pivoted without losing its context.
		const exec = [[customer + " — " + term + "-month tariff comparison  ·  " + windowLabel],
			["Actual = what was billed (competitive supply + utility delivery, or a single full-service invoice). Modeled = the same months priced on each utility rate through Arcadia. Difference positive = the utility rate would have cost MORE, i.e. the current arrangement is the cheaper one."],
			["Customer", "Site", "Account", "Virtual accounts", "ZIP", "Utility", "Current supplier",
			 "Account status", "Period start", "Period end", "Months", term + "-mo kWh", "Peak kW",
			 "Supply $", "Delivery $", "Full service $", "ACTUAL TOTAL $", "Actual c/kWh",
			 "Utility rate", "Code", "Rate class", "MODELED $", "Modeled c/kWh",
			 "DIFFERENCE $", "DIFFERENCE %", "Notes"]];
		for (const r of rows) {
			const kwh = r.annual_kwh || 0;
			// The exact peak, not the rounded figure the table shows: this is the
			// input the pricing used, and a reader checking a demand charge against
			// it needs the number that went to the API.
			const acct0 = accounts[String(r.location_id)];
			const peak = acct0 ? Number(acct0.peakKw.toFixed(2)) : r.peak_kw;
			const head = [customer, r.site, r.account_code, r.virtual_accounts, r.zip, r.vendor,
				r.supplier || "not distinguished in UBM", r.account_status,
				r.period_from, r.period_to, r.months, kwh, peak,
				money(r.supply_annual), money(r.delivery_annual), money(r.full_service_annual),
				money(r.actual_annual), cents(r.actual_annual, kwh)];
			const rates = RateClassData._ratesFor(r.location_id).filter(x => x.modeledAnnualCost != null);
			if (!rates.length) {
				// An account that ran but priced nothing still gets a row. Dropping it
				// would make the sheet disagree with the account count on screen.
				exec.push(head.concat(["—", "", "", "", "", "", "",
					r.note || "No rate could be priced for this account"]));
				continue;
			}
			for (const t of rates) {
				const diff = (r.actual_annual == null) ? null : (t.modeledAnnualCost - r.actual_annual);
				const notes = [];
				if (t.isTOU) notes.push("TOU — default load shape, estimate");
				if (t.isRTP) notes.push("Hourly / real-time — default load shape, estimate");
				if (t.isDA) notes.push("Direct Access — needs a competitive supplier, not just a rate change");
				if (t.isUtilityDefaultPick) notes.push("comparison basis for this account");
				if (t.nonService) notes.push("not full-requirements service — not comparable");
				if (t.deliveryOnly) notes.push("delivery-only utility — not comparable to a bundled bill");
				if (t.demandIncomplete) notes.push("bills no demand charge on a demand-metered load");
				if (t.error) notes.push("errored: " + String(t.error).slice(0, 120));
				if (r.warning) notes.push(r.warning);
				exec.push(head.concat([t.tariffName, t.tariffCode, "GENERAL (commercial)",
					money(t.modeledAnnualCost), cents(t.modeledAnnualCost, kwh),
					money(diff),
					(diff == null || !r.actual_annual) ? "" : Number(((diff / r.actual_annual) * 100).toFixed(1)),
					notes.join("; ")]));
			}
		}
		sheets.push({ name: "Executive Summary", rows: exec });

		// ---- Location Summary -------------------------------------------------
		const bySite = new Map();
		for (const r of rows) {
			const k = r.site || "(no site)";
			if (!bySite.has(k)) bySite.set(k, []);
			bySite.get(k).push(r);
		}
		const loc = [["Location summary"],
			["Each account measured against the utility rate used as its comparison basis. An account that returned no priced rate leaves the utility column blank rather than contributing a zero."],
			["Site", "Accounts", term + "-mo kWh", "Actual $", "Utility $", "Difference $", "Difference %"]];
		for (const entry of bySite.entries()) {
			const site = entry[0], list = entry[1];
			const priced = list.filter(r => r.utility_default_annual != null);
			const a = list.reduce((t, r) => t + (r.actual_annual || 0), 0);
			const k = list.reduce((t, r) => t + (r.annual_kwh || 0), 0);
			const u = priced.reduce((t, r) => t + (r.utility_default_annual || 0), 0);
			const aP = priced.reduce((t, r) => t + (r.actual_annual || 0), 0);
			loc.push([site, list.length, k, money(a),
				priced.length ? money(u) : "",
				priced.length ? money(u - aP) : "",
				(priced.length && aP) ? Number((((u - aP) / aP) * 100).toFixed(1)) : ""]);
		}
		const priced = rows.filter(r => r.utility_default_annual != null);
		const totActual = rows.reduce((t, r) => t + (r.actual_annual || 0), 0);
		const totKwh = rows.reduce((t, r) => t + (r.annual_kwh || 0), 0);
		const totUtil = priced.reduce((t, r) => t + (r.utility_default_annual || 0), 0);
		const totActualPriced = priced.reduce((t, r) => t + (r.actual_annual || 0), 0);
		loc.push(["TOTAL", rows.length, totKwh, money(totActual),
			priced.length ? money(totUtil) : "",
			priced.length ? money(totUtil - totActualPriced) : "",
			(priced.length && totActualPriced) ? Number((((totUtil - totActualPriced) / totActualPriced) * 100).toFixed(1)) : ""]);
		loc.push([]);
		// Said explicitly because the two columns cover different sets whenever an
		// account failed to price, and a reader subtracting them would be wrong.
		loc.push(["The utility and difference columns cover the " + priced.length
			+ " account(s) that returned a priced rate; the actual column covers all "
			+ rows.length + "."]);
		sheets.push({ name: "Location Summary", rows: loc });

		// ---- Account Detail ---------------------------------------------------
		const det = [["Account detail — monthly billed history"],
			["Supply and delivery are separate invoices against the same meter. Consumption is the metered volume, counted once — never the sum of the two, which would double the kWh."],
			["Site", "Account", "Virtual accounts", "Month", "kWh", "Peak kW",
			 "Supply $", "Delivery $", "Full service $", "Total $", "c/kWh"]];
		for (const r of rows) {
			const a = accounts[String(r.location_id)];
			if (!a) continue;
			const ms = (a.months || []).slice().sort((x, y) => (x.month < y.month ? -1 : 1));
			for (const m of ms) {
				det.push([r.site, r.account_code, r.virtual_accounts, String(m.month).slice(0, 7),
					Number((m.kwh || 0).toFixed(2)), Number((m.kw || 0).toFixed(2)),
					money(m.supply), money(m.delivery), money(m.fullService), money(m.actual),
					cents(m.actual, m.kwh)]);
			}
			det.push(["", "", "", "account total", Math.round(a.annualKwh), Math.round(a.peakKw),
				money(a.supplyAnnual), money(a.deliveryAnnual), money(a.fullServiceAnnual),
				money(a.actualAnnual), cents(a.actualAnnual, a.annualKwh)]);
		}
		sheets.push({ name: "Account Detail", rows: det });

		// ---- Tariff Results ---------------------------------------------------
		const tar = [["Tariff results — every utility rate priced"],
			["Restricted to currently effective, non-closed, commercial (GENERAL) rate classes published by the serving utility. Riders, surcharges, residential, unmetered, EV and special-use schedules are excluded before pricing; the Status column says why a rate that WAS priced is still not comparable."],
			["Site", "Account", "Utility", "ZIP", "Rate", "Code", "TOU", "Comparison basis",
			 "kWh in", "Peak kW in", "Modeled $", "Energy $", "Demand $", "Other $", "c/kWh", "Status"]];
		// Same reason as the Executive Summary: report the demand figure that was
		// actually sent to the tariff API, not the rounded one on screen.
		const tarPeak = (r) => {
			const a = accounts[String(r.location_id)];
			return a ? Number(a.peakKw.toFixed(2)) : r.peak_kw;
		};
		for (const r of rows) {
			for (const t of RateClassData._ratesFor(r.location_id)) {
				const status = t.error ? ("Errored — " + String(t.error).slice(0, 140))
					: (t.deliveryOnly ? "Delivery-only utility — not comparable to a bundled bill"
					: (t.nonService ? "Not full-requirements service — not comparable"
					: (t.demandIncomplete ? "Bills no demand charge on a demand-metered load" : "Comparable")));
				tar.push([r.site, r.account_code, t.lseName, r.zip, t.tariffName, t.tariffCode,
					t.isTOU ? "Yes" : "No", t.isUtilityDefaultPick ? "Yes" : "No",
					r.annual_kwh, tarPeak(r),
					money(t.modeledAnnualCost), money(t.modeledEnergy), money(t.modeledDemand),
					money(t.modeledOther), cents(t.modeledAnnualCost, r.annual_kwh), status]);
			}
		}
		sheets.push({ name: "Tariff Results", rows: tar });

		// ---- Actual vs Modeled ------------------------------------------------
		// Compared by charge GROUP rather than line by line. A utility reuses one
		// label for structurally different charges (three rows all called
		// "Distribution Charges", one of them the demand charge) and the bills word
		// the same charge differently again, so a line-for-line match is not
		// available. Group differences sum exactly to the total, which is the part
		// worth trusting.
		const avm = [["Actual vs modeled — charge by charge, for every rate"],
			["What was actually billed against what each utility rate would have charged for the same months. The actual side comes from UBM's charge categories on the monthly feed, which reconcile to the billed total; the billing line-item table is deliberately not used — see the Data & Methodology sheet."],
			["Site", "Account", "Utility rate", "Code", "Charge group", "Actual $", "Modeled $",
			 "Difference $", "Basis / caveat"]];
		for (const r of rows) {
			const a = accounts[String(r.location_id)];
			if (!a) continue;
			const acct = { locationId: a.id, locationName: a.name, months: a.months,
				chgTotals: a.chgTotals, actualAnnual: a.actualAnnual };
			for (const t of RateClassData._ratesFor(r.location_id)) {
				if (t.modeledAnnualCost == null) continue;
				const cmp = RateClassData._compareForRate(acct, t);
				for (const g of cmp.groups) {
					avm.push([r.site, r.account_code, t.tariffName, t.tariffCode, g.group,
						g.actual, g.modeled, g.delta,
						g.basis + (g.oneSided ? "  |  one side only — the other side has no counterpart charge" : "")]);
				}
				avm.push([r.site, r.account_code, t.tariffName, t.tariffCode, "TOTAL",
					cmp.actualTotal, cmp.modeledTotal,
					Number((cmp.modeledTotal - cmp.actualTotal).toFixed(2)),
					cmp.varianceHigh
						? ("charge categories total " + cmp.actualTotal + " against a billed total of "
							+ cmp.baselineTotal + " (" + cmp.variancePct + "%) — investigate before relying on the split")
						: "categories reconcile to the billed total"]);
			}
		}
		sheets.push({ name: "Actual vs Modeled", rows: avm });

		// ---- Actual Charge Detail ---------------------------------------------
		const acd = [["Actual billed charges by category"],
			["Straight from UBM, split by invoice. This is the actual side of the comparison, shown once per account rather than repeated against every rate. Unclassified is billed cost UBM assigns to no category; it is carried explicitly rather than spread across the others so the total stays exact."],
			["Site", "Account", "Stream", "Consumption", "Generation", "Commodity", "Demand",
			 "Customer", "Taxes", "Other", "Unclassified", "TOTAL"]];
		const CHG = ["consumption", "generation", "commodity", "demand", "customer", "taxes", "other", "unclassified"];
		for (const r of rows) {
			const a = accounts[String(r.location_id)];
			if (!a) continue;
			const c = a.chgTotals || {}, sup = a.chgSupply || {};
			const del = {};
			for (const k of CHG) del[k] = (Number(c[k]) || 0) - (Number(sup[k]) || 0);
			if (a.supplyAnnual) {
				acd.push([r.site, r.account_code, "SUPPLY"].concat(
					CHG.map(k => money(sup[k])), [money(a.supplyAnnual)]));
			}
			acd.push([r.site, r.account_code, a.supplyAnnual ? "DELIVERY / OTHER" : "ALL INVOICES"].concat(
				CHG.map(k => money(del[k])), [money(a.actualAnnual - a.supplyAnnual)]));
			acd.push([r.site, r.account_code, "ACCOUNT TOTAL"].concat(
				CHG.map(k => money(c[k])), [money(a.actualAnnual)]));
		}
		sheets.push({ name: "Actual Charge Detail", rows: acd });

		// ---- Line Item Comparison ---------------------------------------------
		const li = [["Line item comparison"],
			["The modeled charge components behind each rate's total. The actual side is billed as invoices (supply / delivery) rather than as tariff components, so the totals compare but the components do not map one to one."],
			["Site", "Account", "Rate", "Code", "Charge component", "Quantity", "Unit", "Unit rate", "Modeled $"]];
		for (const r of rows) {
			for (const t of RateClassData._ratesFor(r.location_id)) {
				for (const x of (t.lines || [])) {
					li.push([r.site, r.account_code, t.tariffName, t.tariffCode, x.name,
						Number((Number(x.qty) || 0).toFixed(2)), x.qty_unit || "",
						Number((Number(x.rate) || 0).toFixed(5)), money(x.cost)]);
				}
			}
		}
		sheets.push({ name: "Line Item Comparison", rows: li });

		// ---- Not Modeled ------------------------------------------------------
		// The sheet that makes the account count reconcile. Without it a reader
		// comparing the app's account list against the results has no way to tell
		// whether an account is missing on purpose.
		const skipped = RateClassData.skippedRows();
		const nm = [["Accounts not modeled"],
			["Excluded from every figure in this workbook, and listed here with the reason so the account count in the results can always be reconciled against the account count in the app."],
			["Account / location", "ZIP", "Actual $ over the window", "Why it was not modeled"]];
		for (const x of skipped) nm.push([x.location, x.zip, money(x.actual_annual), x.reason]);
		if (!skipped.length) nm.push(["—", "", "", "Every eligible account was modeled."]);
		sheets.push({ name: "Not Modeled", rows: nm });

		sheets.push({ name: "Data & Methodology",
			rows: RateClassData._methodologyRows(customer, pm, rows, term, windowLabel) });
		return sheets;
	},

	// The workbook is read away from the app, so what was done and what it cannot
	// answer are written into it rather than left to be inferred from the numbers.
	_methodologyRows(customer, pm, rows, term, windowLabel) {
		const R = [];
		const p = (t) => R.push([t]);
		p(customer + " — tariff comparison: data & methodology");
		p("");
		p("Scope");
		p("UBM customer " + (pm.customerId || "") + ". "
			+ (pm.scope === "all accounts" ? "All eligible electric accounts." : "One account: " + pm.scope + ".")
			+ " " + rows.length + " account(s) modeled out of " + (pm.locationsFound || rows.length)
			+ " found; " + ((pm.skipped || []).length) + " not modeled, each named with a reason on the Not Modeled sheet.");
		p("The grain is the physical account, not the site. Two accounts at one site can differ by orders of magnitude in consumption and qualify for different rate classes, so rolling them together would model a load profile that does not exist.");
		p("");
		p("Analysis period");
		p("Each account is anchored on its OWN most recent " + term + " months (" + windowLabel
			+ " across the portfolio). A shared window would price a closed account against months it has no bills for, which reads as a large fake saving. Months more than one month older than an account's own window are dropped, so a data gap cannot build a multi-year request the tariff API rejects.");
		p("");
		p("Actual cost");
		p("In a deregulated market the same meter is billed twice: a Supply Only invoice from the competitive supplier and a Distribution Only invoice from the utility. Actual cost is the two together. A supplier change opens a new virtual account under a supplier-assigned number; those are chained back together by virtual account group, and the supply and delivery chains are joined by the utility's account number, which both begin under. Nothing is double-counted: consumption is taken from the delivery bill, which is the metered volume, and falls back to the supply bill's generation figure only for a month where the supplier alone billed.");
		p("A third bill type, Full Service, is the utility supplying and delivering on one invoice. Those accounts hold no competitive contract, so no contract-versus-utility figure is reported for them; the alternative-rate comparison still applies and is what to read.");
		p("");
		p("Utility comparison");
		p("Every currently effective, non-closed, commercial (GENERAL customer class) rate class published by the serving utility was priced on the account's own monthly consumption and demand readings through the Arcadia/Genability tariff API, as one annual calculation per rate. These are bundled utility rates — delivery plus default generation — which is what the account would have paid had it never gone to a competitive supplier, so they are comparable to supply and delivery combined.");
		p("The serving utility is taken from the vendor on the bill. A ZIP is rarely served by one utility: the lookup also returns co-ops and munis whose territory merely overlaps it, and a site cannot join a co-op, so pricing their schedules would produce a cheapest rate the customer could never buy. Where the bill's vendor cannot be matched to any utility in the ZIP, every utility there is priced and the account is flagged rather than silently narrowed to none.");
		p("Excluded before pricing: riders and surcharges (a rider alone is one line, sometimes a credit, and models as a meaningless bill), closed and grandfathered schedules, residential and special-use classes, unmetered schedules and EV-charging schedules. Economically identical net-metering and fuel-mix variants of the same rate are collapsed to one so they do not crowd out distinct rates.");
		p("Difference = modeled utility cost minus actual cost. Positive means the utility rate would have cost more, i.e. the current arrangement is the cheaper one.");
		p("");
		p("Data quality protections");
		p("An account is not modeled at all when it has no bills in the window, no ZIP, a non-U.S. location (the tariff database covers U.S. utilities only, and a non-U.S. postcode collides with a five-digit U.S. ZIP and resolves to the wrong utility), no consumption, or no billed cost. Every such account is named on the Not Modeled sheet with the reason.");
		p("Where demand readings are missing (real usage against 0 kW), impossibly high (implied load factor under 2%) or impossibly low (implied load factor over 100%), the modeled demand charge is wrong — and on a demand-metered account that is the largest component of the bill. Those accounts are priced and shown, but no recommendation is made for them and their figures are kept out of the portfolio totals.");
		p("Rates that model below roughly 2 cents/kWh are not full-requirements service (parallel generation, standby, incremental-load pricing) and are excluded from the ranking. Texas delivery-only wires utilities are excluded on the same grounds: their published tariffs carry no energy component, so their modeled bill is not comparable to a bundled actual bill.");
		p("");
		p("Limitations");
		p("1. Time-of-use and hourly-priced rates are modeled on a default load shape because interval data is not available. They are flagged in the Notes column and should be read as directional.");
		p("2. Rate eligibility comes from each tariff's published applicability limits, not from service voltage or contract terms. Some rates listed would not genuinely be offered to the account. Read the comparison basis and the cheapest applicable rate, not the full range.");
		p("3. Where the utility publishes no schedule typed as its standard offer — usual on commercial accounts, where every rate comes back as an alternative — the cheapest applicable rate is used as the comparison basis instead, and the basis used is stated per account. Before a figure goes to a client the applicable rate should be confirmed against the utility's published Price to Compare.");
		p("4. UBM often records vendor_name as the utility on the supply invoice too, so the competitive supplier's trading name is not always recoverable. Where it is not, the supplier is identified by its supply account number instead.");
		p("5. Where UBM books no separate demand charge and carries the whole amount as consumption, energy and demand are shown combined on the actual side. Splitting them would produce a large negative on one and an equal positive on the other that cancel out and mean nothing.");
		p("6. The Actual vs Modeled sheet compares at charge-group level, not line by line, for the reasons given on that sheet. Group differences sum exactly to the total.");
		p("7. UBM's billing line-item table was tested as the source for the actual side and rejected: on the accounts checked it held only 25-60% of what was actually billed, which would have understated actual cost by roughly a third to a half and made every contract look better than it was. The actual side therefore comes from the monthly usage table's charge-category columns, the same source as the totals; whatever those categories do not account for is carried as an explicit Unclassified line so the totals stay exact.");
		p("8. Charges the modeled rate produces no counterpart for — most often taxes, which the tariff API does not carry — would still be payable on the utility rate. Where that happens the account's difference is overstated by roughly that amount, and the app flags it on screen.");
		p("9. Tariffs are priced against today's published schedules. Genability versions tariffs internally and resolves the correct version per billing period, but a rate that changed mid-window is worth spot-checking before a figure is quoted externally.");
		p("");
		p("Reproducibility");
		p("Run " + (pm.runAt || "") + " from the Rate Class Analysis page. Modeled costs come from the Arcadia/Genability tariff API; actual costs from UBM's monthly usage reporting. A failed tariff call is retried three times with backoff and, if it still fails, counted and reported rather than dropped — an errored rate could have been the cheapest one.");
		return R;
	},

	// Wired to the export button.
	async exportWorkbook() {
		const rows = RateClassData.filteredPortfolio();
		if (!rows.length) {
			showAlert("Run an analysis first", "warning");
			return;
		}
		await storeValue("rc_loading", true);
		await storeValue("rc_progress", "Generating the report…");
		try {
			const sheets = RateClassData.buildWorkbook();
			const pm = RateClassData.portfolioMeta();
			const who = pm.customerName
				|| ((typeof RC_CustomerSelect !== "undefined" && RC_CustomerSelect.selectedOptionLabel) || "customer");
			const stem = "rate-class-analysis-"
				+ String(who).replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()
				+ "-" + moment().format("YYYYMMDD");

			if (RateClassData._xlsxAvailable()) {
				const wb = XLSX.utils.book_new();
				for (const sh of sheets) {
					XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows),
						String(sh.name).slice(0, 31));
				}
				const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
				await download("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64,
					stem + ".xlsx");
				showAlert("Workbook downloaded — " + sheets.length + " sheets, " + rows.length + " account(s)", "success");
				return;
			}
			// Fallback: SpreadsheetML 2003. Excel opens it with the tabs intact and
			// warns once that the format differs from the extension. Say so, rather
			// than leaving someone to wonder whether the file is broken.
			await download(RateClassData._toSpreadsheetXml(sheets), stem + ".xls", "application/vnd.ms-excel");
			showAlert("Workbook downloaded as Excel XML — " + sheets.length
				+ " sheets. Excel may warn once that the format differs from the .xls extension; open it anyway.", "success");
		} catch (e) {
			showAlert("Could not build the workbook: " + ((e && e.message) || e), "error");
		} finally {
			await storeValue("rc_loading", false);
			await storeValue("rc_progress", "");
		}
	},

	// Kept so any existing binding to exportCsv() still works; the deliverable is
	// the workbook now, so this produces the same file.
	exportCsv() { return RateClassData.exportWorkbook(); },

	// =====================================================================
	// Screen navigation / lifecycle
	// =====================================================================
	// Discards the run and leaves the account list showing. Deliberately not a
	// plain "back": the results tabs sit above the account list inside the same
	// widget, so there is nowhere to navigate back TO — the only thing this can
	// usefully do is clear the results.
	goBack() {
		return RateClassData.resetAll();
	},

	// Run on page load (queries/RateClassData-initPage/metadata.json is AUTOMATIC).
	// Loads the customer list here and captures each run's RETURN value into the
	// store, never reading a query's result property back, so the option getters
	// stay pure store readers and avoid the reactive-dependency-misuse error.
	async initPage() {
		await RateClassData._clearRun();
		await storeValue("rc_inventory", [], false);
		await storeValue("rc_screen", 1);
		await storeValue("rc_loading", false);
		await storeValue("rc_inv_loading", false);
		await storeValue("rc_f_site", "");
		await storeValue("rc_f_vendor", "");
		await storeValue("rc_f_location", "");
		// An earlier build cached completed analyses in the store, and because the
		// store persists across reloads a code change would keep serving the old
		// result shape. Results are session-only now; this clears anything a previous
		// build left behind in localStorage.
		await storeValue("rc_cache", null);
		const res = await RC_fetchCustomers.run();
		const arr = Array.isArray(res) ? res : ((res && (res.data || res.body)) || []);
		await storeValue("rc_customer_opts", Array.isArray(arr) ? arr : []);
		// RC_CustomerSelect carries a default customer, so load that customer's
		// locations and accounts up front — otherwise the page opens on an empty
		// table and reads as broken until someone re-picks the customer they can
		// already see selected.
		const locRes = await RC_fetchLocations.run();
		const locArr = Array.isArray(locRes) ? locRes : ((locRes && (locRes.data || locRes.body)) || []);
		await storeValue("rc_location_opts", Array.isArray(locArr) ? locArr : []);
		await storeValue("rc_screen", 4);
		await RateClassData.loadInventory();
	},

	async resetAll() {
		await RateClassData._clearRun();
		await storeValue("rc_screen", (appsmith.store.rc_inventory || []).length ? 4 : 1);
	}
}
