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
		{ value: "month", label: "Month", sql: "TO_CHAR(amf.time_period, 'YYYY-MM') AS \"month\"" },
		{ value: "location", label: "Location", sql: "l.name AS \"location\"" },
		{ value: "locationId", label: "Location ID", sql: "l.id AS \"locationId\"" },
		{ value: "locationAddress", label: "Location Address", sql: "l.address AS \"locationAddress\"" },
		{ value: "locationZip", label: "Location Zip", sql: "l.postcode AS \"locationZip\"" },
		{ value: "locationCity", label: "City", sql: "l.city AS \"locationCity\"" },
		{ value: "locationState", label: "State/Province", sql: "l.state AS \"locationState\"" },
		{ value: "locationCountry", label: "Country", sql: "l.country AS \"locationCountry\"" },
		{ value: "vendor", label: "Vendor", sql: "COALESCE(cvn.pretty_name, amf.vendor_code) AS \"vendor\"" },
		{ value: "vendorCode", label: "Vendor Code", sql: "amf.vendor_code AS \"vendorCode\"" },
		{ value: "billType", label: "Bill Type", sql: "amf.bill_type AS \"billType\"" },
		{ value: "utilityType", label: "Service / Utility Type", sql: "amf.utility_type AS \"utilityType\"" },
		{ value: "totalCharges", label: "Total Charges", sql: "amf.total_charges AS \"totalCharges\"" },
		{ value: "totalConsumption", label: "Total Consumption", sql: "amf.total_consumption AS \"totalConsumption\"" },
		{ value: "uom", label: "Unit of Measure", sql: "amf.utility_type AS \"uom\"" },
		{ value: "demand", label: "Max Demand", sql: "amf.max_demand AS \"demand\"" },
		{ value: "daysOfService", label: "Days of Service", sql: "amf.days_of_service AS \"daysOfService\"" },
		{ value: "startDate", label: "Service Start", sql: "TO_CHAR(amf.start_date, 'YYYY-MM-DD') AS \"startDate\"" },
		{ value: "endDate", label: "Service End", sql: "TO_CHAR(amf.end_date, 'YYYY-MM-DD') AS \"endDate\"" }
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
		const rows = (typeof getStates !== "undefined" && getStates.data) || [];
		const map = ReportSpecs.stateNames;
		return rows.map(r => ({
			value: r.value,
			label: map[r.value] ? `${map[r.value]} (${r.value})` : r.value
		}));
	},

	prettyCountries: () => {
		const rows = (typeof getCountries !== "undefined" && getCountries.data) || [];
		const map = ReportSpecs.countryNames;
		return rows.map(r => ({
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

		// Country (+ Not In)
		const countries = (typeof CountrySelect !== "undefined" && CountrySelect.selectedOptionValues) || [];
		if (countries.length > 0) {
			const notIn = (typeof CountryNotIn !== "undefined") && CountryNotIn.isSwitchedOn;
			parts.push(ReportSpecs._inList("l.country", countries, notIn));
		}

		// Location status — lives on location_detail (lt) per the schema.
		const statuses = (typeof LocationStatusSelect !== "undefined" && LocationStatusSelect.selectedOptionValues) || [];
		if (statuses.length > 0) {
			parts.push(ReportSpecs._inList("lt.status", statuses));
		}

		// Vendor — selecting by vendor code (the stable join key).
		const vendors = (typeof VendorSelect !== "undefined" && VendorSelect.selectedOptionValues) || [];
		if (vendors.length > 0) {
			parts.push(ReportSpecs._inList("amf.vendor_code", vendors));
		}
		// Vendor Territory — TODO: column unclear in monthly feed; no-op for now.

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

		// Location attributes — picker populates from custom_location_attributes
		// (attribute names). Actual value-level filtering is a second-level
		// picker we haven't added yet; this just no-ops on the names for now.

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
			"CountrySelect", "CountryNotIn", "LocationStatusSelect",
			"VendorSelect", "ServiceTypesSelect", "ServiceNotIn",
			"LocationAttributesSelect"
		];
		for (const w of widgetNames) {
			try { resetWidget(w, false); } catch (e) { /* widget may not exist yet */ }
		}
		await ReportSpecs.refreshGrid();
		showAlert("Filters reset", "success");
	}
};
