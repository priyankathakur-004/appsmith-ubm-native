export default {
  getTreeData: () => {
    const data = fetchLocations.data;

    const map = {};
    const roots = [];

    // Create nodes
    data.forEach(item => {
      map[item.id] = {
        label: item.name && item.name !== "" ? item.name : item.address,
        value: item.id,
        parent_id: item.parent_id,
				location_id:item.location_id,
        children: []
      };
    });

    // Build tree
    data.forEach(item => {
      const node = map[item.id];

      // CASE 1: Root when parent_id is null
      // CASE 2: Root when parent does NOT exist in map
      if (!item.parent_id || !map[item.parent_id]) {
        roots.push(node);
      } else {
        map[item.parent_id].children.push(node);
      }
    });

    // Add single root
    return [
      {
        label: "All Locations",
        value: "all_locations",
        children: roots
      }
    ];
  }
};
