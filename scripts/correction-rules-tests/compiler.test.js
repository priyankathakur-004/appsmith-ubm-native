// Offline tests for the Correction Rules SQL compiler (RuleActions._compile).
// Loads the real JSObject file. Run: node scripts/correction-rules-tests/compiler.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../../pages/Correction Rules/jsobjects/RuleActions/RuleActions.js');
const m = { exports: {} };
new Function('module', fs.readFileSync(file, 'utf8').replace('export default', 'module.exports ='))(m);
const R = m.exports;
module.exports = R;

const D = { dateFrom: '2025-01-01', dateTo: '2025-12-31' };
const C = rule => R._compile(Object.assign({}, D, rule), 94512, 500);
const sql = rule => C(rule).sql;
const throws = (rule, re) => assert.throws(() => C(rule), re);
const quiet = require.main !== module;
let n = 0;
const t = (name, fn) => { fn(); n++; if (!quiet) console.log('ok', name); };
const rc = 'code, uom, usage, charge, category, description';
const row = x => rc.split(', ').map(c => x + '.' + c).join(', ');

t('base scoping, no line lists without observations', () => {
  const r = C({});
  assert(r.sql.includes("li.customer_id = 94512 AND li.bill_type <> 'historical' AND li.workflow_state = 'processed'"));
  assert(r.sql.includes("li.statement_date >= DATE '2025-01-01' AND li.statement_date < DATE '2025-12-31' + 1"));
  assert(!r.sql.includes('\nWHERE') && r.sql.endsWith('LIMIT 500'));
  assert(Object.keys(r.obs).length === 0 && r.targets.length === 0);
});

t('field 1 = field 2 and field 3 > 500', () => {
  assert(sql({ conditions: [
    { field: 'bill.total_charges', op: 'eq', mode: 'field', valueField: 'bill.line_count' },
    { field: 'bill.total_charges', op: 'gt', value: '500' }] }).includes('WHERE (bl.total_charges = bl.line_count AND bl.total_charges > 500)'));
});

t('demand units: bills via EXISTS, lines read alone (no per-bill totals)', () => {
  const r = C({ aliases: [{ name: 'A', conditions: [
    { field: 'A.code', op: 'in', value: ['DEM_USE', 'INFO_DEMAND'] }, { field: 'A.uom', op: 'eq', value: 'KWH' }] }] });
  assert(/EXISTS \(SELECT 1 FROM \(SELECT li\.bill_id, li\.code.*\) o_a WHERE o_a\.bill_id = bl\.bill_id AND \(o_a\.code IN \('DEM_USE', 'INFO_DEMAND'\) AND o_a\.uom = 'KWH'\)\)/.test(r.sql), r.sql);
  assert(r.targets.join() === 'A');
  assert(r.obs.A.startsWith('SELECT o_a.bill_id, o_a.statement_date, o_a.vendor, o_a.utility, ' + row('o_a')), r.obs.A);
  assert(r.obs.A.includes(") o_a\nWHERE (o_a.code IN ('DEM_USE', 'INFO_DEMAND') AND o_a.uom = 'KWH')"), r.obs.A);
  assert(!r.obs.A.includes('GROUP BY') && !r.obs.A.includes('EXISTS'), r.obs.A);
  assert(r.obs.A.includes('ORDER BY o_a.statement_date DESC, o_a.bill_id DESC, o_a.code'), r.obs.A);
});

t('a bill condition brings the per-bill totals back into the line list', () => {
  const r = C({ conditions: [{ field: 'bill.utility', op: 'eq', value: 'ELECTRIC' }],
    aliases: [{ name: 'A', conditions: [{ field: 'A.uom', op: 'eq', value: 'KWH' }] }] });
  assert(r.obs.A.includes('GROUP BY li.bill_id) bl\nJOIN (') && r.obs.A.includes(') o_a ON o_a.bill_id = bl.bill_id\nWHERE bl.utility = \'ELECTRIC\''), r.obs.A);
  // so does a bill field used inside an observation
  const r2 = C({ aliases: [{ name: 'A', conditions: [{ field: 'A.charge', op: 'gt', mode: 'field', valueField: 'bill.total_charges' }] }] });
  assert(r2.obs.A.includes('GROUP BY li.bill_id) bl') && r2.obs.A.includes('o_a.charge > bl.total_charges'), r2.obs.A);
});

t('pair: bill query joins both; line list keeps B in EXISTS tied to A', () => {
  const rule = { aliases: [
    { name: 'A', conditions: [{ field: 'A.code', op: 'contains', value: 'GEN' }] },
    { name: 'B', conditions: [{ field: 'B.code', op: 'contains', value: 'GEN' }] }],
    cross: [{ field: 'A.usage', op: 'eq', mode: 'field', valueField: 'B.usage' }] };
  const r = C(rule);
  assert(r.sql.includes(') o_b ON o_b.bill_id = o_a.bill_id') && r.sql.includes('o_a.usage = o_b.usage'));
  assert(r.sql.includes('(' + row('o_b') + ') IS DISTINCT FROM (' + row('o_a') + ')'));
  assert(r.obs.A.includes(") o_a\nWHERE o_a.code::text ILIKE '%GEN%'"), r.obs.A);
  assert(r.obs.A.includes(") o_b WHERE o_b.bill_id = o_a.bill_id AND (" + row('o_b') + ") IS DISTINCT FROM (" + row('o_a') +
    ") AND o_b.code::text ILIKE '%GEN%' AND o_a.usage = o_b.usage)"), r.obs.A);
  const rb = C(Object.assign({}, rule, { changes: [{ target: 'B', field: 'uom', value: 'KW' }] }));
  assert(rb.targets.join() === 'B' && rb.obs.B.includes(') o_b\nWHERE') && rb.obs.B.includes(') o_a WHERE o_a.bill_id = o_b.bill_id'), rb.obs.B);
});

t('changes on A and B list both, in observation order', () => {
  const r = C({ aliases: [
    { name: 'A', conditions: [{ field: 'A.code', op: 'eq', value: 'USE_ONPEAK' }] },
    { name: 'B', conditions: [{ field: 'B.code', op: 'eq', value: 'USE_OFFPEAK' }] }],
    changes: [{ target: 'B', action: 'set', field: 'code', value: 'BILLEDUSE_OFFPEAK' }, { target: 'A', action: 'set', field: 'code', value: 'BILLEDUSE_ONPEAK' }] });
  assert(r.targets.join() === 'A,B', r.targets.join());
  assert(r.obs.A.includes(") o_a\nWHERE o_a.code = 'USE_ONPEAK'") && r.obs.B.includes(") o_b\nWHERE o_b.code = 'USE_OFFPEAK'"));
  const r2 = C({ aliases: [{ name: 'A', conditions: [] }, { name: 'B', mode: 'not_exists', conditions: [] }], changes: [{ target: 'B' }] });
  assert(r2.targets.join() === 'A');
});

t('cross with a single observation goes inline', () => {
  const r = C({ aliases: [{ name: 'A', conditions: [] }], cross: [{ field: 'A.charge', op: 'gt', mode: 'field', valueField: 'A.usage' }] });
  assert(r.sql.includes('o_a.charge > o_a.usage') && r.obs.A.includes('\nWHERE o_a.charge > o_a.usage'), r.obs.A);
});

t('not exists in both queries', () => {
  const r = C({ aliases: [
    { name: 'A', conditions: [{ field: 'A.code', op: 'eq', value: 'BILLEDUSE_USE' }] },
    { name: 'B', mode: 'not_exists', conditions: [{ field: 'B.code', op: 'eq', value: 'USE_USE' }] }] });
  assert(r.sql.includes("NOT EXISTS (SELECT 1 FROM (SELECT li.bill_id") && r.sql.includes("o_b.bill_id = bl.bill_id AND o_b.code = 'USE_USE')"), r.sql);
  assert(r.obs.A.includes("o_b.bill_id = o_a.bill_id AND o_b.code = 'USE_USE')"), r.obs.A);
  assert(r.targets.join() === 'A' && !r.obs.B);
});

t('nested groups', () => {
  assert(sql({ match: 'ALL', conditions: [
    { field: 'bill.utility', op: 'eq', value: 'ELECTRIC' },
    { match: 'ANY', conditions: [
      { field: 'bill.total_charges', op: 'gt', value: 1000 },
      { match: 'ALL', conditions: [{ field: 'bill.vendor', op: 'empty' }, { field: 'bill.line_count', op: 'lt', value: 3 }] }] }] })
    .includes("(bl.utility = 'ELECTRIC' AND (bl.total_charges > 1000 OR ((bl.vendor IS NULL OR bl.vendor::text = '') AND bl.line_count < 3)))"));
});

t('escaping', () => {
  const s = sql({ conditions: [{ field: 'bill.vendor', op: 'contains', value: "O'Hare 50%_x" }, { field: 'bill.account', op: 'eq', value: "a'b" }] });
  assert(s.includes("ILIKE '%O''Hare 50\\%\\_x%'") && s.includes("bl.account = 'a''b'"), s);
});

t('empty rows are skipped; groups inside an observation', () => {
  const r = C({ conditions: [{ field: '', op: '' }, { match: 'ANY', conditions: [{ field: '' }] }],
    aliases: [{ name: 'A', match: 'ALL', conditions: [{ field: 'A.uom', op: 'eq', value: 'KWH' }, { field: '' },
      { match: 'ANY', conditions: [{ field: 'A.code', op: 'eq', value: 'DEM_USE' }, { field: 'A.code', op: 'starts', value: 'BILLEDDEM' }] }] }],
    cross: [{ field: '' }] });
  assert(r.sql.includes("o_a.bill_id = bl.bill_id AND (o_a.uom = 'KWH' AND (o_a.code = 'DEM_USE' OR o_a.code::text ILIKE 'BILLEDDEM%')))"), r.sql);
  assert(!r.sql.split('\n').some(l => l.startsWith('WHERE (') && l.includes('bl.')), r.sql);
  throws({ aliases: [{ name: 'A', conditions: [{ match: 'ANY', conditions: [{ field: 'B.code', op: 'eq', value: 'x' }] }] }, { name: 'B' }] }, /A's conditions can only use A/);
});

t('guards', () => {
  throws({ conditions: [{ field: 'bill.total_charges', op: 'gt', value: '1; DROP TABLE x' }] }, /not a number/);
  throws({ conditions: [{ field: 'bill.statement_date', op: 'gt', value: "2025-01-01' OR '1'='1" }] }, /not a date/);
  throws({ conditions: [{ field: 'bill.nope', op: 'eq', value: 1 }] }, /Unknown bill field/);
  throws({ conditions: [{ field: 'bill.vendor', op: 'gt', value: 'x' }] }, /does not apply/);
  throws({ conditions: [{ field: 'A.usage', op: 'gt', value: 1 }], aliases: [{ name: 'A' }] }, /bill fields/);
  throws({ conditions: [{ field: 'bill.vendor', op: 'eq', mode: 'field', valueField: 'bill.total_charges' }] }, /different kinds/);
  throws({ aliases: [{ name: 'A', mode: 'not_exists' }], cross: [{ field: 'A.usage', op: 'eq', value: 1 }] }, /must exist/);
  throws({ aliases: [{ name: 'E' }] }, /A to D/);
  throws({ conditions: [{ field: 'bill.vendor', op: 'in', value: [] }] }, /at least one/);
  throws({ aliases: [{ name: 'B', conditions: [{ field: 'B.code', op: 'eq', value: '' }] }] }, /B · Observation type \(code\) needs a value/);
  assert.throws(() => R._compile({ dateFrom: "2025-01-01'", dateTo: '2025-12-31' }, 1, 500), /Bills dated/);
  assert.throws(() => R._compile({ dateFrom: '2026-01-01', dateTo: '2025-12-31' }, 1, 500), /starts after/);
});

if (!quiet) console.log(n + ' compiler tests passed');
