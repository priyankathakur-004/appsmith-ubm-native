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
		const cacheKey = `v3:${customerId}:${locationId}`;
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
		await storeValue("rc_results", []);

		try {
			// --- 1. Load the location's last 12 months of usage + actual cost ---
			const usageRaw = await RC_LocationUsage.run();
			const usage = Array.isArray(usageRaw) ? usageRaw : [];
			if (!usage.length) {
				const msg = "Step 1: RC_LocationUsage returned 0 rows for this customer/location. The location may have no ELECTRIC bills, or utility_type isn't 'ELECTRIC'. Run RC_LocationUsage manually to check.";
				showAlert("No electric usage found for this location", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
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
			const actualAnnual = months.reduce((s, m) => s + m.actual, 0);
			const monthCount = months.length;
			await storeValue("rc_usage", usage);

			if (!zip || String(zip).trim().length < 3) {
				const msg = "Step 1: usage loaded but the location has no postcode — cannot look up tariffs.";
				showAlert("This location has no postcode on file — cannot look up tariffs", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}

			// --- 2. Look up serving utilities (LSEs) for the zip ---
			await storeValue("rc_progress", "Finding utilities for zip " + zip + "…");
			const lses = await RateClassData._fetchLses(zip);
			if (!lses.length) {
				const fe = appsmith.store.rc_last_fetch_err;
				const msg = `Step 2: Genability /lses returned no utilities for zip ${zip}. ${fe ? "Fetch error: " + fe : "(If this is a CORS/network block, the Genability API may not be reachable from the browser.)"}`;
				showAlert("No utilities found for zip " + zip, "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}
			await storeValue("rc_status", `Step 2 OK: ${lses.length} utility/utilities for zip ${zip}.`);

			// --- 3. Pull every electric tariff across those LSEs, dedupe ---
			await storeValue("rc_progress", "Loading tariffs…");
			const tariffLists = await Promise.all(
				lses.map(lse => RateClassData._fetchTariffs(lse.lseId, zip))
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
				return tt === "DEFAULT" || tt === "ALTERNATIVE" || tt === "ALTERNATE";
			});
			const ridersDropped = allTariffs.length - rateClasses.length;

			// Then keep only those whose applicability ranges fit this location's
			// typical monthly usage (drops e.g. large-demand-only rates), and cap.
			let tariffs = RateClassData._filterApplicable(rateClasses, months);
			let truncated = false;
			if (tariffs.length > RateClassData._MAX_TARIFFS) {
				truncated = true;
				tariffs = tariffs.slice(0, RateClassData._MAX_TARIFFS);
			}
			if (!tariffs.length) {
				const msg = `Step 3: pulled ${allTariffs.length} tariff record(s); ${rateClasses.length} were rate classes (dropped ${ridersDropped} riders/surcharges) but 0 matched this usage profile after applicability filtering. ${rateClasses.length === 0 ? "(No DEFAULT/ALTERNATE rate schedules found for this LSE/zip.)" : "Try relaxing the applicability filter."}`;
				showAlert("No applicable electric rate classes for this usage profile", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}
			await storeValue("rc_status", `Step 3 OK: ${tariffs.length} rate class(es) to model (dropped ${ridersDropped} riders/surcharges).`);

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
					modeled: !!modeledIds[t.masterTariffId]
				};
			}).sort((a, b) => {
				// Rate classes first, modeled ones at the very top, then by name.
				const rank = (r) => (r.category === "Rate Class" ? (r.modeled ? 0 : 1) : 2);
				const d = rank(a) - rank(b);
				return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
			});
			await storeValue("rc_all_tariffs", allTariffsTagged);

			// --- 4. Model an annual bill for each tariff (1 call each, throttled) ---
			let done = 0;
			const total = tariffs.length;
			const modelOne = async (t) => {
				const body = RateClassData._buildAnnualBody(months);
				const block = await RateClassData._calcTariff(t, body);
				done += 1;
				if (done % RateClassData._CALC_CONCURRENCY === 0 || done === total) {
					await storeValue("rc_progress", `Modeling rates… ${done}/${total}`);
				}
				const modeled = block.error ? null : Number(block.adjustedTotalCost || 0);
				const savings = (modeled == null) ? null : (actualAnnual - modeled);
				return {
					masterTariffId: t.masterTariffId,
					tariffCode: t.tariffCode || "",
					tariffName: t.tariffName || "",
					lseName: t.lseName || "",
					serviceType: RateClassData._serviceLabel(t.serviceType),
					modeledAnnualCost: modeled,
					actualAnnualCost: actualAnnual,
					annualSavings: savings,
					savingsPct: (savings == null || actualAnnual === 0) ? null : (savings / actualAnnual) * 100,
					lines: block.lines || [],
					error: block.error || null
				};
			};

			const results = await RateClassData._mapLimit(tariffs, RateClassData._CALC_CONCURRENCY, modelOne);

			// --- 5. Rank by savings (highest first); flag the best positive saver ---
			const ok = results.filter(r => r.annualSavings != null);
			const failed = results.filter(r => r.annualSavings == null);
			ok.sort((a, b) => b.annualSavings - a.annualSavings);
			ok.forEach((r, i) => { r.rank = i + 1; r.isBest = (i === 0 && r.annualSavings > 0); });
			const ranked = ok.concat(failed);

			const meta = {
				zip,
				locationName,
				actualAnnual,
				monthCount,
				tariffCount: ranked.length,
				modeledCount: ok.length,
				ridersDropped,
				totalReturned: allTariffs.length,
				truncated,
				lseNames: lses.map(l => l.name).filter(Boolean)
			};

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
	async _fetchLses(zip) {
		try {
			const url = `${RateClassData._GENABILITY_BASE}/rest/public/lses?zipCode=${encodeURIComponent(zip)}&serviceTypes=ELECTRICITY`;
			const res = await fetch(url, {
				method: "GET",
				headers: { "Authorization": RateClassData._GENABILITY_AUTH, "Accept": "application/json" }
			});
			if (!res.ok) {
				await storeValue("rc_last_fetch_err", `HTTP ${res.status} from /lses`);
				return [];
			}
			const data = await res.json();
			const arr = (data && (data.results || data.data)) || [];
			return Array.isArray(arr) ? arr : [];
		} catch (e) {
			await storeValue("rc_last_fetch_err", (e && e.message) || "network/CORS error on /lses");
			return [];
		}
	},

	async _fetchTariffs(lseId, zip) {
		try {
			const params = [
				`lseId=${encodeURIComponent(lseId)}`,
				`zipCode=${encodeURIComponent(zip)}`,
				`serviceTypes=ELECTRICITY`,
				`effectiveOn=${moment().format("YYYY-MM-DD")}`,
				`populateProperties=true`,
				`pageCount=100`
			].join("&");
			const res = await fetch(`${RateClassData._GENABILITY_BASE}/rest/public/tariffs?${params}`, {
				method: "GET",
				headers: { "Authorization": RateClassData._GENABILITY_AUTH, "Accept": "application/json" }
			});
			const data = await res.json();
			const arr = (data && (data.results || data.data)) || [];
			return Array.isArray(arr) ? arr : [];
		} catch (e) {
			return [];
		}
	},

	async _calcTariff(tariff, body) {
		try {
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
				const errMsg = data ? JSON.stringify(data).slice(0, 300) : `HTTP ${res.status}`;
				return RateClassData._normalizeCalcResponse({ __error: `HTTP ${res.status}: ${errMsg}` }, tariff);
			}
			return RateClassData._normalizeCalcResponse(data, tariff);
		} catch (e) {
			return RateClassData._normalizeCalcResponse({ __error: (e && e.message) || "Network error" }, tariff);
		}
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
	// declared range are always kept (can't rule them out).
	_filterApplicable(rows, months) {
		const n = months.length || 1;
		const avgKwh = months.reduce((s, m) => s + m.kwh, 0) / n;
		const peakKw = months.reduce((mx, m) => Math.max(mx, m.kw), 0);
		return (rows || []).filter(t => {
			if (t.serviceType && t.serviceType !== "ELECTRICITY") return false;
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
			modeled_annual: r.modeledAnnualCost == null ? null : Number(r.modeledAnnualCost.toFixed(2)),
			actual_annual: r.actualAnnualCost == null ? null : Number(r.actualAnnualCost.toFixed(2)),
			annual_savings: r.annualSavings == null ? null : Number(r.annualSavings.toFixed(2)),
			savings_pct: r.savingsPct == null ? null : Number(r.savingsPct.toFixed(1)),
			status: r.error ? "Error" : "OK",
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
		} else {
			parts.push("No rate beats the current cost");
		}
		if (m.truncated) parts.push(`(capped at ${RateClassData._MAX_TARIFFS} tariffs)`);
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
		for (const it of items) {
			const name = RateClassData._pickStr(it, ["chargeName", "rateGroupName", "name"]);
			if (!name) continue;
			const cost = RateClassData._pickNum(it, ["itemCost", "cost", "totalCost"]) ?? 0;
			const qty = RateClassData._pickNum(it, ["quantity", "itemQuantity", "qty", "quantityValue", "dataValue", "chargePeriodQuantity", "value"]) ?? 0;
			const rawUnit = RateClassData._pickStr(it, ["quantityUnit", "unit", "uom"]);
			const qtyKey = RateClassData._pickStr(it, ["quantityKey", "chargePeriodKey"]);
			const unit = RateClassData._displayUnitFor(rawUnit, qtyKey);
			const rate = RateClassData._pickNum(it, ["rate", "itemRate", "chargePeriodRate", "unitCost", "rateValue"]);
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
			lines: lines,
			error: res && res.__error ? res.__error : null
		};
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
		await storeValue("rc_screen", 1);
	}
}
