export default {
	/* Static option lists for the Warnings slicers. Deliberately reads no widgets and no queries,
	   so a slicer's sourceData can reference it without creating a dependency cycle or a
	   data/run-trigger misuse (which is why WOSeveritySelect can't source from BH_BillHealthHelper). */
	severityOptions() {
		return [
			{ label: 'High', value: 'High' },
			{ label: 'Medium', value: 'Medium' },
			{ label: 'Low', value: 'Low' }
		];
	}
}
