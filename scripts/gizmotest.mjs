import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__app));
await page.waitForTimeout(300);

const results = [];
const ok = (n, p, d = "") => results.push({ n, p: !!p, d });

// helper: make a known 2x2x1 block of color 5 at (4..5, 4..5, 0), select it
const setup = () => page.evaluate(() => {
  const a = window.__app;
  a.setDocument(a.doc.constructor.blank(32));
  const m = a.doc.models[0];
  m.clear();
  for (let x = 4; x <= 5; x++) for (let y = 4; y <= 5; y++) m.set(x, y, 0, 5);
  a.refresh(true);
  a.editor.tool = "select";
  // select the block directly
  a.editor.setSelection ? null : null;
});
const selectBlock = () => page.evaluate(() => {
  const a = window.__app, cells = [];
  for (let x = 4; x <= 5; x++) for (let y = 4; y <= 5; y++) cells.push({ x, y, z: 0 });
  // use the private setter via the select pipeline: stash through a same-color pick is unreliable; set directly
  a.editor["selection"] = { modelId: 0, cells };
  a.editor.attachObjectGizmo; // noop ref
});
const occupied = () => page.evaluate(() => {
  const out = [];
  window.__app.doc.active.forEach((x, y, z, c) => out.push([x, y, z, c]));
  return out.sort();
});

// gizmo helper appears on real selection
await setup();
await page.evaluate(() => {
  const a = window.__app;
  const cells = [];
  for (let x = 4; x <= 5; x++) for (let y = 4; y <= 5; y++) cells.push({ x, y, z: 0 });
  a.editor["setSelection"](0, cells);
});
ok("all 3 gizmos visible on selection", await page.evaluate(() => {
  const gz = window.__app.editor["gizmos"];
  return Array.isArray(gz) && gz.length === 3 && gz.every((g) => g.helper.visible && g.tc.enabled);
}));

// MOVE: translate up (three +y) by 3 -> model z += 3
await page.evaluate(() => window.__app.editor.__gizmoTest({ t: [0, 3, 0] }));
const afterMove = await occupied();
ok("move: 4 voxels at z=3", afterMove.length === 4 && afterMove.every((v) => v[2] === 3), JSON.stringify(afterMove.map((v) => v[2])));

// ROTATE 90° about up axis: still 4 voxels, color preserved, z unchanged
await setup();
await page.evaluate(() => {
  const cells = [];
  for (let x = 4; x <= 5; x++) for (let y = 4; y <= 5; y++) cells.push({ x, y, z: 0 });
  window.__app.editor["setSelection"](0, cells);
});
await page.evaluate(() => window.__app.editor.__gizmoTest({ rotAxis: "y" }));
const afterRot = await occupied();
ok("rotate: 4 voxels preserved, color 5", afterRot.length === 4 && afterRot.every((v) => v[3] === 5), JSON.stringify({ n: afterRot.length }));

// SCALE x2: 4 voxels -> 32 (each becomes 2x2x2)
await setup();
await page.evaluate(() => {
  const cells = [];
  for (let x = 4; x <= 5; x++) for (let y = 4; y <= 5; y++) cells.push({ x, y, z: 0 });
  window.__app.editor["setSelection"](0, cells);
});
await page.evaluate(() => window.__app.editor.__gizmoTest({ scale: 2 }));
const afterScale = await occupied();
ok("scale x2: 4 -> 32 voxels", afterScale.length === 32, `${afterScale.length}`);

// OBJECT move in world view
await page.evaluate(() => {
  const a = window.__app;
  a.setDocument(a.doc.constructor.blank(16));
  a.doc.models[0].set(8, 8, 0, 5);
  a.addObject(); // 2 objects
  a.setWorldView();
});
const objMoved = await page.evaluate(() => {
  const a = window.__app;
  const p = a.doc.placements[0];
  const t0 = [...p.t];
  a.editor.attachObjectGizmo(p);
  a.editor["beginObjectSession"]();
  a.editor["proxy"].position.x += 5; // three +x = voxel +x
  a.editor["applyObjectLive"]();
  a.editor["commitObjectSession"]();
  return { t0, t1: [...p.t] };
});
ok("object move: placement x +5", objMoved.t1[0] === objMoved.t0[0] + 5, JSON.stringify(objMoved));

console.log(`\n=== GIZMO TEST: ${results.filter(r => r.p).length}/${results.length} ===`);
for (const r of results) console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.d ? "  [" + r.d + "]" : ""}`);
if (errors.length) console.log("ERRORS:", errors.join("\n"));
await browser.close();
process.exit(results.every(r => r.p) && !errors.length ? 0 : 1);
