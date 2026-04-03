export default {
	getViewBy() {
		return appsmith.store.utViewBy || 'Consumption';
	},

	getChartTitle() {
		const viewBy = this.getViewBy();
		const raw = fetch_analytics_data.data || [];
		const units = new Set();
		raw.forEach(r => { if (r.total_consumption_uom) units.add(r.total_consumption_uom); });
		const uom = units.size === 1 ? Array.from(units)[0] : '';
		if (viewBy === 'Charges') return 'Charges ($)';
		return uom ? 'Consumption (' + uom + ')' : 'Consumption';
	},

	buildTreeData() {
		const raw = fetch_analytics_data.data || [];
		const viewBy = this.getViewBy();
		const isCharges = viewBy === 'Charges';

		const root = { name: viewBy, value: 0, children: [] };
		const level1 = {};

		raw.forEach(r => {
			const ut = r.utility_type || 'Unknown';
			const bt = r.bill_type || 'Unknown';
			const loc = r.location_description || 'Unknown';
			const val = isCharges ? (parseFloat(r.total_charges) || 0) : (parseFloat(r.consumption) || 0);

			root.value += val;

			if (!level1[ut]) level1[ut] = { name: ut, value: 0, _children: {} };
			level1[ut].value += val;

			var btKey = bt;
			if (!level1[ut]._children[btKey]) level1[ut]._children[btKey] = { name: bt, value: 0, _children: {} };
			level1[ut]._children[btKey].value += val;

			if (!level1[ut]._children[btKey]._children[loc]) level1[ut]._children[btKey]._children[loc] = { name: loc, value: 0 };
			level1[ut]._children[btKey]._children[loc].value += val;
		});

		root.children = Object.values(level1)
			.map(function(l1) {
				return {
					name: l1.name,
					value: Math.round(l1.value),
					children: Object.values(l1._children)
						.map(function(l2) {
							return {
								name: l2.name,
								value: Math.round(l2.value),
								children: Object.values(l2._children)
									.map(function(l3) {
										return { name: l3.name, value: Math.round(l3.value) };
									})
									.sort(function(a, b) { return b.value - a.value; })
							};
						})
						.sort(function(a, b) { return b.value - a.value; })
				};
			})
			.sort(function(a, b) { return b.value - a.value; });

		root.value = Math.round(root.value);
		return root;
	},

	formatValue(v) {
		if (v >= 1000000000) return (v / 1000000000).toFixed(1) + 'B';
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return Math.round(v / 1000) + 'K';
		return v.toLocaleString();
	},

	getTreeChartConfig() {
			const treeData = this.buildTreeData();
			const rootValue = treeData.value || 1;

			// Headers for each tree depth (index 0 = root)
			const headers = ['', 'Utility Type', 'Bill Type', 'Vendor', 'Location', 'Service Account'];
			// Track selected/active value at each depth (customize as needed)
			const selectedValues = ['', '', '', '', '', ''];

			// Max value at each depth for fill ratio
			const maxByDepth = {};
			const walk = (node, depth) => {
					maxByDepth[depth] = Math.max(maxByDepth[depth] || 0, node.value || 0);
					(node.children || []).forEach(c => walk(c, depth + 1));
			};
			walk(treeData, 0);

			// Assign fill-bar styles per node
			const FIXED_WIDTH = 150;
			const BAR_HEIGHT = 20;
			const FILL_COLOR = '#22c55e';     // lighter green for filled portion
			const TRACK_COLOR = '#1E293B';    // dark track background
			const BORDER_COLOR = '#94a3b8';

			const assignStyles = (node, depth) => {
					const val = node.value || 0;
					const maxVal = maxByDepth[depth] || 1;
					const fillRatio = Math.min(0.998, Math.max(0.03, val / maxVal));

					node.symbolSize = [FIXED_WIDTH, BAR_HEIGHT];
					node.itemStyle = {
							color: {
									type: 'linear',
									x: 0, y: 0, x2: 1, y2: 0,
									colorStops: [
											{ offset: 0, color: FILL_COLOR },
											{ offset: fillRatio, color: FILL_COLOR },
											{ offset: fillRatio + 0.001, color: TRACK_COLOR },
											{ offset: 1, color: TRACK_COLOR }
									]
							},
						 borderColor: BORDER_COLOR,
						 borderWidth: 0.5

					};
					(node.children || []).forEach(c => assignStyles(c, depth + 1));
			};
			assignStyles(treeData, 0);

			// Build graphic elements for column headers
			// Approximate x% positions for each depth column — adjust to match your chart width
			const headerXPositions = [5, 22, 38, 54, 70, 86];
			const graphicElements = [];

			headers.forEach((text, i) => {
					if (!text) return;
					// Header label (bold, underlined)
					graphicElements.push({
							type: 'group',
							left: headerXPositions[i] + '%',
							top: 10,
							children: [
									{
											type: 'text',
											style: {
													text: text,
													fontSize: 13,
													fontWeight: 'bold',
													fill: '#cbd5e1',
													textDecoration: 'underline'
											}
									},
									// Selected value below header
									{
											type: 'text',
											top: 20,
											style: {
													text: selectedValues[i] || '',
													fontSize: 11,
													fill: '#64748b'
											}
									},
									// "×" dismiss icon
									...(selectedValues[i] ? [{
											type: 'text',
											top: -2,
											left: text.length * 8 + 10,
											style: {
													text: '×',
													fontSize: 14,
													fill: '#64748b',
													cursor: 'pointer'
											}
									}] : [])
							]
					});
			});

			// Separator line below headers
			graphicElements.push({
					type: 'line',
					left: '3%',
					top: 48,
					shape: { x1: 0, y1: 0, x2: 1500, y2: 0 },
					style: { stroke: '#334155', lineWidth: 1 }
			});

			return {
					backgroundColor: '#1E293B',
					graphic: graphicElements,
					tooltip: {
							trigger: 'item',
							backgroundColor: '#1e293b',
							borderColor: '#334155',
							textStyle: { color: '#e2e8f0', fontSize: 13 },
							formatter: function(params) {
									const d = params.data;
									const max = maxByDepth[d.depth] || rootValue;
									const pct = ((d.value / max) * 100).toFixed(1);
									return '<b>' + d.name + '</b><br/>' +
											(d.value || 0).toLocaleString() + ' (' + pct + '%)';
							}
					},
					series: [{
							type: 'tree',
							data: [treeData],
							orient: 'LR',
							top: 30,          // push tree below headers
							bottom: 30,
							left: 40,
							right: 140,
							layerPadding: 160,
							nodePadding: 50,
							initialTreeDepth: 3,
							expandAndCollapse: true,
							roam: false,
							edgeShape: 'polyline',
							edgeForkPosition: '50%',
							lineStyle: {
									color: '#475569',
									width: 1.2
							},
							symbol: 'rect',
							symbolSize: [FIXED_WIDTH, BAR_HEIGHT],
							emphasis: {
									itemStyle: {
											color: '#7c9ec7',
											borderColor: '#93c5fd'
									},
									lineStyle: {
											color: '#93c5fd',
											width: 2
									}
							},
							label: {
									position: 'bottom',
									verticalAlign: 'top',
									distance: 5,
									align: 'left',
									rich: {
											name: {
													fontSize: 12,
													fontWeight: 'bold',
													color: '#e2e8f0',
													padding: [0, 0, 2, 0]
											},
											val: {
													fontSize: 11,
													color: '#94a3b8'
											}
									},
									formatter: function(params) {
											const d = params.data;
											return '{name|' + d.name + '}\n{val|' +
													(d.value || 0).toLocaleString() + '}';
									}
							},
							leaves: {
									label: {
											position: 'bottom',
											verticalAlign: 'top',
											distance: 5,
											align: 'left',
											rich: {
													name: {
															fontSize: 12,
															fontWeight: 'bold',
															color: '#e2e8f0',
															padding: [0, 2, 2, 0]
													},
													val: {
															fontSize: 11,
															color: '#94a3b8'
													}
											},
											formatter: function(params) {
													const d = params.data;
													return '{name|' + d.name + '}\n{val|' +
															(d.value || 0).toLocaleString() + '}';
											}
									}
							}
					}]
			};
	},

	setDefaults() {
		if (!appsmith.store.utViewBy) storeValue('utViewBy', 'Consumption');
	}
}