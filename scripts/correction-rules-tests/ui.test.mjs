// Drives the RuleBuilder custom widget in jsdom with a stub `appsmith` object and
// checks that what it sends compiles to the expected SQL. Run through run.sh,
// which copies this file next to its node_modules and sets REPO.
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const REPO = process.env.REPO || assert.fail("set REPO to the repo root");
const HERE = path.dirname(new URL(import.meta.url).pathname);

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node });

const R = require(path.join(REPO, "scripts/correction-rules-tests/compiler.test.js"));   // also runs the compiler tests quietly

const events = [];
let listener = null;
const model = {
  fields: R.fields(), cust: 76013, custName: "UBM Demo",
  values: [
    { field: "code", value: "DEM_USE", n: 40 }, { field: "code", value: "INFO_DEMAND", n: 12 }, { field: "code", value: "USE_USE", n: 300 },
    { field: "code", value: "LATEFEE", n: 3 }, { field: "uom", value: "KWH", n: 900 }, { field: "uom", value: "KW", n: 100 },
    { field: "uom", value: "KVA", n: 5 }, { field: "category", value: "Usage Information", n: 50 },
    { field: "description", value: "Generation (U)", n: 80 }, { field: "description", value: "Generation (UC)", n: 60 },
    ...["ELECTRIC", "NATURALGAS", "WATER", "SEWER", "OIL2", "FIREPROTECTION", "LIGHTING", "SOLARPV", "TELEPHONE", "STORMWATER", "INTERNET"]
      .map((v, i) => ({ field: "utility", value: v, n: 100 - i }))],
  result: null, sqlInfo: null, savedRule: null, running: false
};
globalThis.appsmith = { theme: { colors: { backgroundColor: "#0F172A" } }, model,
  onModelChange: fn => { listener = fn; }, triggerEvent: (name, ctx) => events.push({ name, ctx }) };

const widget = JSON.parse(fs.readFileSync(path.join(REPO, "pages/Correction Rules/widgets/RuleBuilder.json"), "utf8"));
assert.deepStrictEqual(widget.srcDoc, widget.uncompiledSrcDoc, "srcDoc and uncompiledSrcDoc must match");
assert.strictEqual(widget.dynamicHeight, "AUTO_HEIGHT");
const src = widget.srcDoc.js
  .replace('"https://esm.sh/react@18.2.0"', '"react"').replace('"https://esm.sh/react-dom@18.2.0/client"', '"react-dom/client"').replace('"https://esm.sh/htm@3.1.1"', '"htm"');
fs.writeFileSync(path.join(HERE, "w_local.mjs"), src);
const errs = []; const origErr = console.error; console.error = (...a) => errs.push(a.join(" "));
await import(path.join(HERE, "w_local.mjs"));

const W = dom.window;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const btn = (t, root) => [...(root || document).querySelectorAll("button")].find(b => b.textContent.trim().startsWith(t)) || assert.fail("no button " + t);
const card = t => $$(".card").find(c => c.querySelector("h2") && c.querySelector("h2").textContent === t);
const tick = () => new Promise(r => setTimeout(r, 40));
const input = (el, v) => {
  Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new W.Event("input", { bubbles: true }));
};
const push = p => { Object.assign(model, p); listener && listener(); };
async function choose(sel, text, search) {
  sel.querySelector(".sel-btn").click(); await tick();
  const pop = sel.querySelector(".pop"); assert(pop, "dropdown opened");
  if (search != null) { input(pop.querySelector("input"), search); await tick(); }
  const row = [...sel.querySelectorAll(".pop-row")].find(r => r.textContent.trim().startsWith(text)) ||
    assert.fail("no option " + text + " in [" + [...sel.querySelectorAll(".pop-row")].map(r => r.textContent).join("|") + "]");
  row.dispatchEvent(new W.MouseEvent("mousedown", { bubbles: true })); await tick();
}
const rowSels = row => [...row.querySelectorAll(":scope > .sel, :scope > .val > .sel")];
const summary = () => $(".summary").textContent.replace(/^In plain words/, "");
// wait for the first render (and its effects) rather than a fixed delay
for (let i = 0; i < 100 && !($("h1") && document.documentElement.getAttribute("data-scheme")); i++) await tick();
let n = 0; const ok = name => { n++; console.log("ok", name); };

assert.strictEqual(document.documentElement.getAttribute("data-scheme"), "dark");
assert.strictEqual($$("select").length, 0); assert.strictEqual($$("datalist").length, 0);
ok("renders with theme colour scheme, no native selects");

// 1. custom: "field 1 = field 2 and field 3 > 500" and the summary that reads it back
btn("+ Add condition", card("Bill conditions")).click(); await tick();
await choose(rowSels(card("Bill conditions").querySelector(".row"))[0], "Total of line charges", "total");
btn("value", card("Bill conditions")).click(); await tick();
await choose(rowSels(card("Bill conditions").querySelector(".row"))[2], "Number of lines");
btn("+ Add condition", card("Bill conditions")).click(); await tick();
let rows = card("Bill conditions").querySelectorAll(".row");
await choose(rowSels(rows[1])[0], "Total of line charges", "total");
rows = card("Bill conditions").querySelectorAll(".row");
await choose(rowSels(rows[1])[1], "greater than");
input(card("Bill conditions").querySelectorAll(".row")[1].querySelector("input"), "500"); await tick();
assert(summary().includes("where total of line charges is equal to number of lines and total of line charges greater than 500"), summary());
btn("Run query").click(); await tick();
let ev = events.pop(); assert(ev.name === "onRun" && ev.ctx.rule.key === "custom");
assert(R._compile(ev.ctx.rule, 76013, 500).sql.includes("WHERE (bl.total_charges = bl.line_count AND bl.total_charges > 500)"));
ok("custom field = field and > 500, with summary");

// 2. searchable value list with typed values; utility from the list
btn("Clear all").click(); await tick();
btn("+ Add condition", card("Bill conditions")).click(); await tick();
await choose(rowSels(card("Bill conditions").querySelector(".row"))[0], "Utility", "util");
const valSel = rowSels(card("Bill conditions").querySelector(".row"))[2];
valSel.querySelector(".sel-btn").click(); await tick();
input(valSel.querySelector(".pop input"), "gas"); await tick();
assert.deepStrictEqual([...valSel.querySelectorAll(".pop-row")].map(r => r.firstChild.textContent), ["Use “gas”", "NATURALGAS"]);
[...valSel.querySelectorAll(".pop-row")][1].dispatchEvent(new W.MouseEvent("mousedown", { bubbles: true })); await tick();
assert(rowSels(card("Bill conditions").querySelector(".row"))[2].textContent.includes("NATURALGAS"));
ok("searchable value list");

// 3. groups add/remove; empty rows skipped
btn("+ Add condition", card("Bill conditions")).click(); await tick();
btn("+ Add group", card("Bill conditions")).click(); await tick();
await choose($(".group .group-head .sel"), "ANY");
btn("+ Add condition", $(".group")).click(); await tick();
let grows = $(".group").querySelectorAll(".row");
await choose(rowSels(grows[0])[0], "Total of line charges", "total");
await choose(rowSels($(".group").querySelectorAll(".row")[0])[1], "greater than");
input($(".group .row input"), "500"); await tick();
btn("+ Add group", $(".group")).click(); await tick();
assert($$(".group").length === 2);
btn("Remove group", $$(".group")[1]).click(); await tick();
assert($$(".group").length === 1);
btn("Run query").click(); await tick();
ev = events.pop();
assert(R._compile(ev.ctx.rule, 76013, 500).sql.includes("WHERE (bl.utility = 'NATURALGAS' AND bl.total_charges > 500)"));
btn("Remove group", $(".group")).click(); await tick();
assert($$(".group").length === 0);
ok("groups add/remove, empty rows skipped");

// 4. observation with its own group, description picked from the list, typed change value
btn("+ Add observation").click(); await tick();
const alias = () => $(".alias");
await choose(rowSels(alias().querySelector(".row"))[2], "DEM_USE");
btn("+ Add group", alias()).click(); await tick();
const agRow = alias().querySelector(".group .row");
assert(rowSels(agRow)[0].textContent.includes("A · Observation type"));
await choose(rowSels(agRow)[0], "A · Description", "descr");
await choose(rowSels(alias().querySelector(".group .row"))[2], "Generation (UC)");
btn("+ Add change").click(); await tick();
const chgVal = card("Changes to make").querySelector(".chg .val .sel");
chgVal.querySelector(".sel-btn").click(); await tick();
input(chgVal.querySelector(".pop input"), "KW"); await tick();
chgVal.querySelector(".pop input").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await tick();
assert(card("Changes to make").querySelector(".chg .val .sel").textContent.includes("KW") &&
  !card("Changes to make").querySelector(".chg .val .sel").textContent.includes("KWH"), "exact typed match wins");
assert(summary().includes("with a line A where observation type is equal to DEM_USE and description is equal to Generation (UC); then set A's unit of measure to KW"), summary());
btn("Run query").click(); await tick();
ev = events.pop();
const b2 = R._compile(ev.ctx.rule, 76013, 500);
assert(b2.obs.A.includes("WHERE bl.utility = 'NATURALGAS'\n  AND (o_a.code = 'DEM_USE' AND o_a.description = 'Generation (UC)')"), b2.obs.A);
btn("Remove A").click(); await tick();
assert(!$(".alias") && !card("Changes to make"));
ok("observation group, description list, typed change, summary");

// 5. every rule in the list loads, highlights, sets the title, and compiles
const nav = t => $$(".nav-i").find(a => a.textContent === t) || assert.fail("no rule " + t);
assert.deepStrictEqual($$(".nav-i").map(a => a.textContent), ["Missing consumption", "Duplicate generation", "Constellation adjustment",
  "Peak usage mapping", "Duplicate demand", "Demand units", "Custom rule"]);
const runRule = async name => { nav(name).click(); await tick(); btn("Run query").click(); await tick(); const e = events.pop(); assert(e.name === "onRun"); return e.ctx.rule; };

let r = await runRule("Missing consumption");
assert($(".nav-i.on").textContent === "Missing consumption" && $("h1").textContent === "Recover missing consumption");
let b = R._compile(r, 76013, 500);
assert(b.sql.includes("o_a.code = 'BILLEDUSE_USE')") && b.sql.includes("o_b.code = 'USE_USE')") && b.obs.A.includes("NOT EXISTS"), b.sql);
assert(summary().includes("with a line A where observation type is equal to BILLEDUSE_USE, with no line B where observation type is equal to USE_USE; then set A's observation type to USE_USE"), summary());

r = await runRule("Duplicate generation");
b = R._compile(r, 76013, 500);
assert(b.sql.includes("(o_a.code = 'GEN_USE' AND o_a.description = 'Generation (U)')") && b.sql.includes("(o_b.code = 'GEN_USE' AND o_b.description = 'Generation (UC)')") && b.sql.includes("o_a.usage = o_b.usage"), b.sql);
assert(r.changes[0].action === "remove" && r.changes[0].target === "A" && card("Changes to make").textContent.includes("Keeps observation B."));

r = await runRule("Constellation adjustment");
b = R._compile(r, 76013, 500);
assert(b.sql.includes("bl.vendor::text ILIKE '%Constellation%'") && b.sql.includes("o_a.usage <> o_b.usage") && b.targets.join() === "B", b.sql);
assert(b.obs.B.includes("GROUP BY li.bill_id) bl"), "vendor condition needs per-bill totals");

r = await runRule("Peak usage mapping");
b = R._compile(r, 76013, 500);
assert(b.targets.join() === "A,B" && b.obs.A.includes("o_a.code = 'USE_ONPEAK'") && b.obs.B.includes("o_b.code = 'USE_OFFPEAK'"));
assert(!b.obs.A.includes("GROUP BY") && !b.obs.B.includes("GROUP BY"), "no bill fields: line lists skip the per-bill totals");
push({ result: { key: "peak", rows: [{ bill_id: 9, total_matches: 1 }], total: 1, targets: ["A", "B"], ms: 900,
  obs: { A: { rows: [{ bill_id: 9, code: "USE_ONPEAK", uom: "KWH", total_matches: 1 }], total: 1 },
         B: { rows: [{ bill_id: 9, code: "USE_OFFPEAK", uom: "KWH", total_matches: 1 }], total: 1 } } } });
await tick();
assert(btn("Observations A · 1") && btn("Observations B · 1") && btn("Bills · 1"));
assert($(".tbl .new").textContent === "BILLEDUSE_ONPEAK");
btn("Observations B · 1").click(); await tick();
assert($(".tbl .new").textContent === "BILLEDUSE_OFFPEAK");

r = await runRule("Duplicate demand");
assert(!$(".tbl"), "another rule's results are hidden");
assert(r.changes[0].action === "remove" && r.changes[0].target === "");
assert(card("Changes to make").textContent.includes("Choose which observation each change applies to."));
await choose(card("Changes to make").querySelectorAll(".chg .sel")[1], "Observation B");
assert(card("Changes to make").textContent.includes("Keeps observation A.") && summary().includes("then remove B"), summary());
push({ result: { key: "dupdem", rows: [{ bill_id: 3, total_matches: 1 }], total: 1, targets: ["B"], ms: 500,
  obs: { B: { rows: [{ bill_id: 3, code: "INFO_DEMAND", uom: "KW", total_matches: 1 }], total: 1 } } } });
await tick();
assert($(".tbl .gone").textContent === "Remove");

r = await runRule("Demand units");
assert($$(".alias .sel-txt").some(x => x.textContent === "26 selected"));
assert(summary().includes("with a line A where observation type is any of 26 values and unit of measure is equal to KWH; then set A's unit of measure to KW."), summary());
push({ result: { key: "demand", rows: [{ bill_id: 1, total_matches: 1 }], total: 1, targets: ["A"], ms: 800,
  obs: { A: { rows: [{ bill_id: 1, code: "DEM_USE", uom: "KWH", usage: 5, charge: 0, description: "d", total_matches: 1 }], total: 1 } } } });
await tick();
assert($$(".tbl th").map(x => x.textContent).includes("New UOM") && $(".tbl .new").textContent === "KW");

nav("Custom rule").click(); await tick();
assert($("h1").textContent === "Find bills" && !$(".alias"));
push({ result: { key: "custom", rows: [{ bill_id: 1, total_charges: -23.66, total_matches: 1 }], total: 1, targets: [], ms: 800 } }); await tick();
assert($(".tbl").textContent.includes("-$23.66") && !$(".tbl").textContent.includes("US$"));
ok("all six rules + custom");

// 6. Show SQL lists each line query; running shows elapsed time
push({ sqlInfo: { sql: "SELECT 1", obs: { A: "SELECT 2", B: "SELECT 3" }, error: "" } });
btn("Show SQL").click(); await tick();
assert(events.pop().name === "onPreview");
assert($("pre.sql").textContent.includes("-- Matching observations A\nSELECT 2") && $("pre.sql").textContent.includes("-- Matching observations B\nSELECT 3"));
push({ running: true }); await tick();
assert(document.body.textContent.includes("Searching bills… 0s"));
ok("show SQL and running state");

const bad = errs.filter(e => !/not wrapped in act/.test(e));
assert(bad.length === 0, bad.join("\n"));
console.error = origErr;
console.log(n + " UI tests passed");
process.exit(0);
