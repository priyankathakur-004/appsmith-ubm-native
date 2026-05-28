export default {
	// ---- Step 1: vendor lookup by zip ----
	// Triggered by the "Search" link next to the Postcode input.
	// Writes results to appsmith.store.rc_lses (reader pattern to avoid the
	// "Reactive dependency misuse" warning Appsmith raises when one JSObject
	// both .run()s a query and reads its .data).
	async searchVendors() {
		const zip = (typeof Inp_RC_zipCode !== "undefined") ? Inp_RC_zipCode.text : "";
		if (!zip || String(zip).trim().length < 3) {
			showAlert("Enter a postcode first", "warning");
			return [];
		}
		const res = await GetLses.run();
		// Genability returns { status, count, type, results: [...] }; some plugin
		// versions unwrap it. Cover both shapes.
		const arr = Array.isArray(res) ? res : ((res && (res.results || res.data)) || []);
		await storeValue("rc_lses", arr);
		if (arr.length === 0) {
			showAlert("No vendors found for that postcode", "warning");
		}
		return arr;
	},

	vendorOptions() {
		const arr = appsmith.store.rc_lses;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(l => ({
			label: l.name || l.lseName || String(l.lseId),
			value: l.lseId
		}));
	},

	// ---- Step 2: find eligible tariffs ----
	// Pulls all tariffs for the selected vendor/zip, then filters to those
	// applicable to the user-supplied consumption (kWh) and demand (kW).
	// Genability's tariff record exposes min/max applicability ranges via
	// properties like minimumApplicableKW / maximumApplicableKW; we also fall
	// back to top-level minMonthlyConsumption fields when present.
	async findEligibleTariffs() {
		const vendor = (typeof Sel_RC_vendor !== "undefined") ? Sel_RC_vendor.selectedOptionValue : null;
		if (!vendor) {
			showAlert("Pick a vendor first", "warning");
			return [];
		}
		const res = await GetEligibleTariffs.run();
		const all = Array.isArray(res) ? res : ((res && (res.results || res.data)) || []);
		const filtered = RateClassData._applyUsageFilter(all);
		await storeValue("rc_tariffs", filtered);
		await storeValue("rc_calc_results", []);
		await storeValue("rc_screen", 2);
		return filtered;
	},

	_applyUsageFilter(rows) {
		const kwh = Number((typeof Inp_RC_consumption !== "undefined" ? Inp_RC_consumption.text : 0) || 0);
		const kw  = Number((typeof Inp_RC_demand !== "undefined" ? Inp_RC_demand.text : 0) || 0);
		return (rows || []).filter(t => {
			const ranges = RateClassData._readApplicabilityRanges(t);
			if (ranges.minKWh != null && kwh < ranges.minKWh) return false;
			if (ranges.maxKWh != null && kwh > ranges.maxKWh) return false;
			if (ranges.minKW  != null && kw  < ranges.minKW)  return false;
			if (ranges.maxKW  != null && kw  > ranges.maxKW)  return false;
			return true;
		});
	},

	_readApplicabilityRanges(t) {
		const out = { minKWh: null, maxKWh: null, minKW: null, maxKW: null };
		if (!t) return out;
		const props = Array.isArray(t.properties) ? t.properties : [];
		const byKey = {};
		for (const p of props) {
			if (p && p.keyName) byKey[p.keyName] = p;
		}
		const readNum = (p) => {
			if (!p) return null;
			const v = (p.dataValue != null) ? p.dataValue : p.value;
			if (v == null || v === "") return null;
			const n = Number(v);
			return isNaN(n) ? null : n;
		};
		out.minKWh = readNum(byKey.minimumApplicableKWh) ?? readNum(byKey.minimumMonthlyConsumption);
		out.maxKWh = readNum(byKey.maximumApplicableKWh) ?? readNum(byKey.maximumMonthlyConsumption);
		out.minKW  = readNum(byKey.minimumApplicableKW)  ?? readNum(byKey.minimumDemand);
		out.maxKW  = readNum(byKey.maximumApplicableKW)  ?? readNum(byKey.maximumDemand);
		return out;
	},

	tariffRows() {
		const arr = appsmith.store.rc_tariffs;
		const list = Array.isArray(arr) ? arr : [];
		return list.map(t => {
			const ranges = RateClassData._readApplicabilityRanges(t);
			return {
				masterTariffId: t.masterTariffId,
				code: t.tariffCode || "None",
				name: t.tariffName || "",
				mtid: t.masterTariffId,
				service: RateClassData._serviceLabel(t.serviceType),
				rate_criteria: RateClassData._rateCriteria(t),
				effective_date: t.effectiveDate || "",
				utility: t.lseName || "",
				kwh_range: RateClassData._rangeLabel(ranges.minKWh, ranges.maxKWh),
				kw_range: RateClassData._rangeLabel(ranges.minKW, ranges.maxKW),
				customer_count: t.customerCount != null ? t.customerCount : ""
			};
		});
	},

	_serviceLabel(s) {
		if (!s) return "";
		const m = { ELECTRICITY: "Electricity", GAS: "Gas", SOLAR_PV: "Solar" };
		return m[s] || s;
	},

	_rateCriteria(t) {
		const flags = [];
		if (t.hasTimeOfUseRates) flags.push("TimeOfUse");
		if (t.hasContractedRates) flags.push("Contracted");
		if (t.hasTariffApplicability) flags.push("TariffApplicability");
		if (t.hasRateApplicability) flags.push("RateApplicability");
		if (t.hasNetMetering) flags.push("NetMetering");
		if (t.hasTieredRates) flags.push("Tiered");
		return flags.slice(0, 3).join(", ") + (flags.length > 3 ? ", ..." : "");
	},

	_rangeLabel(min, max) {
		if (min == null && max == null) return "-";
		if (min != null && max != null) return `${min}–${max}`;
		if (min != null) return `≥ ${min}`;
		return `≤ ${max}`;
	},

	// ---- Step 3: selection + calculate ----
	// Wired to the Tbl_RC_tariffs CUSTOM_WIDGET's onSelectionChanged event.
	// The ag-grid widget posts an array of display rows (whatever tariffRows()
	// emitted); we look the underlying tariff objects back up by masterTariffId
	// because the calculate request needs the full Genability tariff payload,
	// not the trimmed display row.
	// Selection state lives on the custom widget's model (Tbl_RC_tariffs.model.selectedRows,
	// set by appsmith.updateModel inside the ag-grid widget). We read directly from the model
	// in selectedTariffCount() and in runCalculate() — no callback handler, no `rc_selected_tariffs`
	// store mirror. Mirroring selection back into the store while the widget is also the source
	// of truth creates a cyclic dependency in Appsmith's reactivity tracker.
	_selectedDisplayRows() {
		return (typeof Tbl_RC_tariffs !== "undefined"
			&& Tbl_RC_tariffs.model
			&& Array.isArray(Tbl_RC_tariffs.model.selectedRows))
			? Tbl_RC_tariffs.model.selectedRows
			: [];
	},

	_selectedFullTariffs() {
		const sel = RateClassData._selectedDisplayRows();
		if (!sel.length) return [];
		const tariffs = appsmith.store.rc_tariffs || [];
		const byMtid = {};
		for (const t of tariffs) byMtid[t.masterTariffId] = t;
		return sel.map(r => byMtid[r.masterTariffId]).filter(Boolean);
	},

	selectedTariffCount() {
		return RateClassData._selectedDisplayRows().length;
	},

	// Build the POST body for the calculate endpoint. Genability expects a
	// fromDateTime/toDateTime window and propertyInputs for consumption + demand.
	// We bill one calendar month starting today; adjust the window if Sunny
	// later asks for annualised numbers.
	buildCalculateBody(tariff) {
		const kwh = Number((typeof Inp_RC_consumption !== "undefined" ? Inp_RC_consumption.text : 0) || 0);
		const kw  = Number((typeof Inp_RC_demand !== "undefined" ? Inp_RC_demand.text : 0) || 0);
		const from = moment().startOf("month").format("YYYY-MM-DDTHH:mm:ss");
		const to   = moment().endOf("month").format("YYYY-MM-DDTHH:mm:ss");
		const inputs = [
			{ keyName: "consumption", fromDateTime: from, toDateTime: to, unit: "kWh", dataValue: String(kwh) }
		];
		if (kw > 0) {
			inputs.push({ keyName: "demand", fromDateTime: from, toDateTime: to, unit: "kW", dataValue: String(kw) });
		}
		return {
			fromDateTime: from,
			toDateTime: to,
			propertyInputs: inputs
		};
	},

	// Genability API config. Same Basic token as the CalculateTariff query
	// metadata — duplicating doesn't widen secret exposure.
	_GENABILITY_BASE: "https://api.genability.com",
	_GENABILITY_AUTH: "Basic ZjVjOGRlNmYtZTYyMi00ZTY3LTljNjctN2Y0MDg3ODFmMDQ5OmNkZTk1ZTQwLWYxNDUtNGQzNy05ZTdiLWNhYzFkY2M1ZmRkYw==",

	// Run calculate for each selected tariff via direct fetch().
	// We bypass the CalculateTariff REST query because Appsmith's body-binding
	// evaluation fails for this query (returns "CalculateTariff failed to execute"
	// before the HTTP request is sent — regardless of whether the body binding
	// returns an object, a JSON string, or inline JSON). fetch() from this JSObject
	// sidesteps the body-binding layer entirely.
	async runCalculate() {
		const picked = RateClassData._selectedFullTariffs();
		if (!picked.length) {
			showAlert("Select at least one tariff first", "warning");
			return [];
		}

		const kwh = Number((typeof Inp_RC_consumption !== "undefined" ? Inp_RC_consumption.text : 0) || 0);
		const kw  = Number((typeof Inp_RC_demand !== "undefined" ? Inp_RC_demand.text : 0) || 0);
		const from = moment().startOf("month").format("YYYY-MM-DDTHH:mm:ss");
		const to   = moment().endOf("month").format("YYYY-MM-DDTHH:mm:ss");
		// Genability's /rest/public/calculate/{mtid} expects `tariffInputs`, not
		// `propertyInputs`. Same payload shape per entry (keyName, dates, unit, dataValue).
		const tariffInputs = [
			{ keyName: "consumption", fromDateTime: from, toDateTime: to, unit: "kWh", dataValue: String(kwh) }
		];
		if (kw > 0) {
			tariffInputs.push({ keyName: "demand", fromDateTime: from, toDateTime: to, unit: "kW", dataValue: String(kw) });
		}
		const bodyStr = JSON.stringify({ fromDateTime: from, toDateTime: to, tariffInputs });

		const responses = await Promise.all(picked.map(async t => {
			try {
				const res = await fetch(`${RateClassData._GENABILITY_BASE}/rest/public/calculate/${t.masterTariffId}`, {
					method: "POST",
					headers: {
						"Authorization": RateClassData._GENABILITY_AUTH,
						"Content-Type": "application/json",
						"Accept": "application/json"
					},
					body: bodyStr
				});
				let data;
				try { data = await res.json(); } catch (_) { data = null; }
				if (!res.ok) {
					const errMsg = data ? JSON.stringify(data).slice(0, 400) : `HTTP ${res.status}`;
					return { __error: `HTTP ${res.status}: ${errMsg}`, tariff: t };
				}
				return data;
			} catch (e) {
				return { __error: (e && e.message) ? e.message : "Network error", tariff: t };
			}
		}));

		const blocks = responses.map((r, i) => RateClassData._normalizeCalcResponse(r, picked[i]));
		blocks.sort((a, b) => (a.adjustedTotalCost || 0) - (b.adjustedTotalCost || 0));
		await storeValue("rc_calc_results", blocks);
		await storeValue("rc_screen", 3);
		return blocks;
	},

	// ---- Screen navigation ----
	// Page boots with rc_screen unset → treated as screen 1.
	// findEligibleTariffs() advances to 2, runCalculate() advances to 3,
	// goBack() returns to the prior screen (clamped at 1).
	goBack() {
		const cur = Number(appsmith.store.rc_screen || 1);
		return storeValue("rc_screen", Math.max(1, cur - 1));
	},

	// Pull a numeric value from an item using a list of candidate field names.
	// Returns null if none of the names yield a finite number — caller can decide
	// whether to fall back to derived values (e.g. cost/qty for rate).
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

	// Map Genability's quantityKey (a logical input key like "consumption" or
	// "fixed") to a UI-friendly display unit. Real unit info (kWh, kW) is
	// supposed to be in `quantityUnit` but Genability often omits it. We never
	// show the quantityKey itself as a "unit" — it's not a unit, it's an input
	// reference.
	_displayUnitFor(quantityUnit, quantityKey) {
		if (quantityUnit) return String(quantityUnit);
		const key = String(quantityKey || "").toLowerCase();
		if (key === "consumption") return "kWh";
		if (key === "demand")      return "kW";
		// fixed / customer / period-based charges have no unit
		return "";
	},

	_normalizeCalcResponse(res, tariff) {
		const result = (res && res.results && res.results[0]) || res || {};
		const items = Array.isArray(result.items) ? result.items : [];

		// Genability splits a single visible charge across sub-items (one per
		// time-of-use band / tier / season). Group by name+quantityKey so charges
		// with the same label but different billing bases (e.g. one fixed + one
		// per-kWh component with the same name) stay separate. Without the
		// quantityKey in the group key, qtys with different units get summed into
		// a nonsense total like "1,001.00 fixed".
		const groups = new Map();
		for (const it of items) {
			const name = RateClassData._pickStr(it, ["chargeName", "rateGroupName", "name"]);
			if (!name) continue;
			const cost = RateClassData._pickNum(it, ["itemCost", "cost", "totalCost"]) ?? 0;
			const qty  = RateClassData._pickNum(it, ["quantity", "itemQuantity", "qty", "quantityValue", "dataValue", "chargePeriodQuantity", "value"]) ?? 0;
			const rawUnit = RateClassData._pickStr(it, ["quantityUnit", "unit", "uom"]);
			const qtyKey  = RateClassData._pickStr(it, ["quantityKey", "chargePeriodKey"]);
			const unit = RateClassData._displayUnitFor(rawUnit, qtyKey);
			const rate = RateClassData._pickNum(it, ["rate", "itemRate", "chargePeriodRate", "unitCost", "rateValue"]);

			// Use name + the *logical* quantity basis as the group key so items
			// billed on different bases never get summed together.
			const groupKey = name + "|" + (qtyKey || unit || "");
			const g = groups.get(groupKey) || { name, qty: 0, qty_unit: unit, cost: 0, rateSum: 0, rateCount: 0 };
			g.qty += qty;
			g.cost += cost;
			if (rate != null && rate !== 0) { g.rateSum += rate; g.rateCount += 1; }
			if (!g.qty_unit && unit) g.qty_unit = unit;
			groups.set(groupKey, g);
		}

		const lines = Array.from(groups.values()).map(g => {
			// Effective rate: prefer cost/qty when qty is non-zero, else the average
			// of per-item rates we observed, else 0.
			let rate = 0;
			if (g.qty !== 0) rate = g.cost / g.qty;
			else if (g.rateCount > 0) rate = g.rateSum / g.rateCount;
			return {
				name: g.name,
				qty: g.qty,
				qty_unit: g.qty_unit,
				rate: rate,
				cost: g.cost
			};
		});

		// Debug: keep one raw item so we can inspect Genability's actual field
		// names when qty/rate aren't extracting correctly. Inspect via
		// `appsmith.store.rc_calc_results[0]._debugFirstItem` in the Appsmith debugger.
		const debugFirstItem = items[0] || null;

		return {
			masterTariffId: tariff && tariff.masterTariffId,
			tariffName: tariff && tariff.tariffName,
			tariffCode: tariff && tariff.tariffCode,
			lseName: tariff && tariff.lseName,
			serviceType: RateClassData._serviceLabel(tariff && tariff.serviceType),
			adjustedTotalCost: Number(result.totalCost != null ? result.totalCost : (result.adjustedTotalCost || 0)),
			subTotalCost: Number(result.subTotalCost != null ? result.subTotalCost : (result.totalCost || 0)),
			taxCost: Number(result.taxCost || 0),
			nonBypassableCost: Number(result.nonBypassableCost || 0),
			lines: lines,
			error: res && res.__error ? res.__error : null,
			_debugFirstItem: debugFirstItem
		};
	},

	calcResults() {
		const arr = appsmith.store.rc_calc_results;
		return Array.isArray(arr) ? arr : [];
	},

	// Header label for each result accordion: "Utility | Name | Service ........... $X"
	resultHeader(block) {
		const cost = (block && typeof block.adjustedTotalCost === "number")
			? `$${block.adjustedTotalCost.toFixed(2)}`
			: "";
		return `${block.lseName || ""} | ${block.tariffName || ""} | ${block.serviceType || ""}  —  ${cost}`;
	},

	// ---- Reset ----
	async resetAll() {
		await storeValue("rc_lses", []);
		await storeValue("rc_tariffs", []);
		await storeValue("rc_calc_results", []);
		await storeValue("rc_screen", 1);
	}
}
