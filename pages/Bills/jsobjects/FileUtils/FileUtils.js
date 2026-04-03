export default {
  async downloadBillFile() {
    const fileData = getBillFileUrl.data && getBillFileUrl.data[0];
    if (!fileData || !fileData.path) {
      showAlert("No file found for this bill.", "warning");
      return;
    }

    // Build Google Cloud Storage public URL (signed URL format)
    const filePath = fileData.path; // e.g., gs://production-179213-data/files/76013/live$fdgmanual$PEARDEMO_P$202406.pdf
    const encodedPath = encodeURIComponent(filePath.replace("gs://", ""));
    const baseUrl = "https://storage.googleapis.com/";
    const fileUrl = baseUrl + encodedPath;

    // Open file in a new tab
    navigateTo(fileUrl, {}, 'NEW_WINDOW');
  }
}
