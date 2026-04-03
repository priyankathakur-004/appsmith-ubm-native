export default {
  getSelectedAttributeLocationIds() {
    const selectedValue = Attribute_Value.selectedOptionValue;
    if (!selectedValue || !getLocationAttributes.data) return [];

    return getAttributeValues.data
      .filter(row => row.attribute_value == selectedValue)
      .map(row => row.location_id)
      .filter(id => !!id); // remove null/undefined
  }
}