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

	getExpandedPath() {
		return appsmith.store.utExpandedPath || [];
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

		// Accordion: prune the tree to only keep children along the expanded path.
		// Siblings of the selected node at each depth stay visible (so the user
		// can switch), but their own children are dropped so columns to the right
		// only show the currently drilled path.
		const expandedPath = this.getExpandedPath();
		const pruneToPath = (node, depth) => {
			if (!node.children || !node.children.length) return;
			const selectedName = expandedPath[depth];
			if (!selectedName) {
				// Nothing selected at this depth — drop grandchildren entirely.
				node.children.forEach(c => { delete c.children; });
				return;
			}
			node.children.forEach(child => {
				if (child.name === selectedName) {
					pruneToPath(child, depth + 1);
				} else {
					delete child.children;
				}
			});
		};
		pruneToPath(root, 0);

		return root;
	},

	handleNodeClick() {
		// Appsmith normalizes CUSTOM_ECHART click payloads differently across
		// series types, so inspect every possible location the clicked node's
		// data might live.
		const dp = UTTreeChart.selectedDataPoint || {};
		const candidates = [
			dp,
			dp.data,
			dp.rawEventData,
			dp.rawEventData && dp.rawEventData.data
		].filter(Boolean);

		let name = null;
		let depth = null;
		for (const c of candidates) {
			if (name == null && typeof c.name === 'string') name = c.name;
			if (depth == null && typeof c.depth === 'number') depth = c.depth;
			if (depth == null && Array.isArray(c.value) && typeof c.value[0] === 'number') depth = c.value[0];
			if (depth == null && typeof c.x === 'number' && Number.isInteger(c.x)) depth = c.x;
		}
		// Last-ditch fallback: dp.x is depth (graph series in cartesian2d)
		if (depth == null && typeof dp.x === 'number' && Number.isInteger(dp.x)) depth = dp.x;

		if (!name || depth == null || depth === 0) return;

		const current = appsmith.store.utExpandedPath || [];
		const sameNode = current[depth - 1] === name;
		let next;
		if (sameNode) {
			next = current.slice(0, depth - 1);
		} else {
			next = current.slice(0, depth - 1);
			next[depth - 1] = name;
		}
		storeValue('utExpandedPath', next);
	},

	resetExpansion() {
		storeValue('utExpandedPath', []);
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
		const HEADER_COLOR = '#cbd5e1';
		const SEPARATOR_COLOR = '#334155';
		const LABEL_NAME_COLOR = '#e2e8f0';
		const LABEL_VAL_COLOR = '#94a3b8';
		const EDGE_COLOR = '#475569';

		const headers = ['', 'Utility Type', 'Bill Type', 'Vendor', 'Location', 'Service Account', 'Meter'];
		const MAX_DEPTH = 6;

		// Max value at each depth — used for the fill-bar ratio
		const maxByDepth = {};
		const walkMax = (node, depth) => {
			maxByDepth[depth] = Math.max(maxByDepth[depth] || 0, node.value || 0);
			(node.children || []).forEach(c => walkMax(c, depth + 1));
		};
		walkMax(treeData, 0);

		const FIXED_WIDTH = 150;
		const BAR_HEIGHT = 20;

		// Self-contained value formatter (no `this` — closures die in serialization)
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

		const makeItemStyle = (val, depth) => {
			const maxVal = maxByDepth[depth] || 1;
			const fillRatio = Math.min(0.998, Math.max(0.02, val / maxVal));
			return {
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
		};

		// Flatten the pruned tree into a graph (nodes + links) with explicit
		// cartesian positions. x = depth, y = vertical stacking index.
		// Each column's siblings are stacked centered around y=0 so the chart
		// stays visually balanced regardless of how many items are in each column.
		const graphNodes = [];
		const graphLinks = [];
		const nodeIdByRef = new Map();
		let idCounter = 0;

		// Bucket nodes by depth so we can stack siblings column-by-column
		const byDepth = {};
		const collect = (node, parent) => {
			const d = node.depth || 0;
			if (!byDepth[d]) byDepth[d] = [];
			byDepth[d].push({ node: node, parent: parent });
			(node.children || []).forEach(c => collect(c, node));
		};
		collect(treeData, null);

		// Global max sibling count drives yAxis range
		let maxSiblings = 1;
		Object.keys(byDepth).forEach(k => {
			maxSiblings = Math.max(maxSiblings, byDepth[k].length);
		});
		// Spacing between siblings in data units. Larger = more gap between rows.
		const Y_STEP = 1.6;
		// How far from a node's center to pull the edge endpoint so lines meet
		// the bar's side edges instead of passing through the center.
		const EDGE_X_OFFSET = 0.36;

		Object.keys(byDepth)
			.map(Number)
			.sort((a, b) => a - b)
			.forEach(depth => {
				const list = byDepth[depth];
				const total = list.length;
				// Center siblings around y = 0 (cartesian), visually centered in the chart
				list.forEach((entry, i) => {
					const id = 'n' + (idCounter++);
					nodeIdByRef.set(entry.node, id);
					const y = ((total - 1) / 2 - i) * Y_STEP;
					const val = entry.node.value || 0;
					graphNodes.push({
						id: id,
						name: entry.node.name,
						// For graph series on cartesian2d, the position is the first two
						// items of `value`. We stash the numeric metric separately.
						value: [depth, y],
						metric: val,
						depth: depth,
						formattedValue: formatVal(val),
						pctOfDepth: ((val / (maxByDepth[depth] || 1)) * 100).toFixed(1),
						symbolSize: [FIXED_WIDTH, BAR_HEIGHT],
						itemStyle: depth === 0
							? { color: FILL_COLOR, borderColor: BORDER_COLOR, borderWidth: 0.5 }
							: makeItemStyle(val, depth)
					});
					if (entry.parent) {
						graphLinks.push({
							source: nodeIdByRef.get(entry.parent),
							target: id
						});
					}
				});
			});

		// Build a node lookup so we can compute edge coordinates in data space.
		const nodeById = {};
		graphNodes.forEach(n => { nodeById[n.id] = n; });

		// Edge lines — drawn as a separate `lines` series so endpoints can be
		// offset to the left/right edges of each bar instead of the center.
		const edgeLines = graphLinks.map(link => {
			const src = nodeById[link.source];
			const tgt = nodeById[link.target];
			return {
				coords: [
					[src.value[0] + EDGE_X_OFFSET, src.value[1]],
					[tgt.value[0] - EDGE_X_OFFSET, tgt.value[1]]
				]
			};
		});

		// Header nodes — one per column (depth 1..MAX_DEPTH), rendered as a second
		// scatter series in the SAME cartesian coord system. This is the only
		// reliable way to keep headers aligned with columns across any chart size.
		const headerNodes = [];
		const maxSiblingsHalf = (maxSiblings * Y_STEP) / 2;
		const headerY = maxSiblingsHalf + Y_STEP * 1.4; // sits above the tallest column
		for (let d = 1; d <= MAX_DEPTH; d++) {
			headerNodes.push({
				value: [d, headerY],
				name: headers[d]
			});
		}

		// Compute y-axis range so the tallest column fits with padding for headers
		const yHalfRange = Math.max(maxSiblingsHalf + Y_STEP * 2.2, 6);

		return {
			backgroundColor: BG_COLOR,
			tooltip: {
				trigger: 'item',
				backgroundColor: '#0F172A',
				borderColor: SEPARATOR_COLOR,
				borderWidth: 1,
				textStyle: { color: LABEL_NAME_COLOR, fontSize: 13 },
				formatter: function(params) {
					if (params.seriesType !== 'graph') return '';
					const d = params.data;
					if (!d || d.depth == null) return '';
					return '<b>' + (d.name || '') + '</b><br/>' +
						(d.formattedValue || '') + ' (' + (d.pctOfDepth || '0') + '%)';
				}
			},
			grid: {
				left: 40,
				right: 40,
				top: 50,
				bottom: 30,
				containLabel: false
			},
			xAxis: {
				type: 'value',
				show: false,
				min: -0.3,
				max: MAX_DEPTH + 0.7,
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				show: false,
				min: -yHalfRange,
				max: yHalfRange,
				splitLine: { show: false }
			},
			series: [
				{
					// Column headers row
					type: 'scatter',
					coordinateSystem: 'cartesian2d',
					symbolSize: 0,
					silent: true,
					data: headerNodes,
					label: {
						show: true,
						position: 'inside',
						fontSize: 13,
						fontWeight: 'bold',
						color: HEADER_COLOR,
						formatter: function(p) { return p.name; }
					},
					emphasis: { disabled: true },
					blur: {
						label: { opacity: 1 },
						itemStyle: { opacity: 1 }
					},
					markLine: {
						silent: true,
						symbol: 'none',
						lineStyle: { color: SEPARATOR_COLOR, type: 'solid', width: 1 },
						data: [
							{ yAxis: headerY - 0.9 }
						],
						label: { show: false }
					},
					z: 5
				},
				{
					// Edge lines (drawn beneath the bar nodes)
					type: 'lines',
					coordinateSystem: 'cartesian2d',
					polyline: false,
					silent: true,
					data: edgeLines,
					lineStyle: {
						color: EDGE_COLOR,
						width: 1,
						opacity: 0.9
					},
					effect: { show: false },
					z: 2
				},
				{
					type: 'graph',
					coordinateSystem: 'cartesian2d',
					layout: 'none',
					symbol: 'rect',
					symbolSize: [FIXED_WIDTH, BAR_HEIGHT],
					data: graphNodes,
					links: [],
					edgeSymbol: ['none', 'none'],
					emphasis: {
						disabled: false,
						scale: false,
						focus: 'none',
						itemStyle: {
							borderColor: '#60a5fa',
							borderWidth: 2
						}
					},
					blur: {
						itemStyle: { opacity: 1 },
						label: { opacity: 1 }
					},
					label: {
						show: true,
						position: 'bottom',
						verticalAlign: 'top',
						align: 'left',
						distance: 6,
						offset: [-FIXED_WIDTH / 2, 0],
						rich: {
							name: {
								fontSize: 12,
								fontWeight: 'bold',
								color: LABEL_NAME_COLOR,
								padding: [0, 0, 2, 0]
							},
							val: {
								fontSize: 11,
								color: LABEL_VAL_COLOR
							}
						},
						formatter: function(params) {
							const d = params.data;
							if (!d || d.depth == null || d.depth === 0) return '';
							return '{name|' + (d.name || '') + '}\n{val|' + (d.formattedValue || '') + '}';
						}
					},
					z: 10
				}
			]
		};
	},

	setDefaults() {
		if (!appsmith.store.utViewBy) storeValue('utViewBy', 'Consumption');
	}
}
