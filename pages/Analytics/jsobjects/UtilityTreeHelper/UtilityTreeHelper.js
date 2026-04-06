export default {
	getViewBy() {
		return appsmith.store.utViewBy || 'Consumption';
	},

	getChartTitle() {
		const viewBy = this.getViewBy();
		if (viewBy === 'Charges') return 'Decomposition of Charges';
		const raw = fetch_utility_tree_data.data || [];
		const units = new Set();
		raw.forEach(r => { if (r.total_consumption_uom) units.add(r.total_consumption_uom); });
		const uom = units.size === 1 ? Array.from(units)[0] : '';
		return uom ? 'Consumption (' + uom + ')' : 'Consumption';
	},

	buildTreeData() {
		const raw = fetch_utility_tree_data.data || [];
		const viewBy = this.getViewBy();
		const isCharges = viewBy === 'Charges';

		// Levels: Utility Type -> Bill Type -> Vendor -> Location -> Service Account -> Meter
		const getKey = (r) => [
			r.utility_type || 'Unknown',
			r.bill_type || 'Unknown',
			r.vendor_name || 'Unknown',
			r.location_description || 'Unknown',
			r.service_account || 'Unknown',
			r.meter || 'Unknown'
		];

		const root = { name: isCharges ? 'Charges' : 'Consumption', value: 0, depth: 0, _children: {} };

		raw.forEach(r => {
			const val = isCharges ? (parseFloat(r.total_charges) || 0) : (parseFloat(r.consumption) || 0);
			if (!val) return;
			root.value += val;

			const keys = getKey(r);
			let node = root;
			for (let i = 0; i < keys.length; i++) {
				const k = keys[i];
				if (!node._children[k]) {
					node._children[k] = { name: k, value: 0, depth: i + 1, _children: {} };
				}
				node = node._children[k];
				node.value += val;
			}
		});

		const finalize = (node) => {
			const kids = Object.values(node._children || {});
			delete node._children;
			if (kids.length) {
				node.children = kids
					.map(finalize)
					.sort((a, b) => b.value - a.value);
			}
			node.value = Math.round(node.value * 100) / 100;
			return node;
		};

		finalize(root);
		return root;
	},

	formatValue(v) {
		const isCharges = this.getViewBy() === 'Charges';
		const prefix = isCharges ? '$' : '';
		if (v >= 1000000000) return prefix + (v / 1000000000).toFixed(2) + 'B';
		if (v >= 1000000) return prefix + (v / 1000000).toFixed(2) + 'M';
		if (v >= 1000) return prefix + (v / 1000).toFixed(1) + 'K';
		if (isCharges) return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return Math.round(v).toLocaleString();
	},

	getTreeChartConfig() {
		const treeData = this.buildTreeData();
		const viewBy = this.getViewBy();
		const isCharges = viewBy === 'Charges';

		// Dark theme to match other Analytics tabs
		const FILL_COLOR = isCharges ? '#22c55e' : '#3b82f6';
		const TRACK_COLOR = '#0F172A';
		const BORDER_COLOR = '#475569';
		const BG_COLOR = '#1E293B';
		const HEADER_COLOR = '#94a3b8';
		const SEPARATOR_COLOR = '#334155';
		const LABEL_NAME_COLOR = '#e2e8f0';
		const LABEL_VAL_COLOR = '#94a3b8';
		const EDGE_COLOR = '#475569';

		const headers = ['', 'Utility Type', 'Bill Type', 'Vendor', 'Location', 'Service Account', 'Meter'];

		// Max value at each depth for fill ratio
		const maxByDepth = {};
		const walk = (node, depth) => {
			maxByDepth[depth] = Math.max(maxByDepth[depth] || 0, node.value || 0);
			(node.children || []).forEach(c => walk(c, depth + 1));
		};
		walk(treeData, 0);

		const FIXED_WIDTH = 160;
		const BAR_HEIGHT = 22;

		// Precompute formatted value so we don't need a `this` reference inside
		// ECharts formatters (Appsmith serializes the config and loses closures).
		const formatVal = function(v) {
			if (isCharges) {
				if (v >= 1000000000) return '$' + (v / 1000000000).toFixed(2) + 'B';
				if (v >= 1000000) return '$' + (v / 1000000).toFixed(2) + 'M';
				if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'K';
				return '$' + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			}
			if (v >= 1000000000) return (v / 1000000000).toFixed(2) + 'B';
			if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
			if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
			return Math.round(v || 0).toLocaleString();
		};

		const assignStyles = (node, depth) => {
			const val = node.value || 0;
			const maxVal = maxByDepth[depth] || 1;
			const fillRatio = Math.min(0.998, Math.max(0.02, val / maxVal));

			node.depth = depth;
			node.formattedValue = formatVal(val);
			node.pctOfDepth = ((val / maxVal) * 100).toFixed(1);
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

		// Attach the column name to every node based on depth so the rich
		// label can render it inline. This avoids the header-alignment problem
		// entirely — each node carries its own column label.
		const tagDepthName = (node) => {
			node.depthName = headers[node.depth] || '';
			(node.children || []).forEach(tagDepthName);
		};
		tagDepthName(treeData);

		return {
			backgroundColor: BG_COLOR,
			tooltip: {
				trigger: 'item',
				backgroundColor: '#0F172A',
				borderColor: SEPARATOR_COLOR,
				borderWidth: 1,
				textStyle: { color: LABEL_NAME_COLOR, fontSize: 13 },
				formatter: function(params) {
					const d = params.data;
					return '<b>' + d.name + '</b><br/>' +
						(d.formattedValue || '') + ' (' + (d.pctOfDepth || '0') + '%)';
				}
			},
			series: [{
				type: 'tree',
				data: [treeData],
				orient: 'LR',
				top: 40,
				bottom: 40,
				left: 70,
				right: 180,
				layerPadding: 220,
				nodePadding: 60,
				initialTreeDepth: 1,
				expandAndCollapse: true,
				roam: 'move',
				edgeShape: 'polyline',
				edgeForkPosition: '50%',
				lineStyle: {
					color: EDGE_COLOR,
					width: 1.2
				},
				symbol: 'rect',
				symbolSize: [FIXED_WIDTH, BAR_HEIGHT],
				emphasis: {
					focus: 'ancestor',
					itemStyle: {
						borderColor: '#2563eb',
						borderWidth: 1.5
					},
					lineStyle: {
						color: '#2563eb',
						width: 2
					}
				},
				label: {
					position: 'top',
					verticalAlign: 'bottom',
					distance: 6,
					align: 'center',
					rich: {
						col: {
							fontSize: 11,
							fontWeight: 'bold',
							color: HEADER_COLOR,
							padding: [0, 0, 2, 0]
						},
						name: {
							fontSize: 12,
							fontWeight: 'bold',
							color: LABEL_NAME_COLOR,
							padding: [0, 0, 1, 0]
						},
						val: {
							fontSize: 11,
							color: LABEL_VAL_COLOR
						}
					},
					formatter: function(params) {
						const d = params.data;
						const col = d.depthName ? '{col|' + d.depthName.toUpperCase() + '}\n' : '';
						return col + '{name|' + (d.name || '') + '}\n{val|' + (d.formattedValue || '') + '}';
					}
				},
				leaves: {
					label: {
						position: 'top',
						verticalAlign: 'bottom',
						distance: 6,
						align: 'center',
						rich: {
							col: {
								fontSize: 11,
								fontWeight: 'bold',
								color: HEADER_COLOR,
								padding: [0, 0, 2, 0]
							},
							name: {
								fontSize: 12,
								fontWeight: 'bold',
								color: LABEL_NAME_COLOR,
								padding: [0, 0, 1, 0]
							},
							val: {
								fontSize: 11,
								color: LABEL_VAL_COLOR
							}
						},
						formatter: function(params) {
							const d = params.data;
							const col = d.depthName ? '{col|' + d.depthName.toUpperCase() + '}\n' : '';
							return col + '{name|' + (d.name || '') + '}\n{val|' + (d.formattedValue || '') + '}';
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
