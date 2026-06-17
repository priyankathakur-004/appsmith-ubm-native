export default {
	// =====================================================================
	// Cost Analysis – Trendline
	//
	// Single-report builder modeled after the client's NG provider UI.
	// All filters apply at the SQL layer (see [[feedback-sql-side-filters]]).
	// Best-guess field mapping per [[project-reports-ng-builder]]; lines
	// marked TODO need confirmation against the NG → UBM mapping doc.
	// =====================================================================

	// ----- Visible fields catalog (what the user picks from FieldsSelect) -----
	// Each entry: { value (alias used in column picker), label, sql (SELECT expr) }.
	// SELECT clause is built by selectClause() from the user's pick.
	visibleFieldOptions: [
		// --- Time / period ---
		{ value: "month", label: "Month", sql: "TO_CHAR(amf.time_period, 'YYYY-MM') AS \"month\"" },
		{ value: "statementDate", label: "Statement Date", sql: "TO_CHAR(amf.statement_date, 'YYYY-MM-DD') AS \"statementDate\"" },
		{ value: "startDate", label: "Service Start", sql: "TO_CHAR(amf.start_date, 'YYYY-MM-DD') AS \"startDate\"" },
		{ value: "endDate", label: "Service End", sql: "TO_CHAR(amf.end_date, 'YYYY-MM-DD') AS \"endDate\"" },
		{ value: "daysOfService", label: "Days of Service", sql: "amf.days_of_service AS \"daysOfService\"" },

		// --- Location ---
		{ value: "location", label: "Location", sql: "l.name AS \"location\"" },
		{ value: "locationId", label: "Location ID", sql: "l.id AS \"locationId\"" },
		{ value: "locationAddress", label: "Location Address", sql: "l.address AS \"locationAddress\"" },
		{ value: "locationCity", label: "City", sql: "l.city AS \"locationCity\"" },
		{ value: "locationState", label: "State/Province", sql: "l.state AS \"locationState\"" },
		{ value: "locationCountry", label: "Country", sql: "l.country AS \"locationCountry\"" },
		{ value: "locationZip", label: "Location Zip", sql: "l.postcode AS \"locationZip\"" },
		{ value: "locationStatus", label: "Location Status", sql: "lt.location_status AS \"locationStatus\"" },
		{ value: "buildingType", label: "Building Type", sql: "l.building_type AS \"buildingType\"" },
		{ value: "squareFeet", label: "Square Feet", sql: "l.square_feet AS \"squareFeet\"" },

		// --- Hierarchy: removed. UBM has no hierarchy/grouping attributes
		// (location_division / top / second / third group) — confirmed by
		// UBM team 2026-06-17. Do not re-add without a real source column.

		// --- Vendor / bill identity ---
		{ value: "vendor", label: "Vendor", sql: "COALESCE(cvn.pretty_name, amf.vendor_code) AS \"vendor\"" },
		{ value: "vendorCode", label: "Vendor Code", sql: "amf.vendor_code AS \"vendorCode\"" },
		{ value: "billType", label: "Bill Type", sql: "amf.bill_type AS \"billType\"" },
		{ value: "utilityType", label: "Service / Utility Type", sql: "amf.utility_type AS \"utilityType\"" },

		// --- Usage / consumption ---
		{ value: "uom", label: "Unit of Measure", sql: "amf.total_consumption_uom AS \"uom\"" },
		{ value: "totalConsumption", label: "Total Consumption", sql: "amf.total_consumption AS \"totalConsumption\"" },
		{ value: "totalGenConsumption", label: "Generation Consumption", sql: "amf.total_gen_consumption AS \"totalGenConsumption\"" },
		{ value: "demand", label: "Max Demand", sql: "amf.max_demand AS \"demand\"" },

		// --- Charges (granular) ---
		{ value: "totalCharges", label: "Total Charges", sql: "amf.total_charges AS \"totalCharges\"" },
		{ value: "totalChargesUsage", label: "Usage Charges", sql: "amf.total_charges_usage AS \"totalChargesUsage\"" },
		{ value: "totalChargesConsumption", label: "Consumption Charges", sql: "amf.total_charges_consumption AS \"totalChargesConsumption\"" },
		{ value: "totalChargesDemand", label: "Demand Charges", sql: "amf.total_charges_demand AS \"totalChargesDemand\"" },
		{ value: "totalChargesTaxes", label: "Tax Charges", sql: "amf.total_charges_taxes AS \"totalChargesTaxes\"" },
		{ value: "totalChargesCustomer", label: "Customer Charges", sql: "amf.total_charges_customer AS \"totalChargesCustomer\"" },
		{ value: "totalChargesOther", label: "Other Charges", sql: "amf.total_charges_other AS \"totalChargesOther\"" },

		// --- Weather (raw degree-days only) ---
		// UBM has no "normalization type" attribute; we expose raw HDD/CDD and
		// any normalization is done client-side. (UBM team 2026-06-17.)
		{ value: "totalHdd", label: "Heating Degree Days", sql: "amf.total_hdd_billblock AS \"totalHdd\"" },
		{ value: "totalCdd", label: "Cooling Degree Days", sql: "amf.total_cdd_billblock AS \"totalCdd\"" }
	],

	defaultVisibleFields: [
		"month", "location", "locationId", "utilityType",
		"vendor", "totalCharges", "totalConsumption", "uom"
	],

	// ----- Base FROM (constant for Trendline) -----
	// location_detail (lt) holds description/address/city/state/postcode for
	// the location; locations (l) is the parent (id, customer_id, country).
	// Pattern mirrors pages/Locations/queries/getLocationLists.
	fromClause:
		`bill_management_v2.analytics_monthly_feed amf
		LEFT JOIN bill_management_v2.locations l ON l.id = amf.location_id
		LEFT JOIN bill_management_v2.location_detail lt ON lt.location_id = l.id
		LEFT JOIN bill_management_v2.customers_providers_pretty_name cvn
			ON cvn.code = amf.vendor_code AND cvn.customer_id = amf.customer_id`,

	// ORDER BY for both runReport and runReportCount alignment.
	orderByClause: "l.id, amf.time_period",

	// ----- ISO state/country code → pretty name maps -----
	// DB stores ISO codes like "US-CA", "CA-ON". Filter SELECT/IN still uses
	// the code; only the dropdown label changes via prettyStates/prettyCountries.
	stateNames: {
		"US-AL": "Alabama", "US-AK": "Alaska", "US-AZ": "Arizona", "US-AR": "Arkansas",
		"US-CA": "California", "US-CO": "Colorado", "US-CT": "Connecticut", "US-DE": "Delaware",
		"US-DC": "District of Columbia", "US-FL": "Florida", "US-GA": "Georgia", "US-HI": "Hawaii",
		"US-ID": "Idaho", "US-IL": "Illinois", "US-IN": "Indiana", "US-IA": "Iowa",
		"US-KS": "Kansas", "US-KY": "Kentucky", "US-LA": "Louisiana", "US-ME": "Maine",
		"US-MD": "Maryland", "US-MA": "Massachusetts", "US-MI": "Michigan", "US-MN": "Minnesota",
		"US-MS": "Mississippi", "US-MO": "Missouri", "US-MT": "Montana", "US-NE": "Nebraska",
		"US-NV": "Nevada", "US-NH": "New Hampshire", "US-NJ": "New Jersey", "US-NM": "New Mexico",
		"US-NY": "New York", "US-NC": "North Carolina", "US-ND": "North Dakota", "US-OH": "Ohio",
		"US-OK": "Oklahoma", "US-OR": "Oregon", "US-PA": "Pennsylvania", "US-RI": "Rhode Island",
		"US-SC": "South Carolina", "US-SD": "South Dakota", "US-TN": "Tennessee", "US-TX": "Texas",
		"US-UT": "Utah", "US-VT": "Vermont", "US-VA": "Virginia", "US-WA": "Washington",
		"US-WV": "West Virginia", "US-WI": "Wisconsin", "US-WY": "Wyoming",
		"US-PR": "Puerto Rico", "US-VI": "U.S. Virgin Islands", "US-GU": "Guam",
		"US-MP": "Northern Mariana Islands", "US-AS": "American Samoa",
		"CA-AB": "Alberta", "CA-BC": "British Columbia", "CA-MB": "Manitoba",
		"CA-NB": "New Brunswick", "CA-NL": "Newfoundland and Labrador", "CA-NS": "Nova Scotia",
		"CA-ON": "Ontario", "CA-PE": "Prince Edward Island", "CA-QC": "Quebec",
		"CA-SK": "Saskatchewan", "CA-NT": "Northwest Territories", "CA-NU": "Nunavut",
		"CA-YT": "Yukon"
	},

	countryNames: {
		"US": "United States", "USA": "United States", "CA": "Canada", "CAN": "Canada",
		"MX": "Mexico", "GB": "United Kingdom", "UK": "United Kingdom"
	},

	prettyStates: () => {
		const data = (typeof getStates !== "undefined") ? getStates.data : null;
		const rows = Array.isArray(data) ? data : [];
		const map = ReportSpecs.stateNames;
		return rows
			.filter(r => r && r.value)
			.map(r => ({
				value: r.value,
				label: map[r.value] ? `${map[r.value]} (${r.value})` : r.value
			}));
	},

	prettyCountries: () => {
		const data = (typeof getCountries !== "undefined") ? getCountries.data : null;
		const rows = Array.isArray(data) ? data : [];
		const map = ReportSpecs.countryNames;
		return rows
			.filter(r => r && r.value)
			.map(r => ({
				value: r.value,
				label: map[r.value] || r.value
			}));
	},

	// ----- Helpers -----
	customerId: () => {
		const v = CustomerSelect && CustomerSelect.selectedOptionValue;
		if (v == null || v === "") return null;
		const n = parseInt(v, 10);
		return isNaN(n) ? null : n;
	},

	// Visible-fields options for the FieldsSelect dropdown.
	fieldOptions: () => ReportSpecs.visibleFieldOptions.map(f => ({ label: f.label, value: f.value })),

	// ----- SELECT builder -----
	selectClause: () => {
		const picked = (FieldsSelect && FieldsSelect.selectedOptionValues) || [];
		const fields = (Array.isArray(picked) && picked.length > 0) ? picked : ReportSpecs.defaultVisibleFields;
		const exprs = fields
			.map(f => ReportSpecs.visibleFieldOptions.find(o => o.value === f))
			.filter(Boolean)
			.map(o => o.sql);
		return exprs.length > 0 ? exprs.join(", ") : "1 AS placeholder";
	},

	// ----- WHERE builder (every filter is SQL-side) -----
	// Helpers
	_quote: v => `'${String(v).replace(/'/g, "''")}'`,
	_inList: (col, values, notIn) => {
		const list = values.map(v => ReportSpecs._quote(v)).join(",");
		return `AND ${col} ${notIn ? "NOT IN" : "IN"} (${list})`;
	},

	// Quoted CSV of the attribute names picked in AccountAttributesSelect, for
	// the getAccountAttributeValues IN (...) clause. Returns '' (matches nothing)
	// when none are selected, so the values picker stays empty until a name is
	// chosen. Kept here so the query binding stays a simple function call.
	accountAttrNames: () => {
		const names = (typeof AccountAttributesSelect !== "undefined" && AccountAttributesSelect.selectedOptionValues) || [];
		if (!names.length) return "''";
		return names.map(n => ReportSpecs._quote(n)).join(",");
	},

	filterClauses: () => {
		const parts = ["WHERE 1=1"];
		const cid = ReportSpecs.customerId();
		if (cid != null) parts.push(`AND amf.customer_id = ${cid}`);

		// Date range (always applied if provided). amf.time_period is the canonical
		// month bucket — start of month for monthly feed.
		if (StartDate && StartDate.selectedDate) {
			const d = moment(StartDate.selectedDate).startOf("month").format("YYYY-MM-DD");
			parts.push(`AND amf.time_period >= '${d}'`);
		}
		if (EndDate && EndDate.selectedDate) {
			const d = moment(EndDate.selectedDate).endOf("month").format("YYYY-MM-DD");
			parts.push(`AND amf.time_period <= '${d}'`);
		}

		// State / Province (+ Not In)
		const states = (typeof StateProvinceSelect !== "undefined" && StateProvinceSelect.selectedOptionValues) || [];
		if (states.length > 0) {
			const notIn = (typeof StateNotIn !== "undefined") && StateNotIn.isSwitchedOn;
			parts.push(ReportSpecs._inList("l.state", states, notIn));
		}

		// Country
		const countries = (typeof CountrySelect !== "undefined" && CountrySelect.selectedOptionValues) || [];
		if (countries.length > 0) {
			parts.push(ReportSpecs._inList("l.country", countries));
		}

		// Location status — lives on location_detail (lt) per the schema.
		const statuses = (typeof LocationStatusSelect !== "undefined" && LocationStatusSelect.selectedOptionValues) || [];
		if (statuses.length > 0) {
			parts.push(ReportSpecs._inList("lt.location_status", statuses));
		}

		// Vendor — selecting by vendor code (the stable join key).
		const vendors = (typeof VendorSelect !== "undefined" && VendorSelect.selectedOptionValues) || [];
		if (vendors.length > 0) {
			parts.push(ReportSpecs._inList("amf.vendor_code", vendors));
		}
		// Vendor Territory — not available in UBM. UBM stores vendor *location*
		// info instead; filter by vendor location once that column is mapped.
		// (UBM team 2026-06-17.)

		// Service / Utility type (+ Not In)
		const services = (typeof ServiceTypesSelect !== "undefined" && ServiceTypesSelect.selectedOptionValues) || [];
		if (services.length > 0) {
			const notIn = (typeof ServiceNotIn !== "undefined") && ServiceNotIn.isSwitchedOn;
			parts.push(ReportSpecs._inList("amf.utility_type", services, notIn));
		}

		// Location name / number — free text, partial match on name/address or id.
		const loc = (typeof LocationName !== "undefined" && LocationName.text) || "";
		if (loc.trim() !== "") {
			const safe = String(loc).trim().replace(/'/g, "''");
			parts.push(`AND (l.name ILIKE '%${safe}%' OR l.address ILIKE '%${safe}%' OR CAST(l.id AS TEXT) = '${safe}')`);
		}

		// Location attributes (LocationAttributesSelect) — source is the
		// bill_management_v2.location_monthly_attributes_* tables, joined via
		// amf.location_id. Picker shows attribute names; value-level filtering is
		// a second-level picker we haven't added yet, so this no-ops for now.

		// Account attributes = UBM "VA attributes" (Virtual Accounts).
		// AccountAttributesSelect picks attribute NAMES (from
		// virtual_accounts_attributes_metadata); AccountAttributeValuesSelect
		// picks VALUES, each option encoded as name + CHR(31) + value (the unit
		// separator). We group the picked values by attribute name and emit one
		// EXISTS per attribute, so multiple attributes AND together (a VA must
		// match every picked attribute), values within an attribute OR together.
		// (Schema confirmed 2026-06-17: vam = virtual_accounts_attributes_mapping,
		//  vmeta = virtual_accounts_attributes_metadata.)
		const accVals = (typeof AccountAttributeValuesSelect !== "undefined" && AccountAttributeValuesSelect.selectedOptionValues) || [];
		if (accVals.length > 0) {
			const SEP = String.fromCharCode(31); // unit separator, matches CHR(31) in the query
			const groups = {};
			accVals.forEach(s => {
				const str = String(s);
				const i = str.indexOf(SEP);
				if (i < 0) return;
				const name = str.slice(0, i);
				const val = str.slice(i + 1);
				(groups[name] = groups[name] || []).push(val);
			});
			Object.keys(groups).forEach(name => {
				const vals = groups[name].map(v => ReportSpecs._quote(v)).join(",");
				parts.push(
					"AND EXISTS (SELECT 1 FROM bill_management_v2.virtual_accounts_attributes_mapping vam " +
					"JOIN bill_management_v2.virtual_accounts_attributes_metadata vmeta " +
					"ON vmeta.id = vam.virtual_accounts_attributes_metadata_id " +
					"WHERE vam.virtual_account_id = amf.virtual_account_id " +
					`AND vmeta.attribute_name = ${ReportSpecs._quote(name)} ` +
					`AND vam.attribute_value IN (${vals}))`
				);
			});
		}

		return parts.join(" ");
	},

	// ----- Pagination plumbing (unchanged contract for GridWidget) -----
	fetchPage: async () => {
		const m = (typeof GridWidget !== "undefined") ? GridWidget.model : null;
		const start = Math.max(0, (m && Number(m.pendingStart)) || 0);
		const end = Math.max(start + 1, (m && Number(m.pendingEnd)) || (start + 100));
		await storeValue("reportsPageStart", start);
		await storeValue("reportsPageEnd", end);
		await Promise.all([runReport.run(), runReportCount.run()]);
	},

	totalRows: () => {
		const row = runReportCount.data && runReportCount.data[0];
		if (!row) return null;
		const n = Number(row.total);
		return isNaN(n) ? null : n;
	},

	refreshKey: () => Number(appsmith.store.reportsRefreshKey) || 0,

	// onOptionChange handler for AccountAttributesSelect. The values query's
	// dependency on the names picker is hidden inside accountAttrNames(), so
	// Appsmith won't auto-re-run it — do it explicitly here. Clear any stale
	// value selections first, then repopulate options and refresh the grid.
	onAccountAttrChange: async () => {
		resetWidget("AccountAttributeValuesSelect", false);
		getAccountAttributeValues.run();
		await ReportSpecs.refreshGrid();
	},

	refreshGrid: async () => {
		await storeValue("reportsPageStart", 0);
		await storeValue("reportsPageEnd", 100);
		await storeValue("reportsRefreshKey", (Number(appsmith.store.reportsRefreshKey) || 0) + 1);
	},

	// Column keys actually present in runReport.data (for the column picker UI).
	columnOptions: () => {
		const rows = runReport.data;
		if (!Array.isArray(rows) || rows.length === 0) return ReportSpecs.fieldOptions();
		return Object.keys(rows[0]).map(k => ({ label: k, value: k }));
	},

	status: () => {
		if (runReport.isLoading) return "Loading...";
		const total = ReportSpecs.totalRows();
		if (total == null) return "Pick a customer and click Run";
		return `${total.toLocaleString()} total rows · Cost Analysis – Trendline`;
	},

	// ----- Export -----
	filenameStem: () => {
		const customer = (CustomerSelect && CustomerSelect.selectedOptionLabel || "customer")
			.toString().replace(/\s+/g, "_");
		const stamp = moment().format("YYYYMMDD-HHmmss");
		return `${customer}-cost-analysis-trendline-${stamp}`;
	},

	exportCsv: () => {
		const rows = runReport.data || [];
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		const fields = Object.keys(rows[0]);
		const escape = v => {
			if (v === null || v === undefined) return "";
			if (typeof v === "object") v = JSON.stringify(v);
			const s = String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const csv = [fields.join(","), ...rows.map(r => fields.map(f => escape(r[f])).join(","))].join("\n");
		const filename = `${ReportSpecs.filenameStem()}.csv`;
		download(csv, filename, "text/csv");
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	exportXlsx: () => {
		const rows = runReport.data || [];
		if (!rows.length) {
			showAlert("Nothing to export — run a query first", "warning");
			return;
		}
		const fields = Object.keys(rows[0]);
		const flat = rows.map(r => {
			const o = {};
			for (const f of fields) {
				const v = r[f];
				o[f] = (v && typeof v === "object") ? JSON.stringify(v) : v;
			}
			return o;
		});
		const ws = XLSX.utils.json_to_sheet(flat, { header: fields });
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "Trendline");
		const filename = `${ReportSpecs.filenameStem()}.xlsx`;
		const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
		download({ data: b64, name: filename, type: "xlsx" }, filename);
		showAlert(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, "success");
	},

	// Reset all filter widgets and re-fetch from page 1.
	reset: async () => {
		const widgetNames = [
			"FieldsSelect", "StartDate", "EndDate",
			"LocationName", "StateProvinceSelect", "StateNotIn",
			"CountrySelect", "LocationStatusSelect",
			"VendorSelect", "ServiceTypesSelect", "ServiceNotIn",
			"LocationAttributesSelect", "AccountAttributesSelect",
			"AccountAttributeValuesSelect"
		];
		for (const w of widgetNames) {
			try { resetWidget(w, false); } catch (e) { /* widget may not exist yet */ }
		}
		await ReportSpecs.refreshGrid();
		showAlert("Filters reset", "success");
	}
};
