export default {
  /**
   * Capitalizes only the first letter of a string
   * Example: "BUILDING" → "Building"
   * Handles null/empty values safely
   */
  toTitleCase(str) {
    if (!str || typeof str !== "string") return "";
    const lower = str.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
}
