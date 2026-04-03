export default {
  hardReload() {
    const currentPage = appsmith.URL.fullPath;
    navigateTo(currentPage, {}, "SAME_WINDOW");
  }
}