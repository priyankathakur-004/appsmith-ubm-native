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
// wait for the first render (and its effects) rather than a fixed delay
for (let i = 0; i < 100 && !($("h1") && document.documentElement.getAttribute("data-scheme")); i++) await tick();
let n = 0; const ok = name => { n++; console.log("ok", name); };

assert.strictEqual(document.documentElement.getAttribute("data-scheme"), "dark");
assert.strictEqual($$("select").length, 0); assert.strictEqual($$("datalist").length, 0);
assert(!$(".summary") && !document.body.textContent.includes("In plain words"), "no plain-words line");
ok("renders with theme colour scheme, no native selects");

// 1. custom: "field 1 = field 2 and field 3 > 500"
btn("+ Add condition", card("Conditions")).click(); await tick();
await choose(rowSels(card("Conditions").querySelector(".row"))[0], "Total of line charges", "total");
btn("value", card("Conditions")).click(); await tick();
await choose(rowSels(card("Conditions").querySelector(".row"))[2], "Number of lines");
btn("+ Add condition", card("Conditions")).click(); await tick();
let rows = card("Conditions").querySelectorAll(".row");
await choose(rowSels(rows[1])[0], "Total of line charges", "total");
rows = card("Conditions").querySelectorAll(".row");
await choose(rowSels(rows[1])[1], "greater than");
input(card("Conditions").querySelectorAll(".row")[1].querySelector("input"), "500"); await tick();
btn("Run query").click(); await tick();
let ev = events.pop(); assert(ev.name === "onRun" && ev.ctx.rule.key === "custom");
assert(R._compile(ev.ctx.rule, 76013, 500).sql.includes("WHERE (bl.total_charges = bl.line_count AND bl.total_charges > 500)"));
ok("custom field = field and > 500");

// 2. searchable value list with typed values; utility from the list
btn("Clear all").click(); await tick();
btn("+ Add condition", card("Conditions")).click(); await tick();
await choose(rowSels(card("Conditions").querySelector(".row"))[0], "Utility", "util");
const valSel = rowSels(card("Conditions").querySelector(".row"))[2];
valSel.querySelector(".sel-btn").click(); await tick();
input(valSel.querySelector(".pop input"), "gas"); await tick();
assert.deepStrictEqual([...valSel.querySelectorAll(".pop-row")].map(r => r.firstChild.textContent), ["Use “gas”", "NATURALGAS"]);
[...valSel.querySelectorAll(".pop-row")][1].dispatchEvent(new W.MouseEvent("mousedown", { bubbles: true })); await tick();
assert(rowSels(card("Conditions").querySelector(".row"))[2].textContent.includes("NATURALGAS"));
ok("searchable value list");

// 3. groups add/remove (Advanced); empty rows skipped
assert(!$(".adv input").checked && !$(".adv input").disabled, "custom starts in Basic");
assert(!card("Lines on the same bill") && !card("Compare lines") && card("Then"));
$(".adv input").click(); await tick();
assert(card("Bill conditions") && card("Lines on the same bill") && !card("Conditions"));
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
btn("+ Add line").click(); await tick();
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
btn("Run query").click(); await tick();
ev = events.pop();
const b2 = R._compile(ev.ctx.rule, 76013, 500);
assert(b2.obs.A.includes("WHERE bl.utility = 'NATURALGAS'\n  AND (o_a.code = 'DEM_USE' AND o_a.description = 'Generation (UC)')"), b2.obs.A);
btn("Remove A").click(); await tick();
assert(!$(".alias") && !card("Changes to make"));
ok("observation group, description list, typed change");

// 4b. Basic: a line field joins the line list; "Then" changes that line
$$(".nav-i").find(a => a.textContent === "Custom rule").click(); await tick();
assert(!$(".adv input").checked, "blank custom rule is Basic");
assert(card("Then").textContent.includes("Add a line condition above"));
btn("+ Add condition", card("Conditions")).click(); await tick();
await choose(rowSels(card("Conditions").querySelector(".row"))[0], "Line · Unit of measure", "unit");
await choose(rowSels(card("Conditions").querySelector(".row"))[2], "KWH");
btn("+ Add condition", card("Conditions")).click(); await tick();
await choose(rowSels(card("Conditions").querySelectorAll(".row")[1])[0], "Utility", "util");
await choose(rowSels(card("Conditions").querySelectorAll(".row")[1])[2], "ELECTRIC");
// rows stay in the order they were added
assert(rowSels(card("Conditions").querySelectorAll(".row")[0])[0].textContent.includes("Line · Unit of measure"));
assert(rowSels(card("Conditions").querySelectorAll(".row")[1])[0].textContent.includes("Utility"));
btn("+ Add change", card("Then")).click(); await tick();
await choose(card("Then").querySelector(".chg-basic .val .sel"), "KW", "kw");
btn("Run query").click(); await tick();
ev = events.pop();
let bb = R._compile(ev.ctx.rule, 76013, 500);
assert(bb.sql.includes("WHERE bl.utility = 'ELECTRIC'") && bb.sql.includes("o_a.bill_id = bl.bill_id AND o_a.uom = 'KWH')"), bb.sql);
assert.deepStrictEqual(ev.ctx.rule.changes.map(c => c.target + ":" + c.field + ":" + c.value), ["A:uom:KW"]);
push({ result: { key: "custom", rows: [{ bill_id: 5, total_matches: 1 }], total: 1, targets: ["A"], ms: 700,
  obs: { A: { rows: [{ bill_id: 5, code: "DEM_USE", uom: "KWH", total_matches: 1 }], total: 1 } } } });
await tick();
assert(btn("Matching lines · 1") && $(".tbl .new").textContent === "KW");
// removing the only line condition removes the change too
card("Conditions").querySelectorAll(".row")[0].querySelector(".x").click(); await tick();
assert(card("Then").textContent.includes("Add a line condition above"));
btn("Run query").click(); await tick();
ev = events.pop();
assert.deepStrictEqual([ev.ctx.rule.aliases.length, ev.ctx.rule.changes.length], [0, 0]);
ok("basic: bill + line conditions in one list, Then change");

// 5. the mockup rule pages: layout, the rules they send, and how results show
const nav = t => $$(".nav-i").find(a => a.textContent === t) || assert.fail("no rule " + t);
assert.deepStrictEqual($$(".nav-i").map(a => a.textContent), ["Missing consumption", "Duplicate generation", "Constellation adjustment",
  "Peak usage mapping", "Duplicate demand", "Demand units", "Custom rule"]);
const foot = () => $(".foot .foot-txt").textContent;
const footBtn = () => [...$(".foot").querySelectorAll("button")].pop();
const lastSet = () => { const e = events.pop(); assert(e && e.name === "onRunSet", "expected onRunSet, got " + (e && e.name)); return e.ctx.set; };
const compile = (set, id) => R._compile(set.rules.find(x => x.id === id).rule, 76013, 500);
const line = (bill, extra) => Object.assign({ bill_id: bill, statement_date: "2026-03-01", vendor: "V", code: "X", uom: "KWH", usage: 10, description: "" }, extra);
const lines = rows => ({ rows, total: rows.length, bills: new Set(rows.map(r => r.bill_id)).size });

// Demand units
nav("Demand units").click(); await tick();
assert($("h1").textContent === "Correct demand units" && card("Find matching observations") && !$(".adv"), "demand page, no Advanced switch");
assert(document.body.textContent.includes("Selected observation types (26)"));
assert.strictEqual([...$(".checks").querySelectorAll("input")].filter(x => x.checked).length, 26);
[...$(".checks").querySelectorAll(".chk")].find(l => l.textContent === "REACT_DEM").querySelector("input").click(); await tick();
assert(document.body.textContent.includes("Selected observation types (25)"));
assert(foot() === "Select a target unit to preview changes." && !footBtn().disabled, "run does not wait for a unit");
assert.deepStrictEqual([...$(".foot").querySelectorAll("button")].map(x => x.textContent), ["Clear all", "Show SQL", "Run query"]);
assert(![...$$("button")].some(x => /Save|Preview changes|Review changes/.test(x.textContent)), "no save or preview buttons");
assert(!card("Find matching observations").querySelector(".btn.primary"), "one Run query, in the footer");
footBtn().click(); await tick();
let set = lastSet();
assert(set.key === "demand" && set.rules[0].id === "demand");
let b = compile(set, "demand");
assert(b.targets.join() === "A" && b.obs.A.includes("o_a.uom = 'KWH'") && !b.obs.A.includes("'REACT_DEM'") && b.obs.A.includes("'DEM_USE'"), b.obs.A);
await choose([...card("Changes to make").querySelectorAll(".sel")].pop(), "KW", "kw");
assert(foot() === "Ready to run." && !footBtn().disabled);
push({ result: { key: "demand", ms: 900, parts: { demand: { lines: { A: lines([line(4001, { code: "DEM_USE" }), line(4002, { code: "INFO_DEMAND" })]) } } } } });
await tick();
assert.deepStrictEqual([...card("Matching observations").querySelectorAll("th")].map(x => x.textContent), ["Bill", "Observation type", "Current UOM", "New UOM"]);
assert.deepStrictEqual([...card("Matching observations").querySelectorAll(".new")].map(x => x.textContent), ["KW", "KW"]);
assert(foot() === "2 observations found");
footBtn().click(); await tick();
assert(lastSet().rules[0].rule.changes[0].value === "KW");
// Show SQL builds the queries without running them
btn("Show SQL", $(".foot")).click(); await tick();
let pe = events.pop(); assert(pe.name === "onPreviewSet" && pe.ctx.set.key === "demand" && pe.ctx.set.rules[0].id === "demand");
push({ sqlInfo: { sql: "", obs: { "demand A": "SELECT 7" }, error: "" } }); await tick();
assert($(".foot-wrap pre.sql").textContent === "-- Matching line A\nSELECT 7");
btn("Hide SQL", $(".foot")).click(); await tick();
assert(!$(".foot-wrap pre.sql"));
// Clear all puts the page back to its defaults and hides its results
btn("Clear all", $(".foot")).click(); await tick();
assert(document.body.textContent.includes("Selected observation types (26)") && !card("Matching observations") && foot() === "Select a target unit to preview changes.");

// Missing consumption
nav("Missing consumption").click(); await tick();
assert($("h1").textContent === "Recover missing consumption" && $$(".step").length === 3);
assert(!card("Matching observations"), "demand results hidden on another page");
const fb = card("Find matching bills");
assert(fb.querySelector(".row").textContent.includes("Consumption line item") && fb.querySelector(".row").textContent.includes("does not exist"));
assert(fb.querySelectorAll(".row")[1].querySelector(".lead").textContent === "AND");
assert(card("Changes to make").textContent.includes("Target: matched BILLEDUSE_USE observations"));
assert($(".step.on").textContent.includes("Define changes"));
footBtn().click(); await tick();
set = lastSet();
b = compile(set, "missing");
assert(b.obs.A.includes("o_a.code = 'BILLEDUSE_USE'") && b.obs.A.includes("NOT EXISTS") && b.obs.A.includes("o_b.code = 'USE_USE'") && b.targets.join() === "A", b.obs.A);
push({ result: { key: "missing", ms: 800, parts: { missing: { lines: { A: lines([line(1001, { code: "BILLEDUSE_USE" }), line(1002, { code: "BILLEDUSE_USE" })]) } } } } });
await tick();
assert($(".step.on").textContent.includes("Review") && foot() === "2 observations found");
const pc = card("Preview changes");
assert.deepStrictEqual([...pc.querySelectorAll(".chip")].map(x => x.textContent), ["BILLEDUSE_USE", "BILLEDUSE_USE"]);
assert.deepStrictEqual([...pc.querySelectorAll(".new")].map(x => x.textContent), ["USE_USE", "USE_USE"]);

// Duplicate generation: pair + two rules, examples from real lines
nav("Duplicate generation").click(); await tick();
assert($("h1").textContent === "Compare generation observations" && card("Find a matching pair"));
assert.strictEqual(card("Find a matching pair").querySelectorAll(".row.pair").length, 2);
assert(card("Rule 1 · Equal values") && card("Rule 2 · Constellation") && !$(".info"), "no review note before a run");
assert(card("Rule 1 · Equal values").textContent.includes("Keep B · Generation (UC)."));
footBtn().click(); await tick();
set = lastSet();
assert.deepStrictEqual(set.rules.map(x => x.id), ["r1", "r2"]);
b = compile(set, "r1");
assert(b.targets.join() === "A,B" && b.obs.A.includes("o_a.description = 'Generation (U)'") && b.obs.A.includes("o_a.usage = o_b.usage"), b.obs.A);
b = compile(set, "r2");
assert(b.obs.B.includes("o_a.vendor::text ILIKE '%Constellation%'") && b.obs.B.includes("o_a.usage <> o_b.usage") && !b.obs.B.includes("GROUP BY"), b.obs.B);
push({ result: { key: "dupgen", ms: 1500, parts: {
  r1: { lines: { A: lines([line(2001, { description: "Generation (U)", usage: 1250 })]), B: lines([line(2001, { description: "Generation (UC)", usage: 1250 })]) } },
  r2: { lines: { A: lines([line(2002, { description: "Generation (U)", usage: 1250 })]), B: lines([line(2002, { description: "Generation (UC)", usage: 75 })]) } } } } });
await tick();
const ex1 = card("Rule 1 · Equal values").querySelector(".example");
assert(ex1.textContent.includes("2001") && ex1.querySelector(".ex-line.struck").textContent.includes("Generation (U)"), ex1.textContent);
assert(ex1.querySelector(".ex-line.after").textContent.includes("Generation (UC)"));
const ex2 = card("Rule 2 · Constellation").querySelector(".example");
assert(ex2.textContent.includes("2002") && ex2.querySelector(".ex-line.after").textContent.includes("Adjustment (UC)") && ex2.querySelector(".ex-line.after").textContent.includes("75"), ex2.textContent);
assert($(".info").textContent.includes("No bill has more than one possible pair."));
push({ result: { key: "dupgen", ms: 1500, parts: {
  r1: { lines: { A: lines([line(2001), line(2001), line(2003)]), B: lines([line(2001)]) } }, r2: { error: "boom" } } } }); await tick();
assert($(".info").textContent.includes("1 bill has more than one possible pair and is flagged for review."), $(".info").textContent);
// a failed run shows its error in the footer and frees the Run button
push({ running: false, result: { key: "dupgen", error: "Query timed out." } }); await tick();
assert($(".foot .err").textContent === "Query timed out." && !footBtn().disabled);
push({ result: { key: "dupgen", loading: true } }); await tick();
assert(foot() === "Searching bills…" && footBtn().disabled);
push({ result: null }); await tick();

// Constellation adjustment: only its rule
nav("Constellation adjustment").click(); await tick();
assert(card("Rule 1 · Constellation") && !card("Rule 1 · Equal values"));
footBtn().click(); await tick();
assert.deepStrictEqual(lastSet().rules.map(x => x.id), ["r2"]);

// Peak usage mapping: Rule 1 ready, Rule 2 needs a choice
nav("Peak usage mapping").click(); await tick();
assert($("h1").textContent === "Update multiple observations");
// an open dropdown on an untouched page survives the model refresh
const nvSel = card("Rule 1 · Correct peak usage").querySelector(".ctbl tbody tr td:nth-child(3) .sel");
nvSel.querySelector(".sel-btn").click(); await tick();
assert(nvSel.querySelector(".pop"), "New value dropdown opens");
push({}); await tick(); await tick();
push({ values: model.values.slice() }); await tick(); await tick();
assert(card("Rule 1 · Correct peak usage").querySelector(".ctbl tbody tr td:nth-child(3) .pop"), "dropdown still open after refresh");
card("Rule 1 · Correct peak usage").querySelector(".ctbl tbody tr td:nth-child(3) .sel-btn").click(); await tick();
const r1c = card("Rule 1 · Correct peak usage"), r2c = card("Rule 2 · Remove duplicate demand");
assert(r1c.querySelector(".badge-st.ok") && r2c.querySelector(".badge-st.need") && foot() === "Only Rule 1 is ready to preview.");
assert(r1c.textContent.includes("A and B must exist on the same bill.") && r2c.textContent.includes("Choose which observation to remove. The other will be retained."));
footBtn().click(); await tick();
set = lastSet();
assert.deepStrictEqual(set.rules.map(x => x.id), ["r1", "r2"]);
assert(compile(set, "r2").targets.join() === "A,B", "rule 2 lists both lines until one is chosen");
b = compile(set, "r1");
assert(b.targets.join() === "A,B" && b.obs.A.includes("o_a.description = 'Use - On Peak (U)'") && b.obs.B.includes("o_b.description = 'Use - Off Peak (U)'"));
r2c.querySelectorAll(".radio input")[1].click(); await tick();
assert(card("Rule 2 · Remove duplicate demand").querySelector(".badge-st.ok") && foot() === "Both rules are ready to preview.");
footBtn().click(); await tick();
set = lastSet();
assert.deepStrictEqual(set.rules.map(x => x.id), ["r1", "r2"]);
b = compile(set, "r2");
assert(b.targets.join() === "B" && b.obs.B.includes("o_b.description = 'Demand - Info (UC)'") && b.obs.B.includes("o_a.description = 'Demand - Billed (U)'"), b.obs.B);
push({ result: { key: "peak", ms: 2000, parts: {
  r1: { lines: { A: lines([line(3001, { description: "Use - On Peak (U)" })]), B: lines([line(3001, { description: "Use - Off Peak (U)" })]) } },
  r2: { lines: { B: lines([line(3005, { description: "Demand - Info (UC)", code: "INFO_DEMAND" })]) } } } } });
await tick();
assert.deepStrictEqual([...card("Rule 1 · Correct peak usage").querySelectorAll(".ptbl .new")].map(x => x.textContent), ["Billed On Peak (U)", "Billed Off Peak (U)"]);
assert(card("Rule 2 · Remove duplicate demand").querySelector(".gone").textContent === "Removed");

// Duplicate demand: its rule alone, preview waits for the choice
nav("Duplicate demand").click(); await tick();
assert($("h1").textContent === "Remove duplicate demand" && card("Rule 1 · Remove duplicate demand") && !card("Rule 1 · Correct peak usage"));

// Custom rule keeps the builder
nav("Custom rule").click(); await tick();
assert($("h1").textContent === "Find bills" && $(".adv") && card("Conditions"));
push({ result: { key: "custom", rows: [{ bill_id: 1, total_charges: -23.66, total_matches: 1 }], total: 1, targets: [], ms: 800 } }); await tick();
assert($(".tbl").textContent.includes("-$23.66") && !$(".tbl").textContent.includes("US$"));
ok("mockup rule pages + custom");

// 6. Show SQL lists each line query; running shows elapsed time
push({ sqlInfo: { sql: "SELECT 1", obs: { A: "SELECT 2", B: "SELECT 3" }, error: "" } });
// (the custom builder's own bar)
btn("Show SQL").click(); await tick();
assert(events.pop().name === "onPreview");
assert($("pre.sql").textContent.includes("-- Matching lines A\nSELECT 2") && $("pre.sql").textContent.includes("-- Matching lines B\nSELECT 3"));
push({ running: true }); await tick();
assert(document.body.textContent.includes("Searching bills… 0s"));
ok("show SQL and running state");

const bad = errs.filter(e => !/not wrapped in act/.test(e));
assert(bad.length === 0, bad.join("\n"));
console.error = origErr;
console.log(n + " UI tests passed");
process.exit(0);
