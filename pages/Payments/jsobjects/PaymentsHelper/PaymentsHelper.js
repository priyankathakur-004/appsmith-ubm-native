export default {
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
  async openBatch() {
    const date = PaymentsList.model.activeDate;
    if (!date) return;
    await storeValue("pay_active_date", date);
    await fetch_batch_details.run();
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
    const cols = ["Bill ID", "Amount Due", "Vendor", "Billing ID", "Due Date", "Invoice Date", "Fee"];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = cols.join(",");
    const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
    const csv = header + "\n" + body;
    const cust = (appsmith.store.selectedCustomerName || "Customer").replace(/\s+/g, "");
    const fname = fileName || (type + "-" + cust + "-" + date + ".csv");
    download(csv, fname, "text/csv");
    showAlert("Downloaded " + fname, "success");
  }
}
