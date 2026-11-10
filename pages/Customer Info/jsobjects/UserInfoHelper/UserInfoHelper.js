export default {
	// Shared dark-themed table/section builders (same look as the Customer Info tab).
	_row(label, valueHtml, audit) {
		const auditCell = audit === undefined ? `<td style='border-bottom:1px solid ${appsmith.theme.colors.borderColor};'></td>` :
			`<td style='padding:9px 14px;color:${appsmith.theme.colors.textSoftColor};border-bottom:1px solid ${appsmith.theme.colors.borderColor};'>${audit || "Admin System"}</td>`;
		return `<tr>` +
			`<td style='padding:9px 14px;color:${appsmith.theme.colors.textSecondaryColor};width:320px;border-bottom:1px solid ${appsmith.theme.colors.borderColor};'>${label}</td>` +
			`<td style='padding:9px 14px;color:${appsmith.theme.colors.textStrongColor};font-weight:600;border-bottom:1px solid ${appsmith.theme.colors.borderColor};'>${valueHtml}</td>` +
			auditCell + `</tr>`;
	},

	_section(title, rowsHtml) {
		return `<div style='margin-bottom:22px;'>` +
			`<div style='font-size:15px;font-weight:700;color:${appsmith.theme.colors.linkSoftColor};margin-bottom:8px;'>${title}</div>` +
			`<table style='width:100%;border-collapse:collapse;background:${appsmith.theme.colors.surfaceColor};border:1px solid ${appsmith.theme.colors.borderColor};border-radius:6px;overflow:hidden;'>${rowsHtml}</table>` +
			`</div>`;
	},

	// User Info tab: Main Information, Status, Reset Password.
	getUserHtml(detail) {
		const d = (Array.isArray(detail) && detail[0]) || {};
		const esc = (v) => (v == null || v === "") ? "—" : String(v);
		const statusPill = d.active
			? "<span style='color:" + appsmith.theme.colors.successColor + ";'>&#9679; Active</span>"
			: "<span style='color:" + appsmith.theme.colors.dangerColor + ";'>&#9679; Inactive</span>";

		const main = this._section("Main Information",
			this._row("ID", esc(d.id)) +
			this._row("First Name", esc(d.first_name), "Admin System") +
			this._row("Last Name", esc(d.last_name), "Admin System") +
			this._row("Email", esc(d.email)) +
			this._row("Phone number", esc(d.phone), "Admin System") +
			this._row("Notifications", esc(d.notification) === "—" ? "Email" : esc(d.notification), "Admin System") +
			this._row("Role", esc(d.role) === "—" ? "Customer" : esc(d.role), "Admin System"));

		const status = this._section("Status",
			this._row("User status", statusPill, "Admin System"));

		const reset = this._section("Reset Password",
			`<tr><td colspan='2' style='padding:10px 14px;'>` +
			`<span style='color:${appsmith.theme.colors.linkColor};text-decoration:underline;cursor:pointer;'>Send reset password email</span></td></tr>`);

		return `<div style='font-family:sans-serif;padding:8px 4px;'>${main}${status}${reset}</div>`;
	},

	// Customers tab: the customers this user belongs to.
	getCustomersHtml(customers) {
		const rows = Array.isArray(customers) ? customers : [];
		const esc = (v) => (v == null || v === "") ? "—" : String(v);
		const th = (t) => `<th style='text-align:left;padding:12px 16px;color:${appsmith.theme.colors.textSoftColor};font-weight:700;border-bottom:1px solid ${appsmith.theme.colors.borderColor};'>${t}</th>`;
		const td = (v) => `<td style='padding:12px 16px;color:${appsmith.theme.colors.textColor};border-bottom:1px solid ${appsmith.theme.colors.borderSoftColor};'>${v}</td>`;
		const head = `<tr>${th("ID")}${th("Name")}${th("User Role")}${th("Job Title")}${th("Locations")}</tr>`;
		const body = rows.length
			? rows.map((r) =>
				`<tr>${td(`<span style='color:${appsmith.theme.colors.linkColor};'>${esc(r.id)}</span>`)}${td(esc(r.name))}${td(esc(r.user_role))}${td(esc(r.job_title))}${td(esc(r.locations))}</tr>`).join("")
			: `<tr><td colspan='5' style='padding:24px;text-align:center;color:${appsmith.theme.colors.textMutedColor};font-style:italic;'>No customers</td></tr>`;
		return `<div style='font-family:sans-serif;'><table style='width:100%;border-collapse:collapse;background:${appsmith.theme.colors.surfaceColor};border:1px solid ${appsmith.theme.colors.borderColor};border-radius:6px;overflow:hidden;font-size:14px;'>${head}${body}</table></div>`;
	}
}
