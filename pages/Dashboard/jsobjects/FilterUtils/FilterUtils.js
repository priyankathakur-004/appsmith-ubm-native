export default {
  // Maps AG Grid field names (column aliases) to their complex SQL expressions
  columnMap: {
    "Vendor": `COALESCE(cvn.pretty_name, br.vendor_code)`,
    "Invoice Date": `TO_CHAR(br.statement_date, 'YYYY-MM-DD')`, // Use canonical date format for SQL comparison
    "Billing ID": `br.client_account`,
    "Utility Type": `bi.commodity`,
    // IMPORTANT: Add all filterable columns here, mapped to their underlying SQL expression/column
  },

  // Generates the SQL WHERE clause fragment
  generateSqlWhereClause: (filters) => {
    // If no filters are provided, return an empty string (no filtering)
    if (!filters || Object.keys(filters).length === 0) {
      return '';
    }

    const conditions = [];

    for (const field in filters) {
      const filter = filters[field];
      const sqlColumn = this.columnMap[field];

      if (!sqlColumn) {
        console.warn(`Filter field "${field}" is not mapped to a SQL column in FilterUtils.columnMap.`);
        continue;
      }

      let condition = '';
      const filterValue = filter.filter;
      const type = filter.type;

      switch (type) {
        // Standard Text Filters
        case 'contains':
          condition = `${sqlColumn} ILIKE '%${filterValue}%'`;
          break;
        case 'notContains':
          condition = `${sqlColumn} NOT ILIKE '%${filterValue}%'`;
          break;
        case 'equals':
          condition = `${sqlColumn} = '${filterValue}'`;
          break;
        case 'startsWith':
          condition = `${sqlColumn} ILIKE '${filterValue}%'`;
          break;
        case 'endsWith':
          condition = `${sqlColumn} ILIKE '%${filterValue}'`;
          break;

        // Numeric / Date Filters (assuming simple equals/range for simplicity)
        case 'lessThan':
          condition = `${sqlColumn} < ${filterValue}`;
          break;
        case 'greaterThan':
          condition = `${sqlColumn} > ${filterValue}`;
          break;
        case 'inRange':
          condition = `${sqlColumn} BETWEEN ${filter.dateFrom} AND ${filter.dateTo}`;
          break;
      }

      if (condition) {
        conditions.push(`(${condition})`); // Wrap each condition for safety
      }
    }

    if (conditions.length > 0) {
      // Prepend 'AND' because it will follow the existing 'WHERE' clause
      return ` AND ${conditions.join(' AND ')}`;
    }
    return '';
  }
}