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
		const cacheKey = `v5:${customerId}:${locationId}`;
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
				showAlert("No applicable electric rate classes for this usage profile", "warning");
				await storeValue("rc_status", msg);
				await storeValue("rc_loading", false);
				return;
			}
			await storeValue("rc_status", `Step 3 OK: ${tariffs.length} rate class(es) to model (dropped ${ridersDropped} riders/surcharges/closed & off-class rates).`);

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

			const results = await RateClassData._mapLimit(tariffs, RateClassData._CALC_CONCURRENCY, modelOne);

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
			const demandMissing = demandMissingMonths > 0;
			// Either failure mode means demand can't be trusted — withhold the pick.
			const demandSuspect = demandMissing || demandSpikeMonths > 0;
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

			const meta = {
				zip,
				locationName,
				actualAnnual,
				monthCount,
				tariffCount: ranked.length,
				modeledCount: ok.length,
				nonServiceCount: nonServiceCount,
				deliveryOnlyCount: deliveryOnlyCount,
				demandIncompleteCount: demandIncompleteCount,
				demandMissing: demandMissing,
				demandMissingMonths: demandMissingMonths,
				demandSpikeMonths: demandSpikeMonths,
				demandSuspect: demandSuspect,
				peakKw: peakKw,
				ridersDropped,
				totalReturned: allTariffs.length,
				truncated,
				dataThrough: usage[0] ? usage[0].month : null,
				stale: usage[0] ? (moment().diff(moment(usage[0].month), "months") > 3) : false,
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
			let arr;
			try {
				const res = await fetch(`${RateClassData._GENABILITY_BASE}/rest/public/tariffs?${params}`, {
					method: "GET",
					headers: { "Authorization": RateClassData._GENABILITY_AUTH, "Accept": "application/json" }
				});
				if (!res.ok) {
					await storeValue("rc_last_fetch_err", `HTTP ${res.status} from /tariffs (lse ${lseId})`);
					break;
				}
				const data = await res.json();
				arr = (data && (data.results || data.data)) || [];
			} catch (e) {
				await storeValue("rc_last_fetch_err", (e && e.message) || "network/CORS error on /tariffs");
				break;
			}
			if (!Array.isArray(arr) || arr.length === 0) break;
			for (const t of arr) all.push(t);
			if (arr.length < pageSize) break; // last page
		}
		return all;
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
