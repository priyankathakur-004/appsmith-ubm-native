export default {
	// =====================================================================
	// Rate Class Analysis  (rebuilt per Sunny's "live data" requirement)
	//
	// Old flow: user typed zip + consumption + demand, picked tariffs by hand,
	// got a single-month cost per tariff.
	//
	// New flow: user picks a Customer + Location. We auto-load the last 12 months
	// of electric consumption (kWh), demand (kW) and the actual charges paid
	// (RC_LocationUsage), look up the serving utilities by the location's zip,
	// pull every electric tariff, and model a full ANNUAL bill for each tariff in
	// ONE Genability /calculate call (12 monthly inputs per call — not 12 calls).
	// We then compare each tariff's modeled annual cost against the actual annual
	// cost and rank by savings, highlighting the best rate.
	//
	// All Genability calls go through fetch() (same pattern the old runCalculate
	// used) so we never depend on the bound REST queries or on hidden widgets.
	// =====================================================================

	// ---- Genability API config (Basic token shared with the REST datasource) ----
	_GENABILITY_BASE: "https://api.genability.com",
	_GENABILITY_AUTH: "Basic ZjVjOGRlNmYtZTYyMi00ZTY3LTljNjctN2Y0MDg3ODFmMDQ5OmNkZTk1ZTQwLWYxNDUtNGQzNy05ZTdiLWNhYzFkY2M1ZmRkYw==",

	// Cap the number of tariffs we model in one run so a zip with hundreds of
	// tariffs can't lock up the browser. If we hit the cap we tell the user.
	_MAX_TARIFFS: 80,
	// How many Genability calc calls run concurrently. Keeps the UI responsive
	// and stays well under Genability's rate limits.
	_CALC_CONCURRENCY: 6,

	// ---- Portfolio ("all accounts") mode ----
	// Locations analysed concurrently. Each one runs up to _PORTFOLIO_CALC_CONCURRENCY
	// calc calls, so in-flight Genability requests peak at the product of the two —
	// kept at 12 for the same reason _CALC_CONCURRENCY is 6 on the single-location
	// screen (responsive UI, comfortably inside Genability's rate limits).
	_LOC_CONCURRENCY: 2,
	_PORTFOLIO_CALC_CONCURRENCY: 6,
	// Hard cap on locations modeled in one portfolio run. A large customer can have
	// hundreds of sites; at ~40 rate classes each that is thousands of API calls and
	// a browser tab that never finishes. Above the cap we model the highest-spend
	// locations (that is where the savings are) and say so in the summary.
	_MAX_LOCATIONS: 40,

	// =====================================================================
	// Dropdown option getters
	// =====================================================================
	// Reads from the store, NOT RC_fetchCustomers.data. Same reason as
	// locationOptions: reading a query's .data in the JSObject while the query is
	// also triggered (here it's run on load via initPage) raises Appsmith's
	// "Reactive dependency misuse" error and breaks the whole JSObject.
	customerOptions() {
		const arr = appsmith.store.rc_customer_opts;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(c => ({ label: c.name, value: c.id }));
	},

	// Reads from the store, NOT RC_fetchLocations.data — reading a query's .data
	// here while onCustomerChange() also .run()s it triggers Appsmith's
	// "Reactive dependency misuse" error (one entity both triggering and reading
	// the same query), which breaks evaluation of the whole JSObject.
	locationOptions() {
		const arr = appsmith.store.rc_location_opts;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(l => ({ label: l.name, value: l.id }));
	},

	// =====================================================================
	// Selection handlers (wired to the SELECT widgets' onOptionChange)
	// =====================================================================
	async onCustomerChange() {
		await storeValue("rc_results", []);
		await storeValue("rc_usage", []);
		await storeValue("rc_location_opts", []);
		await storeValue("rc_lineitems", null);
		await storeValue("rc_portfolio", []);
		await storeValue("rc_portfolio_meta", {});
		await storeValue("rc_portfolio_lineitems", {});
		await storeValue("rc_screen", 1);
		const res = await RC_fetchLocations.run();
		const arr = Array.isArray(res) ? res : ((res && (res.data || res.body)) || []);
		await storeValue("rc_location_opts", Array.isArray(arr) ? arr : []);
	},

	// Picking a location kicks off the whole analysis.
	async onLocationChange() {
		await RateClassData.runAnalysis();
	},

	// =====================================================================
	// Orchestrator
	// =====================================================================
	async runAnalysis() {
		const customerId = (typeof RC_CustomerSelect !== "undefined") ? RC_CustomerSelect.selectedOptionValue : null;
		const locationId = (typeof RC_LocationSelect !== "undefined") ? RC_LocationSelect.selectedOptionValue : null;
		if (!customerId || !locationId) {
			showAlert("Pick a customer and a location first", "warning");
			return;
		}

		// Cache: skip the whole pipeline if we've already analysed this location.
		// The version prefix invalidates entries from older builds whose result
		// shape differs (e.g. before the ALTERNATIVE rate-class fix) — appsmith
		// store persists across reloads, so without this an old cached result
		// would keep showing after a code change.
		const cacheKey = `v6:${customerId}:${locationId}`;
		const cache = appsmith.store.rc_cache || {};
		if (cache[cacheKey]) {
			await storeValue("rc_usage", cache[cacheKey].usage);
			await storeValue("rc_results", cache[cacheKey].results);
			await storeValue("rc_meta", cache[cacheKey].meta);
			await storeValue("rc_all_tariffs", cache[cacheKey].allTariffs || []);
			await storeValue("rc_screen", 2);
			return;
		}

		await storeValue("rc_loading", true);
		await storeValue("rc_progress", "Loading 12 months of usage…");
		await storeValue("rc_status", "");
		// Clear any prior analysis up front so an early exit (no usage, non-US, no
		// tariffs…) shows only its status message — not the previous location's
		// results/summary lingering below. Success sets rc_screen back to 2.
		await storeValue("rc_results", []);
		await storeValue("rc_meta", {});
		await storeValue("rc_all_tariffs", []);
		await storeValue("rc_screen", 1);

		try {
			// --- 1. Load the location's last 12 months of usage + actual cost ---
			const usageRaw = await RC_LocationUsage.run();
			let usage = Array.isArray(usageRaw) ? usageRaw : [];
			if (!usage.length) {
				const msg = "Step 1: RC_LocationUsage returned 0 rows for this customer/location. The location may have no ELECTRIC bills, or utility_type isn't 'ELECTRIC'. Run RC_LocationUsage manually to check.";
				showAlert("No electric usage found for this location", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}
			// Drop stray ancient months. A data gap can make "the latest 12 rows"
			// span years (e.g. 10 recent months + two rows from 2020–21), which
			// builds a multi-year /calculate window Genability rejects — every rate
			// then errors. Keep only months within 13 months of the most recent.
			{
				const desc = usage.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
				const newest = moment(desc[0].month);
				usage = desc.filter(r => newest.diff(moment(r.month), "months") <= 13);
			}
			await storeValue("rc_status", `Step 1 OK: ${usage.length} months of usage loaded.`);
			const months = usage.map(r => ({
				month: r.month,
				kwh: Number(r.kwh) || 0,
				kw: Number(r.kw) || 0,
				actual: Number(r.actual_charges) || 0
			}));
			const zip = RateClassData._pickStr(usage[0], ["postcode"]);
			const locationName = RateClassData._pickStr(usage[0], ["location_name"]);
			const country = RateClassData._pickStr(usage[0], ["country"]);
			const state = RateClassData._pickStr(usage[0], ["state"]);
			const actualAnnual = months.reduce((s, m) => s + m.actual, 0);
			const monthCount = months.length;
			await storeValue("rc_usage", usage);

			// Guard: Genability/Arcadia only covers U.S. utilities. A non-U.S.
			// postal code (e.g. a Mexican CP) collides with a 5-digit U.S. ZIP and
			// resolves to the wrong utility (e.g. Aguascalientes CP 20355 → Pepco
			// in Washington DC), producing a meaningless comparison. Refuse rather
			// than model it. Empty/US country is allowed through.
			if (country && !RateClassData._isUSCountry(country)) {
				const msg = `This location is in ${country}${state ? ", " + state : ""}. The Arcadia/Genability tariff database only covers U.S. utilities, so rate-class modeling isn't available here (a non-U.S. postcode would be mis-matched to a U.S. ZIP).`;
				showAlert("Non-U.S. location — tariff modeling not available", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}

			if (!zip || String(zip).trim().length < 3) {
				const msg = "Step 1: usage loaded but the location has no postcode — cannot look up tariffs.";
				showAlert("This location has no postcode on file — cannot look up tariffs", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}

			// --- 2-5. Tariff lookup, modeling and ranking. Shared verbatim with the
			// portfolio run (_analyzeLocation) so a single-location result and the
			// same location inside an "all accounts" run can never disagree.
			const out = await RateClassData._analyzeLocation(
				months,
				{ zip, locationName, actualAnnual, monthCount },
				{ lses: {}, tariffs: {} },
				{
					concurrency: RateClassData._CALC_CONCURRENCY,
					onProgress: (m) => storeValue("rc_progress", m),
					onNote: (m) => storeValue("rc_status", m)
				}
			);
			if (out.error) {
				showAlert(out.alert || "Analysis could not run for this location", "warning");
				await storeValue("rc_status", out.error);
				await storeValue("rc_loading", false);
				return;
			}
			const ranked = out.ranked;
			const meta = out.meta;
			await storeValue("rc_all_tariffs", out.allTariffs);

			// --- 6. Pull the ACTUAL billed line items for the same window and compare
			// them against the recommended rate's modeled charges. ---
			await storeValue("rc_progress", "Comparing billed line items…");
			const liCompare = await RateClassData._buildLineItemCompare(
				customerId, [{ locationId: Number(locationId), locationName, months }], ranked
			);
			await storeValue("rc_lineitems", liCompare[String(locationId)] || null);

			await storeValue("rc_results", ranked);
			await storeValue("rc_meta", meta);
			await storeValue("rc_status", "");
			await storeValue("rc_screen", 2);

			// Cache for instant re-selection.
			const newCache = Object.assign({}, appsmith.store.rc_cache || {});
			newCache[cacheKey] = { usage, results: ranked, meta, allTariffs: allTariffsTagged };
			await storeValue("rc_cache", newCache);
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
		parts.push(`Actual ${m.monthCount}-mo cost: $${(m.actualAnnual || 0).toFixed(2)}`);
		parts.push(`${m.modeledCount}/${m.tariffCount} rate classes modeled`);
		if (best) {
			parts.push(`Best: ${best.tariffName} — save $${best.annualSavings.toFixed(2)} (${best.savingsPct.toFixed(1)}%)`);
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
			utilityUnmatched: !!(ctx.servingUtility && lses.length > 1)
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
	// Portfolio mode — model EVERY account of the customer in one run
	// =====================================================================
	// Wired to Btn_RC_analyzeAll. Loads 24 months of usage for all locations in
	// one query, takes each location's own latest 12 months, runs the shared
	// per-location pipeline over them, and rolls the result up to a customer-level
	// savings figure. Locations that cannot be modeled are reported with a reason
	// rather than dropped, so the rollup is never quietly incomplete.
	async runCustomerAnalysis() {
		const customerId = (typeof RC_CustomerSelect !== "undefined") ? RC_CustomerSelect.selectedOptionValue : null;
		if (!customerId) {
			showAlert("Pick a customer first", "warning");
			return;
		}

		await storeValue("rc_loading", true);
		await storeValue("rc_progress", "Loading usage for every account…");
		await storeValue("rc_status", "");
		await storeValue("rc_results", []);
		await storeValue("rc_meta", {});
		await storeValue("rc_all_tariffs", []);
		await storeValue("rc_lineitems", null);
		await storeValue("rc_portfolio", []);
		await storeValue("rc_portfolio_meta", {});
		await storeValue("rc_portfolio_lineitems", {});
		await storeValue("rc_screen", 1);

		try {
			// --- 1. One query for all locations, 24 months ---
			const raw = await RC_CustomerUsage.run();
			const rows = Array.isArray(raw) ? raw : [];
			if (!rows.length) {
				const msg = "RC_CustomerUsage returned 0 rows for this customer. No ELECTRIC usage is recorded in reports_customer_monthly_usage for the last 24 months.";
				showAlert("No electric usage found for this customer", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}

			// --- 2. Group by location, take each location's own latest 12 months ---
			// Per-location rather than one customer-wide window: sites stop and start
			// billing at different times, so a shared window would model a closed site
			// against months it has no bills for (and read as a huge fake saving).
			// Key on account_key — the physical account, with its supply and delivery
			// invoices already combined and any supplier change already stitched by the
			// query. Keying on the virtual account would split each site into a supply
			// row and a delivery row and price both against a bundled utility tariff
			// neither is comparable to; keying on the virtual account GROUP would still
			// leave the two streams apart, since they sit in different groups; keying on
			// the location would merge accounts whose loads differ by orders of
			// magnitude into a profile that doesn't exist.
			const byLoc = new Map();
			for (const r of rows) {
				const id = String(r.account_key != null ? r.account_key
					: (r.virtual_account_id != null ? r.virtual_account_id : r.location_id));
				if (!byLoc.has(id)) byLoc.set(id, []);
				byLoc.get(id).push(r);
			}

			const specs = [];
			const skipped = [];
			for (const [id, list] of byLoc.entries()) {
				// Identity fields are read across the whole series rather than off list[0]:
				// several of them (a post-change supply account code, a supplier name) are
				// null for the earlier months, so depending on which row happens to arrive
				// first would silently drop them.
				const firstOf = (key) => {
					for (const row of list) {
						const v = RateClassData._pickStr(row, [key]);
						if (v) return v;
					}
					return "";
				};
				const first = list[0] || {};
				const site = firstOf("location_name") || `Location ${id}`;
				const acctCode = firstOf("account_code") || firstOf("client_account");
				// Label carries the account number: with several accounts per site the
				// site name alone doesn't identify a row.
				const name = acctCode ? `${site} — ${acctCode}` : site;
				const zip = firstOf("postcode");
				const country = firstOf("country");
				const state = firstOf("state");
				// The bill's vendor is the serving utility, which stops co-op and muni
				// schedules in the same ZIP from being priced as switchable options.
				const vendor = firstOf("vendor_name");

				// Same window rule as the single-location screen: newest 12 months, then
				// drop anything more than 13 months older than the newest, so a data gap
				// can't build a multi-year /calculate window Genability rejects.
				const term = RateClassData.analysisTerm();
				const desc = list.slice().sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, term);
				const newest = moment(desc[0].month);
				// One month of slack past the term so a data gap can't build a window
				// wider than Genability will accept.
				const kept = desc.filter(r => newest.diff(moment(r.month), "months") <= term + 1);
				const months = kept.map(r => ({
					month: r.month,
					kwh: Number(r.kwh) || 0,
					kw: Number(r.kw) || 0,
					// Actual cost is both invoices together — that is what the site paid,
					// and the only figure comparable to a bundled utility tariff.
					actual: Number(r.actual_charges) || 0,
					supply: Number(r.supply_charges) || 0,
					delivery: Number(r.delivery_charges) || 0,
					fullService: Number(r.full_service_charges) || 0
				}));
				const actualAnnual = months.reduce((s, m) => s + m.actual, 0);
				const supplyAnnual = months.reduce((s, m) => s + m.supply, 0);
				const deliveryAnnual = months.reduce((s, m) => s + m.delivery, 0);
				const fullServiceAnnual = months.reduce((s, m) => s + m.fullService, 0);
				// A competitive contract exists only where the supplier billed separately.
				// A Full Service invoice is the utility doing both, so there is no
				// contract to compare and reporting a saving against one would be
				// inventing it.
				const hasSupply = supplyAnnual !== 0;

				// Arcadia/Genability only covers U.S. utilities — a non-U.S. postcode
				// collides with a 5-digit U.S. ZIP and resolves to the wrong utility.
				if (country && !RateClassData._isUSCountry(country)) {
					skipped.push({ id, name, zip, actualAnnual, reason: `Non-U.S. location (${country}${state ? ", " + state : ""}) — Arcadia covers U.S. utilities only` });
					continue;
				}
				if (!zip || String(zip).trim().length < 3) {
					skipped.push({ id, name, zip: "", actualAnnual, reason: "No postcode on file — cannot look up tariffs" });
					continue;
				}
				if (!months.length) {
					skipped.push({ id, name, zip, actualAnnual, reason: "No usable months in the last 24 months" });
					continue;
				}
				// No consumption means there is nothing for a tariff to price against:
				// every rate returns its fixed charge only, and comparing that to a real
				// bill is meaningless. Seen on unmetered and standby accounts.
				const totalKwh = months.reduce((s, m) => s + m.kwh, 0);
				if (totalKwh <= 0) {
					skipped.push({ id, name, zip, actualAnnual,
						reason: `No consumption recorded across ${months.length} month(s) — nothing for a rate to price` });
					continue;
				}
				specs.push({ id, name, site, acctCode, vendor, zip, country, state, months,
					actualAnnual, supplyAnnual, deliveryAnnual, fullServiceAnnual, hasSupply,
					supplier: firstOf("supplier_name"),
					supplyAcct: firstOf("supply_account_code"),
					billTypes: firstOf("bill_types"),
					monthCount: months.length });
			}

			// Highest actual spend first: that is where the savings are, and it is the
			// order the cap keeps.
			specs.sort((a, b) => b.actualAnnual - a.actualAnnual);
			let capped = 0;
			let toRun = specs;
			if (specs.length > RateClassData._MAX_LOCATIONS) {
				capped = specs.length - RateClassData._MAX_LOCATIONS;
				toRun = specs.slice(0, RateClassData._MAX_LOCATIONS);
				for (const s of specs.slice(RateClassData._MAX_LOCATIONS)) {
					skipped.push({ id: s.id, name: s.name, zip: s.zip, actualAnnual: s.actualAnnual, reason: `Not modeled — run capped at ${RateClassData._MAX_LOCATIONS} locations (highest spend first)` });
				}
			}

			if (!toRun.length) {
				const msg = `Found ${byLoc.size} location(s) but none could be modeled. Reasons: ${skipped.slice(0, 5).map(s => s.name + " — " + s.reason).join("; ")}`;
				showAlert("No locations could be modeled", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}

			// --- 3. Run the shared pipeline per location, a few at a time ---
			const cache = { lses: {}, tariffs: {} };
			let doneLocs = 0;
			const total = toRun.length;
			const analysed = await RateClassData._mapLimit(toRun, RateClassData._LOC_CONCURRENCY, async (spec) => {
				const out = await RateClassData._analyzeLocation(
					spec.months,
					{ zip: spec.zip, locationName: spec.name, servingUtility: spec.vendor,
					  actualAnnual: spec.actualAnnual, monthCount: spec.monthCount },
					cache,
					{ concurrency: RateClassData._PORTFOLIO_CALC_CONCURRENCY }
				);
				doneLocs += 1;
				await storeValue("rc_progress", `Modeling accounts… ${doneLocs}/${total} — ${spec.name}`);
				return { spec, out };
			});

			// --- 4. Roll up ---
			const portfolio = [];
			const forLineItems = [];
			for (const a of analysed) {
				if (!a) continue;
				const s = a.spec, out = a.out;
				const annualKwh = s.months.reduce((t, m) => t + m.kwh, 0);
				const peakKw = s.months.reduce((mx, m) => Math.max(mx, m.kw), 0);
				const base = {
					location_id: s.id,                  // account_key — the drill-down key
					location: s.name,
					site: s.site || "",
					account_code: s.acctCode || "",
					vendor: s.vendor || "",
					supplier: s.supplier || "",
					supply_account_code: s.supplyAcct || "",
					bill_types: s.billTypes || "",
					supply_annual: Number((s.supplyAnnual || 0).toFixed(2)),
					delivery_annual: Number((s.deliveryAnnual || 0).toFixed(2)),
					full_service_annual: Number((s.fullServiceAnnual || 0).toFixed(2)),
					has_supply: !!s.hasSupply,
					zip: s.zip,
					months: s.monthCount,
					annual_kwh: Math.round(annualKwh),
					peak_kw: Math.round(peakKw),
					actual_annual: Number(s.actualAnnual.toFixed(2))
				};
				if (out.error) {
					portfolio.push(Object.assign(base, {
						utility: "", tariff: "", code: "",
						modeled_annual: null, savings: null, savings_pct: null,
						rates_modeled: 0, status: "Not modeled", note: out.error
					}));
					continue;
				}
				const ranked = out.ranked || [];
				const best = ranked.find(r => r.isBest) || null;
				const top = best || ranked.find(r => r.annualSavings != null && !r.nonService && !r.deliveryOnly && !r.demandIncomplete) || null;
				const m = out.meta || {};
				let status = "OK", note = "";
				if (!top) {
					status = "No comparable rate";
					note = "Every rate Arcadia returned was a rider, delivery-only, non-full-service or errored.";
				} else if (!best && m.demandSuspect) {
					// Ranked for reference but no pick: with demand missing/spurious the
					// top rate is under- or over-modeled and cannot be recommended.
					status = "Demand data unreliable";
					note = "Recommendation withheld — kW readings missing or implausible for this site, so modeled demand charges (and therefore savings) can't be trusted.";
				} else if (!s.hasSupply) {
					status = "Utility supply";
					note = (s.fullServiceAnnual > 0)
						? "Billed Full Service — the utility supplies and delivers on one invoice, so there is no competitive contract to compare against. The alternative-rate figure still applies: it is what a different utility rate would have cost."
						: "No supply invoice in this window, so there is no supply contract to compare against.";
				} else if (!best) {
					status = "No saving";
					note = "No rate class modeled cheaper than the current cost.";
				}
				portfolio.push(Object.assign(base, {
					utility: top ? top.lseName : "",
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
					// The headline number for this engagement: what the site actually paid
					// versus what the utility's standard offer would have cost over the same
					// 12 months. Positive = the supply contract came in cheaper.
					// Only meaningful where a competitive contract exists. On utility supply
					// this would be the utility compared against itself, so it is withheld
					// and the alternative-rate column carries the useful number instead.
					utility_default: m.utilityDefaultName || "",
					utility_default_basis: m.utilityDefaultBasis || "",
					utility_default_code: m.utilityDefaultCode || "",
					utility_default_annual: m.utilityDefaultCost == null ? null : Number(m.utilityDefaultCost.toFixed(2)),
					// Withheld on the same terms as the recommendation. Where the kW readings
					// are missing or impossible the modeled demand charge is wrong, and it
					// is the largest component on a demand-metered site — one account with
					// a 354,048 kW spike against 2.4m kWh priced at $5.3m and single-
					// handedly turned a portfolio that was losing money into a $4.2m
					// saving. A number that wrong should not appear at all, let alone be
					// summed into a total.
					contract_savings: (m.contractSavings == null || !s.hasSupply || m.demandSuspect)
						? null : Number(m.contractSavings.toFixed(2)),
					// A percentage of a base this small is arithmetic noise: a $150 utility
					// figure against a $35,000 bill prints -2511%, which says nothing except
					// that the two are not comparable. Withhold it; the dollar column stands.
					contract_savings_pct: (m.contractSavingsPct == null || m.demandSuspect
						|| !s.hasSupply || !(m.utilityDefaultCost > 100))
						? null : Number(m.contractSavingsPct.toFixed(1)),
					status,
					note
				}));
				if (top) forLineItems.push({ locationId: Number(s.id), locationName: s.name, months: s.months, ranked });
			}
			portfolio.sort((a, b) => (b.savings || 0) - (a.savings || 0) || b.actual_annual - a.actual_annual);

			// --- 5. Billed line items vs. the picked rate's modeled charges ---
			await storeValue("rc_progress", "Comparing billed line items…");
			const liByLoc = await RateClassData._buildLineItemCompare(customerId, forLineItems);

			const totalActual = portfolio.reduce((t, r) => t + (r.actual_annual || 0), 0);
			const totalSavings = portfolio.reduce((t, r) => t + (r.savings > 0 ? r.savings : 0), 0);
			// Contract-vs-utility rolls up over the accounts where a standard offer was
			// actually found and priced; accounts without one are counted separately so
			// the total is never quietly built from a subset.
			// Same basis as the header cards: only accounts holding a competitive
			// supply contract. Including Full Service accounts here made the summary
			// line contradict the cards directly above it.
			const withDefault = portfolio.filter(r => r.contract_savings != null && r.has_supply && !r.demand_suspect);
			const totalUtilityDefault = withDefault.reduce((t, r) => t + (r.utility_default_annual || 0), 0);
			const totalActualWithDefault = withDefault.reduce((t, r) => t + (r.actual_annual || 0), 0);
			// Summed from the per-account figures for the same reason as the cards.
			const totalContractSavings = withDefault.reduce((t, r) => t + (r.contract_savings || 0), 0);
			const pmeta = {
				customerId,
				locationsFound: byLoc.size,
				locationsModeled: portfolio.filter(r => r.status === "OK" || r.savings != null).length,
				locationsRun: portfolio.length,
				withSaving: portfolio.filter(r => r.savings > 0).length,
				demandSuspect: portfolio.filter(r => r.status === "Demand data unreliable").length,
				notModeled: portfolio.filter(r => r.status === "Not modeled").length,
				capped,
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

			await storeValue("rc_portfolio", portfolio);
			await storeValue("rc_portfolio_meta", pmeta);
			await storeValue("rc_portfolio_lineitems", liByLoc);
			await storeValue("rc_status", "");
			await storeValue("rc_screen", 3);
		} catch (e) {
			const msg = "Portfolio analysis failed: " + ((e && e.message) || e);
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
	// Charge classification. A utility bill and a Genability tariff almost never
	// use the same wording for the same charge ("Distribution Charge" vs "Delivery
	// Energy Charge"), so pairing by name would leave most lines unmatched and
	// overstate the difference. Instead both sides are classified into the same
	// small set of buckets and compared bucket by bucket; the raw lines are still
	// listed underneath so the wording is visible.
	//
	// This is a heuristic, not a mapping supplied by the utility — the grand total
	// and the bucket totals are the numbers to trust, individual bucket splits are
	// indicative. Order matters: the first pattern that matches wins.
	_LINE_BUCKET_RULES: [
		["Transmission",            "transmis"],
		["Supply / Generation",     "supply|generation|\\bgen\\b|commodity|procurement|power cost|purchased power|\\bfuel\\b"],
		["Delivery / Distribution", "deliver|distribut|\\bdist\\b|\\bwires\\b"],
		["Energy / Consumption",    "energy|consumption|\\bkwh\\b|kilowatt.?hour|usage"],
		["Taxes & Fees",            "\\btax|franchise|gross receipt|surcharge|assessment|regulat|rider|cost recovery|adjustment|\\badj\\b"],
		["Customer / Fixed",        "customer charge|service charge|basic|meter|facilit|\\bacct\\b|account|admin|monthly|minimum|\\bfee\\b"]
	],

	// Unit is the stronger signal than wording: anything billed per kW is a demand
	// charge whatever the utility calls it, and that is the bucket that usually
	// drives the difference between two rate classes.
	// UBM stamps every line item with a category (Customer Charges, Usage Charges,
	// Taxes, Other Charges). Where it is present it beats inferring intent from the
	// description, so it is consulted first and the wording rules below only handle
	// what the category is too coarse to separate — chiefly splitting Usage Charges
	// into demand versus consumption.
	_lineBucket(name, unit, category) {
		const cat = String(category || "").toLowerCase().trim();
		const n0 = String(name || "").toLowerCase();
		if (cat === "taxes") return "Taxes & Fees";
		if (cat === "customer charges") return "Customer / Fixed";
		if (cat === "other charges" && !/generation|commodity|supply/.test(n0)) return "Taxes & Fees";
		const u = String(unit || "").toLowerCase().trim();
		if (u === "kw" || u === "kva" || u === "kw/mo" || u === "kw-mo") return "Demand";
		const n = String(name || "").toLowerCase();
		if (/\bdemand\b|\bkw\b|\bkva\b|capacity|ratchet/.test(n)) return "Demand";
		for (const rule of RateClassData._LINE_BUCKET_RULES) {
			if (new RegExp(rule[1], "i").test(n)) return rule[0];
		}
		return "Other";
	},

	_BUCKET_ORDER: ["Supply / Generation", "Energy / Consumption", "Demand", "Delivery / Distribution", "Transmission", "Customer / Fixed", "Taxes & Fees", "Other"],

	// Buckets are too fine to compare directly. A real bill unbundles the per-kWh
	// cost into supply + distribution (+ transmission) lines, while a Genability
	// tariff models the utility's single bundled energy charge — so comparing
	// "Distribution" against "Energy Charge" reports a huge shortfall in one and a
	// huge excess in the other when the two actually agree. Rolling every per-kWh
	// line into ONE group is what makes the two sides comparable. Demand, fixed
	// and tax lines are already like-for-like and stay separate.
	_BUCKET_GROUP: {
		"Supply / Generation": "Energy (per kWh)",
		"Energy / Consumption": "Energy (per kWh)",
		"Delivery / Distribution": "Energy (per kWh)",
		"Transmission": "Energy (per kWh)",
		"Demand": "Demand (per kW)",
		"Customer / Fixed": "Fixed / Customer",
		"Taxes & Fees": "Taxes & Fees",
		"Other": "Other"
	},

	_GROUP_ORDER: ["Energy (per kWh)", "Demand (per kW)", "Fixed / Customer", "Taxes & Fees", "Other"],

	// Build the actual-vs-modeled comparison for every location in `locs`.
	//   locs -> [{ locationId, locationName, months, ranked }]
	// Returns { "<locationId>": compareObject }. Runs RC_ActualLineItems ONCE for
	// the whole customer and slices it per location and per window.
	async _buildLineItemCompare(customerId, locs) {
		const out = {};
		if (!locs || !locs.length) return out;

		let liRows = [];
		try {
			const raw = await RC_ActualLineItems.run();
			liRows = Array.isArray(raw) ? raw : [];
		} catch (e) {
			// A failure here must not take the rate analysis down with it — the
			// ranking above is still valid without the line-item split.
			for (const l of locs) {
				out[String(l.locationId)] = { locationName: l.locationName, error: "Could not load billed line items: " + ((e && e.message) || e) };
			}
			return out;
		}

		// Bucket by account_key, the same key the analysis uses, so a site's supply
		// and delivery charges land together on the account they belong to.
		const byLoc = new Map();
		for (const r of liRows) {
			const id = String(r.account_key != null ? r.account_key
				: (r.virtual_account_id != null ? r.virtual_account_id : r.location_id));
			if (!byLoc.has(id)) byLoc.set(id, []);
			byLoc.get(id).push(r);
		}

		for (const l of locs) {
			const id = String(l.locationId);
			const windowMonths = {};
			for (const m of l.months) windowMonths[String(m.month)] = true;
			const baselineTotal = l.months.reduce((t, m) => t + (Number(m.actual) || 0), 0);

			// Only the months this location was actually modeled on.
			const rowsIn = (byLoc.get(id) || []).filter(r => windowMonths[String(r.month)]);

			// Compare against the utility's standard offer first. That is the question
			// being asked — "what would we have paid had we stayed with the utility,
			// charge by charge" — and it is a different rate from the cheapest one the
			// account could switch to. Fall back to the best comparable rate only when
			// no standard offer could be priced, so there is always something to show.
			const ranked = l.ranked || [];
			const rate = ranked.find(r => r.isUtilityDefaultPick && r.modeledAnnualCost != null)
				|| ranked.find(r => r.isBest)
				|| ranked.find(r => r.annualSavings != null && !r.nonService && !r.deliveryOnly && !r.demandIncomplete)
				|| null;

			if (!rowsIn.length) {
				out[id] = {
					locationId: l.locationId, locationName: l.locationName,
					error: `No billed line items found for these ${l.months.length} month(s). analytics_billing_line_items has no live/processed ELECTRIC rows in this window — the monthly totals come from a different table, so a per-charge split isn't available here.`,
					baselineTotal: Number(baselineTotal.toFixed(2))
				};
				continue;
			}

			// Actual side: sum each description across the window.
			const actMap = new Map();
			for (const r of rowsIn) {
				const name = String(r.description || "").trim();
				if (!name) continue;
				const unit = String(r.uom || "").trim();
				const key = name + "|" + unit;
				const g = actMap.get(key) || { name, unit, qty: 0, cost: 0, category: r.category || "" };
				g.qty += Number(r.qty) || 0;
				g.cost += Number(r.charge) || 0;
				actMap.set(key, g);
			}
			const actualLines = Array.from(actMap.values())
				.map(g => ({ name: g.name, unit: g.unit, qty: g.qty, cost: g.cost, bucket: RateClassData._lineBucket(g.name, g.unit, g.category) }))
				.sort((a, b) => b.cost - a.cost);
			const actualTotal = actualLines.reduce((t, x) => t + x.cost, 0);

			// Modeled side: the tariff's charge lines, already grouped by
			// _normalizeCalcResponse.
			const modeledLines = (rate && Array.isArray(rate.lines) ? rate.lines : [])
				.map(x => ({ name: x.name, unit: x.qty_unit, qty: x.qty, cost: x.cost, bucket: RateClassData._lineBucket(x.name, x.qty_unit, null) }))
				.sort((a, b) => b.cost - a.cost);
			const modeledTotal = modeledLines.reduce((t, x) => t + x.cost, 0);

			// Two-level comparison: GROUP is the like-for-like level (see _BUCKET_GROUP
			// for why the finer buckets can't be compared directly); the buckets and
			// the raw lines hang underneath it as detail.
			const gmap = new Map();
			const touchG = (g) => {
				if (!gmap.has(g)) gmap.set(g, { group: g, actual: 0, modeled: 0, buckets: new Map() });
				return gmap.get(g);
			};
			const touchB = (G, b) => {
				if (!G.buckets.has(b)) G.buckets.set(b, { bucket: b, actual: 0, modeled: 0, actualLines: [], modeledLines: [] });
				return G.buckets.get(b);
			};
			const groupOf = (b) => RateClassData._BUCKET_GROUP[b] || "Other";
			for (const x of actualLines) {
				const G = touchG(groupOf(x.bucket)); G.actual += x.cost;
				const B = touchB(G, x.bucket); B.actual += x.cost; B.actualLines.push(x);
			}
			for (const x of modeledLines) {
				const G = touchG(groupOf(x.bucket)); G.modeled += x.cost;
				const B = touchB(G, x.bucket); B.modeled += x.cost; B.modeledLines.push(x);
			}
			const bOrder = RateClassData._BUCKET_ORDER;
			const gOrder = RateClassData._GROUP_ORDER;
			const trimLine = (x) => ({ name: x.name, unit: x.unit, qty: Number(x.qty.toFixed(2)), cost: Number(x.cost.toFixed(2)) });
			const groups = Array.from(gmap.values())
				.map(G => ({
					group: G.group,
					actual: Number(G.actual.toFixed(2)),
					modeled: Number(G.modeled.toFixed(2)),
					delta: Number((G.modeled - G.actual).toFixed(2)),
					// One side has money here and the other has none: the two bills are
					// structurally different, not just differently priced.
					oneSided: (G.actual > 1 && G.modeled < 1) || (G.modeled > 1 && G.actual < 1),
					buckets: Array.from(G.buckets.values())
						.map(b => ({
							bucket: b.bucket,
							actual: Number(b.actual.toFixed(2)),
							modeled: Number(b.modeled.toFixed(2)),
							delta: Number((b.modeled - b.actual).toFixed(2)),
							actualLines: b.actualLines.map(trimLine),
							modeledLines: b.modeledLines.map(trimLine)
						}))
						.sort((a, b) => {
							const d = bOrder.indexOf(a.bucket) - bOrder.indexOf(b.bucket);
							return d !== 0 ? d : b.actual - a.actual;
						})
				}))
				.sort((a, b) => {
					const d = gOrder.indexOf(a.group) - gOrder.indexOf(b.group);
					return d !== 0 ? d : b.actual - a.actual;
				});

			// Charges the customer really pays that the modeled tariff produces no
			// counterpart for (most often taxes and local surcharges, which Genability
			// does not always carry). That money would still be owed on the new rate,
			// so it inflates the headline saving by roughly this amount — say so
			// rather than letting the comparison imply the charge disappears.
			const structuralGap = groups
				.filter(g => g.oneSided && g.actual > g.modeled)
				.reduce((t, g) => t + (g.actual - g.modeled), 0);
			const gapGroups = groups.filter(g => g.oneSided && g.actual > g.modeled).map(g => g.group);

			// The two totals come from different tables on different date bases —
			// line items are keyed by statement_date, the monthly baseline by the
			// prorated calendar month — so they will not tie exactly. Surface the gap
			// instead of letting it silently distort the comparison.
			const variance = actualTotal - baselineTotal;
			const variancePct = baselineTotal !== 0 ? (variance / baselineTotal) * 100 : null;

			out[id] = {
				locationId: l.locationId,
				locationName: l.locationName,
				monthCount: l.months.length,
				windowFrom: l.months.length ? l.months[l.months.length - 1].month : null,
				windowTo: l.months.length ? l.months[0].month : null,
				rate: rate ? {
					tariffName: rate.tariffName, code: rate.tariffCode, utility: rate.lseName,
					isBest: !!rate.isBest, tou: !!rate.isTOU, da: !!rate.isDA, rtp: !!rate.isRTP,
					// Whether this is the "had we stayed with the utility" baseline or a
					// fallback — the reader needs to know which question the split answers.
					isUtilityDefault: !!rate.isUtilityDefaultPick
				} : null,
				actualTotal: Number(actualTotal.toFixed(2)),
				modeledTotal: Number(modeledTotal.toFixed(2)),
				baselineTotal: Number(baselineTotal.toFixed(2)),
				variance: Number(variance.toFixed(2)),
				variancePct: variancePct == null ? null : Number(variancePct.toFixed(1)),
				// Above ~5% the two sources genuinely disagree about this window and the
				// per-charge split should be read as directional only.
				varianceHigh: variancePct != null && Math.abs(variancePct) > 5,
				structuralGap: Number(structuralGap.toFixed(2)),
				gapGroups,
				groups,
				actualLines: actualLines.map(x => ({ name: x.name, unit: x.unit, qty: Number(x.qty.toFixed(2)), cost: Number(x.cost.toFixed(2)), bucket: x.bucket })),
				modeledLines: modeledLines.map(x => ({ name: x.name, unit: x.unit, qty: Number(x.qty.toFixed(2)), cost: Number(x.cost.toFixed(2)), bucket: x.bucket }))
			};
		}
		return out;
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
		// Capped accounts are also pushed onto the skipped list, so report the two
		// groups separately rather than counting the same accounts twice.
		if (m.capped) parts.push(`⚠ ${m.capped} lower-spend account(s) not run — capped at ${RateClassData._MAX_LOCATIONS}`);
		const otherSkipped = (m.skipped || []).length - (m.capped || 0);
		if (otherSkipped > 0) parts.push(`${otherSkipped} account(s) skipped for other reasons (see the Not modeled tab)`);
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
				(diff >= 0 ? "contract cost less" : "utility would have cost less")
					+ (modeled.length < rows.length ? ` · ${modeled.length} of ${rows.length}` : ""),
				diff >= 0 ? "pos" : "neg"),
			card("Difference %", (modeled.length && cheapest) ? ((diff / cheapest) * 100).toFixed(1) + "%" : "—",
				"of the utility cost", diff >= 0 ? "pos" : "neg"),
			card("Total consumption", Math.round(kwh).toLocaleString() + " kWh", `${rows.length} account(s)`),
			card("Peak demand", Math.round(peak).toLocaleString() + " kW",
				suspectPeaks ? `highest of ${sane.length} accounts with sound kW data` : "highest across accounts")
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
	// CSV export
	// =====================================================================
	// One flat file rather than three: the recipients open this in Excel and
	// filter it, and a single "Section" column keeps the accounts summary, the
	// full per-rate ranking and the line-item comparison in one place without
	// juggling files. CSV, not XLSX — the XLSX library's nested helpers are not
	// reliably reachable from the Appsmith JS sandbox.
	_csvCell(v) {
		if (v == null) return "";
		const s = String(v);
		return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	},

	_csvRows(rows) {
		return rows.map(r => r.map(RateClassData._csvCell).join(",")).join("\n");
	},

	// Builds the export from whatever is currently in the store — the portfolio run
	// if there is one, otherwise the single-location analysis.
	buildExportCsv() {
		const port = RateClassData.filteredPortfolio();
		const pmeta = RateClassData.portfolioMeta();
		const isPortfolio = port.length > 0;
		const liMap = isPortfolio ? RateClassData.lineItemsByLoc() : null;
		const single = RateClassData.lineItemCompare();
		const meta = appsmith.store.rc_meta || {};
		const out = [];

		out.push(["Section", "Account", "Zip", "Months", "Annual kWh", "Peak kW",
			"Actual paid $/yr", "Supply $/yr", "Delivery $/yr", "Supplier", "Utility",
			"Utility standard offer", "Standard offer code", "Utility cost $/yr",
			"Contract vs utility $/yr", "Contract vs utility %",
			"Best alternative rate", "Best alt code", "Best alt $/yr", "Best alt saving $/yr",
			"Rates modeled", "Rates returned", "Status", "Note"]);

		if (isPortfolio) {
			for (const r of port) {
				out.push(["Accounts", r.location, r.zip, r.months, r.annual_kwh, r.peak_kw,
					r.actual_annual, r.supply_annual, r.delivery_annual, r.supplier, r.utility,
					r.utility_default, r.utility_default_code, r.utility_default_annual,
					r.contract_savings, r.contract_savings_pct,
					r.tariff, r.code, r.modeled_annual, r.savings,
					r.rates_modeled, r.rates_returned, r.status, r.note]);
			}
			// Locations we could not model belong in the same file — a summary that
			// silently omits them reads as full coverage when it is not.
			for (const s of RateClassData.skippedRows()) {
				out.push(["Accounts (not modeled)", s.location, s.zip, "", "", "",
					s.actual_annual, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Skipped", s.reason]);
			}
			const pm = pmeta || {};
			if (pm.accountsWithDefault) {
				out.push(["TOTAL", `${pm.accountsWithDefault} account(s) with a utility standard offer`, "", "", "", "",
					pm.totalActualWithDefault, "", "", "", "", "", "", pm.totalUtilityDefault,
					pm.totalContractSavings, pm.totalContractSavingsPct, "", "", "", "", "", "", "", ""]);
			}
		}

		// Every rate Arcadia returned and priced for the location on screen, not just
		// the winner — this is the "all the rates the API returns" part of the ask.
		const rates = RateClassData.resultsRows();
		if (rates.length) {
			for (const r of rates) {
				out.push(["All rates — " + (meta.locationName || ""), meta.locationName || "", meta.zip || "",
					meta.monthCount || "", "", meta.peakKw || "",
					r.actual_annual, "", "", "", r.utility,
					"", "", "", "", "",
					r.tariff + (r.tou ? " [TOU estimate]" : "") + (r.da ? " [Direct Access]" : "") + (r.rtp ? " [RTP estimate]" : ""),
					r.code, r.modeled_annual, r.annual_savings,
					"", "", r.status, ""]);
			}
		}

		// Line items: actual billed vs. the modeled rate, group subtotal rows first
		// then the raw lines from each side.
		const liHeader = ["Section", "Account", "Comparison group", "Detail bucket", "Side",
			"Charge", "Qty", "Unit", "$ over window", "", "", "", "", "", "", ""];
		const emitLi = (li) => {
			if (!li || li.error) return;
			out.push([]);
			out.push(liHeader);
			const acct = li.locationName || "";
			const rateLbl = li.rate ? `${li.rate.tariffName}${li.rate.code ? " (" + li.rate.code + ")" : ""}` : "—";
			out.push(["Line items — window", acct, `${li.windowFrom} to ${li.windowTo}`, `${li.monthCount} months`,
				"Compared against", rateLbl, "", "", ""]);
			out.push(["Line items — totals", acct, "Billed (line items)", "", "Actual", "", "", "", li.actualTotal]);
			out.push(["Line items — totals", acct, "Billed (monthly baseline)", "", "Actual", "", "", "", li.baselineTotal]);
			out.push(["Line items — totals", acct, "Modeled on " + rateLbl, "", "Modeled", "", "", "", li.modeledTotal]);
			for (const g of li.groups || []) {
				out.push(["Line items — group", acct, g.group, "", "Actual", "", "", "", g.actual]);
				out.push(["Line items — group", acct, g.group, "", "Modeled", "", "", "", g.modeled]);
				out.push(["Line items — group", acct, g.group, "", "Difference", g.oneSided ? "No counterpart on the other side" : "", "", "", g.delta]);
				for (const b of g.buckets || []) {
					for (const x of b.actualLines) out.push(["Line items — detail", acct, g.group, b.bucket, "Actual", x.name, x.qty, x.unit, x.cost]);
					for (const x of b.modeledLines) out.push(["Line items — detail", acct, g.group, b.bucket, "Modeled", x.name, x.qty, x.unit, x.cost]);
				}
			}
			if (li.structuralGap > 0) {
				out.push(["Line items — caveat", acct, (li.gapGroups || []).join(", "),
					"", "", "Charges with no modeled counterpart — still payable on the new rate, so the saving above is overstated by about this much",
					"", "", li.structuralGap]);
			}
			if (li.varianceHigh) {
				out.push(["Line items — caveat", acct, "", "", "",
					`Billed line items and the monthly-usage baseline differ by ${li.variancePct}% over this window (different tables, different date basis) — read the per-charge split as directional`,
					"", "", li.variance]);
			}
		};

		if (isPortfolio) {
			for (const r of port) {
				const li = liMap[String(r.location_id)];
				if (li) emitLi(li);
			}
		} else {
			emitLi(single);
		}

		out.push([]);
		out.push(["Notes"]);
		out.push(["", "\"Contract vs utility\" is the deliverable figure: the utility's standard-offer schedule priced on the same 12 months, minus what the account actually paid. Positive means the supply contract came in cheaper than staying with the utility."]);
		out.push(["", "\"Best alternative\" is a different question — the cheapest rate class the account could switch onto. It is included for reference and is not the contract-vs-utility comparison."]);
		out.push(["", "Modeled costs come from the Arcadia/Genability tariff API priced against each account's own last 12 months of billed kWh and kW."]);
		out.push(["", "TOU and real-time rates are modeled on a default load profile because interval data is not available — treat those rows as estimates."]);
		out.push(["", "Direct Access rates require contracting a competitive supplier, not just a rate change."]);
		out.push(["", "Line-item groups are a classification of bill wording, not a mapping supplied by the utility. Group and grand totals are reliable; the split within a group is indicative."]);
		if (isPortfolio && pmeta.capped) out.push(["", `${pmeta.capped} lower-spend account(s) were not modeled — the run is capped at ${RateClassData._MAX_LOCATIONS} accounts, highest spend first.`]);
		return RateClassData._csvRows(out);
	},

	// Wired to Btn_RC_export.
	exportCsv() {
		const rows = RateClassData.portfolioRows();
		const meta = appsmith.store.rc_meta || {};
		if (!rows.length && !RateClassData.resultsRows().length) {
			showAlert("Run an analysis first", "warning");
			return;
		}
		const who = rows.length
			? ((typeof RC_CustomerSelect !== "undefined" && RC_CustomerSelect.selectedOptionLabel) || "customer")
			: (meta.locationName || "location");
		const name = `rate-class-analysis-${String(who).replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${moment().format("YYYYMMDD")}.csv`;
		return download(RateClassData.buildExportCsv(), name, "text/csv");
	},

	// =====================================================================
	// Screen navigation / lifecycle
	// =====================================================================
	goBack() {
		const cur = Number(appsmith.store.rc_screen || 1);
		return storeValue("rc_screen", Math.max(1, cur - 1));
	},

	// Run on page load (queries/RateClassData-initPage/metadata.json is AUTOMATIC).
	// Loads the customer list here and captures the .run() RETURN value into the
	// store (never reads RC_fetchCustomers.data) so customerOptions() can stay a
	// pure store reader and avoid the reactive-dependency-misuse error.
	async initPage() {
		await storeValue("rc_screen", 1);
		await storeValue("rc_results", []);
		await storeValue("rc_usage", []);
		await storeValue("rc_all_tariffs", []);
		await storeValue("rc_lineitems", null);
		await storeValue("rc_portfolio", []);
		await storeValue("rc_portfolio_meta", {});
		await storeValue("rc_portfolio_lineitems", {});
		await storeValue("rc_status", "");
		await storeValue("rc_loading", false);
		// Drop any cached analyses from a previous session/build so a code change
		// can't keep serving a stale result. Re-selecting within this session
		// still caches normally.
		await storeValue("rc_cache", {});
		const res = await RC_fetchCustomers.run();
		const arr = Array.isArray(res) ? res : ((res && (res.data || res.body)) || []);
		await storeValue("rc_customer_opts", Array.isArray(arr) ? arr : []);
		// RC_CustomerSelect defaults to 76013, so load that customer's locations
		// up front (RC_fetchLocations binds RC_CustomerSelect.selectedOptionValue
		// with a 76013 fallback) — otherwise the Location dropdown is empty until
		// the user re-picks the customer.
		const locRes = await RC_fetchLocations.run();
		const locArr = Array.isArray(locRes) ? locRes : ((locRes && (locRes.data || locRes.body)) || []);
		await storeValue("rc_location_opts", Array.isArray(locArr) ? locArr : []);
	},

	async resetAll() {
		await storeValue("rc_results", []);
		await storeValue("rc_usage", []);
		await storeValue("rc_meta", {});
		await storeValue("rc_lineitems", null);
		await storeValue("rc_portfolio", []);
		await storeValue("rc_portfolio_meta", {});
		await storeValue("rc_portfolio_lineitems", {});
		await storeValue("rc_screen", 1);
	}
}
