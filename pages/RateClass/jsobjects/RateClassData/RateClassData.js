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
		const arr = Array.isArray(res) ? res : ((res && res.results) || []);
		await storeValue("rc_lses", arr);
		await storeValue("rc_selected_tariffs", []);
		await storeValue("rc_calc_results", []);
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
		const all = Array.isArray(res) ? res : ((res && res.results) || []);
		const filtered = RateClassData._applyUsageFilter(all);
		await storeValue("rc_tariffs", filtered);
		await storeValue("rc_selected_tariffs", []);
		await storeValue("rc_calc_results", []);
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
	onAgGridSelection(rows) {
		const sel = Array.isArray(rows) ? rows : [];
		const tariffs = appsmith.store.rc_tariffs || [];
		const byMtid = {};
		for (const t of tariffs) byMtid[t.masterTariffId] = t;
		const picked = sel.map(r => byMtid[r.masterTariffId]).filter(Boolean);
		return storeValue("rc_selected_tariffs", picked);
	},

	selectedTariffCount() {
		const arr = appsmith.store.rc_selected_tariffs;
		return Array.isArray(arr) ? arr.length : 0;
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

	// Run calculate for each selected tariff in parallel, normalise the
	// per-tariff cost breakdown, rank by adjustedTotalCost ascending, and
	// stash to store for the results screen to read.
	async runCalculate() {
		const picked = appsmith.store.rc_selected_tariffs || [];
		if (!picked.length) {
			showAlert("Select at least one tariff first", "warning");
			return [];
		}
		const responses = await Promise.all(
			picked.map(t => CalculateTariff.run({ tariff: t }).catch(e => ({ __error: String(e), tariff: t })))
		);
		const blocks = responses.map((r, i) => RateClassData._normalizeCalcResponse(r, picked[i]));
		blocks.sort((a, b) => (a.adjustedTotalCost || 0) - (b.adjustedTotalCost || 0));
		await storeValue("rc_calc_results", blocks);
		return blocks;
	},

	_normalizeCalcResponse(res, tariff) {
		const result = (res && res.results && res.results[0]) || res || {};
		const items = Array.isArray(result.items) ? result.items : [];
		const lines = items.map(it => ({
			name: it.chargeName || it.rateGroupName || it.name || "",
			qty: it.quantity != null ? it.quantity : (it.quantityUnit || ""),
			qty_unit: it.quantityUnit || "",
			rate: it.rate != null ? it.rate : (it.itemRate != null ? it.itemRate : 0),
			cost: it.itemCost != null ? it.itemCost : (it.cost != null ? it.cost : 0)
		}));
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
			error: res && res.__error ? res.__error : null
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
		await storeValue("rc_selected_tariffs", []);
		await storeValue("rc_calc_results", []);
	}
}
