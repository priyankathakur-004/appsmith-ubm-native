export default {
	// Builds the Customer Info tab HTML from the customer queries.
	// Pure reader: it only reads the already-fetched data of the detail, contract
	// and audit queries (it never triggers them), so it stays clear of the
	// reactive-dependency misuse error. Those queries are refreshed on page load
	// and whenever the selected customer changes.
	//
	// Sections use native <details>/<summary> so they collapse/expand (with a
	// disclosure arrow) without any JavaScript, which the Text widget cannot run.
	// Only the first section (Main Information) is open by default.
	getInfoHtml() {
		const d = (fetch_customer_detail.data && fetch_customer_detail.data[0]) || {};
		const c = (fetch_customer_contract.data && fetch_customer_contract.data[0]) || {};

		// A JSON column may arrive as an object or as a string; normalise both.
		const asObject = (v) => {
			if (v == null) return {};
			if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return {}; } }
			return v;
		};
		const ent = asObject(d.entitlements);
		const th = asObject(d.target_hours);

		// --- audit column ("modified by") -------------------------------------
		// customer_info_audit_logs stores one row per changed field, keyed like
		// "entitlements.billPay". Map the latest change per key; anything without
		// a manual change defaults to "Admin System".
		const auditRows = Array.isArray(fetch_customer_audit.data) ? fetch_customer_audit.data : [];
		const auditByKey = {};
		auditRows.forEach((r) => { if (r && r.key && !(r.key in auditByKey)) auditByKey[r.key] = r; });

		// "2026-06-11T13:52:02Z" -> "06/11/2026 7:22 PM" (in the viewer's local time)
		const fmtDateTime = (s) => {
			if (!s) return "";
			const dt = new Date(s);
			if (isNaN(dt.getTime())) return "";
			const mm = String(dt.getMonth() + 1).padStart(2, "0");
			const dd = String(dt.getDate()).padStart(2, "0");
			const yyyy = dt.getFullYear();
			let h = dt.getHours();
			const ampm = h >= 12 ? "PM" : "AM";
			h = h % 12; if (h === 0) h = 12;
			const min = String(dt.getMinutes()).padStart(2, "0");
			return `${mm}/${dd}/${yyyy} ${h}:${min} ${ampm}`;
		};
		const auditFor = (key) => {
			const r = key ? auditByKey[key] : null;
			const name = r ? String(r.modified_by_name || "").trim() : "";
			if (!name) return "Admin System";
			const when = fmtDateTime(r.modified_at);
			return when ? `${name}, ${when}` : name;
		};

		const esc = (v) => (v == null || v === "") ? "—" : String(v);

		const pill = (on) => {
			const color = on ? "#4ade80" : "#94a3b8";
			return `<span style='color:${color};font-weight:700;'>${on ? "On" : "Off"}</span>`;
		};

		// Two-column row (label / value) for the plain sections.
		const row = (label, valueHtml, indent) => {
			const pad = indent ? "padding-left:36px;" : "";
			return `<tr>` +
				`<td style='padding:9px 14px;color:#94a3b8;width:340px;border-bottom:1px solid #334155;${pad}'>${label}</td>` +
				`<td style='padding:9px 14px;color:#f1f5f9;font-weight:600;border-bottom:1px solid #334155;'>${valueHtml}</td>` +
				`</tr>`;
		};

		// Three-column row (label / value / modified-by) for audited sections.
		const arow = (label, valueHtml, auditKey, indent) => {
			const pad = indent ? "padding-left:36px;" : "";
			return `<tr>` +
				`<td style='padding:9px 14px;color:#94a3b8;width:340px;border-bottom:1px solid #334155;${pad}'>${label}</td>` +
				`<td style='padding:9px 14px;color:#f1f5f9;font-weight:600;width:110px;border-bottom:1px solid #334155;'>${valueHtml}</td>` +
				`<td style='padding:9px 14px;color:#cbd5e1;border-bottom:1px solid #334155;'>${auditFor(auditKey)}</td>` +
				`</tr>`;
		};

		const table = (rowsHtml) =>
			`<table style='width:100%;border-collapse:collapse;background:#0f172a;border:1px solid #334155;border-radius:6px;overflow:hidden;'>${rowsHtml}</table>`;

		// One collapsible section. `open` controls the default-expanded state.
		const details = (title, bodyHtml, open) =>
			`<details ${open ? "open" : ""} style='margin-bottom:10px;border-bottom:1px solid #1e293b;padding-bottom:6px;'>` +
			`<summary style='cursor:pointer;list-style:revert;font-size:15px;font-weight:700;color:#93c5fd;padding:8px 4px;'>${title}</summary>` +
			`<div style='padding:8px 0 4px;'>${bodyHtml}</div>` +
			`</details>`;

		// product_tier_id -> display name. Only tier 3 (Platinum) is confirmed from
		// the source screen; 1/2 are best-guess until a tiers lookup exists.
		const tierName = (id) => {
			const map = { 1: "Bronze", 2: "Gold", 3: "Platinum" };
			return (id == null) ? "—" : (map[id] || ("Tier " + id));
		};

		// "2021-07-24" / "2021-07-24T15:05:32Z" -> "07/24/2021"
		const fmtDate = (s) => {
			if (!s) return "—";
			const parts = String(s).split("T")[0].split("-");
			return (parts.length === 3) ? `${parts[1]}/${parts[2]}/${parts[0]}` : String(s);
		};

		const statusPill = d.active
			? "<span style='color:#4ade80;'>&#9679; Active</span>"
			: "<span style='color:#f87171;'>&#9679; Inactive</span>";
		const liveDays = (th.live != null) ? Math.round(th.live / 24) : "—";

		const main = details("Main Information", table(
			row("Customer ID", esc(d.id)) +
			row("FDG Customer Code", esc(d.fdg_code)) +
			row("Customer Name", esc(d.name))), true);

		const status = details("Status", table(
			arow("Customer Status", statusPill, null)), false);

		const entl = details("Entitlements", table(
			arow("Payments", pill(ent.payments), "entitlements.payments") +
			arow("Bill Pay", pill(ent.billPay), "entitlements.billPay", true) +
			arow("Weather", pill(ent.weather), "entitlements.weather") +
			arow("PowerBI", pill(ent.powerBi), "entitlements.powerBi") +
			arow("Sustainability", pill(ent.energyStar || ent.carbonFootprint), null) +
			arow("Energy Star", pill(ent.energyStar), "entitlements.energyStar", true) +
			arow("Carbon Footprint", pill(ent.carbonFootprint), "entitlements.carbonFootprint", true) +
			arow("Budgeting", pill(ent.budgeting), "entitlements.budgeting") +
			arow("Activity History Chat", pill(ent.activityHistoryChat), "entitlements.activityHistoryChat") +
			arow("Rate Class", pill(ent.rateClass), "entitlements.rateClass")), false);

		const sftp = details("SFTP Configuration", table(
			arow("Reports Delivery Settings", pill(ent.reportDeliverySettings), "entitlements.reportDeliverySettings") +
			arow("Bills Bulk Download Settings", pill(ent.billsBulkDownloadSettings), "entitlements.billsBulkDownloadSettings") +
			arow("Scheduled Bills Extracts", pill(ent.scheduledBillsExtractsSettings), "entitlements.scheduledBillsExtractsSettings")), false);

		const tpt = details("Target Processing Time (Business Days)", table(
			row("Live Bills", esc(liveDays))), false);

		const contract = details("Contract Details", table(
			row("Product Tier", tierName(c.product_tier_id)) +
			row("Contract Signed", esc(c.contract_signed)) +
			row("Start Date", fmtDate(c.contract_start_date))), false);

		const mail = details("Mail To Address",
			"<div style='padding:10px 14px;color:#94a3b8;'>Select Edit in order to fill in.</div>", false);

		return `<div style='font-family:sans-serif;padding:8px 4px;'>${main}${status}${entl}${sftp}${tpt}${contract}${mail}</div>`;
	}
}
