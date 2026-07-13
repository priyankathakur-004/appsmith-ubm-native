export default {
  // Runs on page load: clear the persisted accumulation so a fresh first
  // page is fetched (appsmith.store survives reloads and would serve stale rows).
  async initPage() {
    await storeValue("pay_rows", []);
    await storeValue("pay_page", 0);
    await storeValue("pay_done", false);
    await storeValue("pay_loading", false);
    await storeValue("pay_error", null);
    await storeValue("pay_active_date", null);
    await storeValue("pay_month", null);
  },

  // Append-paginated loader for the payment batches list (infinite scroll).
  async loadMore() {
    if (appsmith.store.pay_loading || appsmith.store.pay_done || appsmith.store.pay_error) return;
    await storeValue("pay_loading", true);
    await storeValue("pay_error", null);
    const size = 10;
    const page = appsmith.store.pay_page || 0;
    try {
      const res = await fetch_payment_batches.run({ limit: size, offset: page * size });
      const rows = Array.isArray(res) ? res : [];
      const prev = appsmith.store.pay_rows || [];
      await storeValue("pay_rows", prev.concat(rows));
      await storeValue("pay_page", page + 1);
      if (rows.length < size) await storeValue("pay_done", true);
    } catch (e) {
      // Halt the scroll loop on failure so it does not retrigger endlessly.
      await storeValue("pay_error", e.message || String(e));
      showAlert("Failed to load payments: " + (e.message || e), "error");
    } finally {
      await storeValue("pay_loading", false);
    }
  },

  // Clear the accumulated list so the widget reloads from the first page
  // (used when the selected customer changes).
  async resetAndLoad() {
    await storeValue("pay_rows", []);
    await storeValue("pay_page", 0);
    await storeValue("pay_done", false);
    await storeValue("pay_loading", false);
    await storeValue("pay_error", null);
    await storeValue("pay_active_date", null);
  },

  // Open the bill-payment-details modal for the clicked processing date.
  // Uses a native modal (BillDetailsModal) so the popup stays centered on
  // scroll — a modal rendered inside the custom widget's iframe cannot.
  async openBatch() {
    const date = PaymentsList.model.activeDate;
    if (!date) return;
    await storeValue("pay_active_date", date);
    await fetch_batch_details.run();
    showModal("BillDetailsModal");
  },

  // Title for the native details modal, e.g. "Bill Payment Details for 06/07/2026".
  getDetailsTitle() {
    const d = appsmith.store.pay_active_date;
    if (!d) return "Bill Payment Details";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    const disp = m ? m[2] + "/" + m[3] + "/" + m[1] : d;
    return "Bill Payment Details for " + disp;
  },

  // Build the HTML table shown in the native details modal (rendered by a
  // TEXT_WIDGET, same approach as the Analytics showTable modal).
  getDetailsHtml() {
    const rows = fetch_batch_details.data || [];
    if (fetch_batch_details.isLoading) {
      return '<div style="padding:24px;color:#94A3B8;text-align:center;">Loading...</div>';
    }
    if (!rows.length) {
      return '<div style="padding:24px;color:#94A3B8;text-align:center;">No bills in this payment.</div>';
    }
    const cols = ["Bill ID", "Due Date", "Invoice Date", "Vendor", "Billing ID", "Amount Due", "Fees", "Amount Paid"];
    const moneyCols = { "Amount Due": 1, "Fees": 1, "Amount Paid": 1 };
    const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const thBase = "padding:10px 14px;color:#F1F5F9;font-size:13px;font-weight:700;border-bottom:2px solid #475569;white-space:nowrap;";
    const tdBase = "padding:10px 14px;color:#E2E8F0;font-size:12px;border-bottom:1px solid #334155;white-space:nowrap;";
    const header = '<tr style="background:#334155;">' + cols.map((c) => {
      const align = moneyCols[c] ? "right" : "left";
      return '<th style="' + thBase + "text-align:" + align + ';">' + c + "</th>";
    }).join("") + "</tr>";
    const body = rows.map((r) => "<tr>" + cols.map((c) => {
      const align = moneyCols[c] ? "right" : "left";
      const v = moneyCols[c] ? fmtMoney(r[c]) : (r[c] != null ? r[c] : "");
      return '<td style="' + tdBase + "text-align:" + align + ';">' + v + "</td>";
    }).join("") + "</tr>").join("");
    return '<div style="max-height:560px;overflow:auto;"><table style="width:100%;border-collapse:collapse;background:#1E293B;">' + header + body + "</table></div>";
  },

  // Build and download the payment file (CSV) for a given date + file type.
  async downloadFile() {
    const date = PaymentsList.model.dlDate;
    const type = PaymentsList.model.dlType;
    const fileName = PaymentsList.model.dlName;
    if (!date || !type) return;
    await storeValue("pay_dl_date", date);
    await storeValue("pay_dl_type", type);
    const res = await fetch_download_rows.run();
    const rows = Array.isArray(res) ? res : [];
    if (!rows.length) {
      showAlert("No rows found for this payment file.", "warning");
      return;
    }
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const custName = CustomerSelect.selectedOptionLabel || appsmith.store.selectedCustomerName || "";
    const custId = CustomerSelect.selectedOptionValue || appsmith.store.selectedCustomerId || "";
    // File date (e.g. 2026-06-08) comes from the real filename, not payment_file_date.
    const fdMatch = (fileName || "").match(/(\d{4}-\d{2}-\d{2})/);
    const fileDate = fdMatch ? fdMatch[1] : date;

    let csv;
    if (type === "bill_pay") {
      // Exact PayClearly (PC-Payment) 41-column layout.
      const headers = ["Amount", "Vendor ID", "Vendor Name", "Account ID", "Invoice Number", "Invoice Date", "Notification Email", "Add Email", "Reference Number", "Memo", "UDF1", "UDF2", "UDF3", "UDF4", "UDF5", "UDF6", "UDF7", "UDF8", "UDF9", "UDF10", "UDF11", "UDF12", "UDF13", "UDF14", "UDF15", "UDF16", "UDF17", "UDF18", "UDF19", "Account number", "Credential1", "Credential2", "Credential3", "Credential4", "Supplier Field 1", "Supplier address line 1", "Supplier address line 2", "Supplier City", "Supplier State", "Supplier Post Code", "Supplier Country"];
      const body = rows.map((r) => {
        const acct = r["Billing ID"];
        const cols = [
          r["Amount Due"], "", r["Vendor"], acct, "", r["Invoice Date"], "", "", "", "",
          r["Bill ID"], custName, custId, r["Invoice Date"], fileDate, acct, acct, "false", r["Hash"], "",
          "", "", "", "", "", "", "", "", "", acct,
          "", "", "", "", custName, "", "", "", "", "", ""
        ];
        return cols.map(esc).join(",");
      }).join("\n");
      csv = headers.join(",") + "\n" + body;
    } else {
      // Generic layout for summary / other file types.
      const cols = ["Bill ID", "Amount Due", "Vendor", "Billing ID", "Due Date", "Invoice Date", "Fee"];
      const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
      csv = cols.join(",") + "\n" + body;
    }

    const fname = fileName || (type + "-" + String(custName).replace(/\s+/g, "") + "-" + date + ".csv");
    download(csv, fname, "text/csv");
    showAlert("Downloaded " + fname, "success");
  }
}
