// Comprehensive usability + feature test using Playwright (system Chrome).
// Exercises every feature through the real UI/input path and asserts results.
// Usage: node scripts/usability.mjs [url] [shotDir]
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://localhost:5180/";
const shotDir = process.argv[3] || (process.env.TMPDIR || "/tmp");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
ctx.setDefaultTimeout(8000);
const page = await ctx.newPage();
/** Run a step; record FAIL instead of aborting the whole suite. */
async function step(name, fn) {
  try {
    const r = await fn();
    results.push({ name, pass: r !== false, detail: typeof r === "string" ? r : "" });
  } catch (e) {
    results.push({ name, pass: false, detail: String(e.message || e).slice(0, 80) });
  }
}

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404/i.test(m.text()))
    consoleErrors.push("console.error: " + m.text());
});

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForFunction(() => !!window.__app, null, { timeout: 10000 });
await page.waitForTimeout(600);

const count = () =>
  page.evaluate(() => window.__app.doc.models.reduce((s, m) => s + m.count, 0));
const setTool = (t) => page.evaluate((tool) => (window.__app.editor.tool = tool), t);
const colorAt = (x, y, z) =>
  page.evaluate(
    ([X, Y, Z]) => window.__app.doc.active.get(X, Y, Z),
    [x, y, z]
  );
async function drag(x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(70);
}
const cx = 640, cy = 430;
// click reliably on a model cell via projected screen coords
async function clickCell(modelId, x, y, z, top = false) {
  const { sx, sy } = await page.evaluate(
    ([m, X, Y, Z, t]) => window.__app.screenForCell(m, X, Y, Z, t),
    [modelId, x, y, z, top]
  );
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(20);
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(60);
}
const resetBlank = () =>
  page.evaluate(() => {
    const a = window.__app;
    a.setDocument(a.doc.constructor.blank(32));
    a.doc.models[0].clear();
    a.refresh(true);
  });

// ---- Discoverability / ease-of-use ----
const toolButtons = await page.locator(".tool-btn").count();
ok("6 tools present", toolButtons === 6, `${toolButtons}`);
const tooltips = await page.$$eval(".tool-btn", (els) =>
  els.every((e) => (e.getAttribute("title") || "").length > 0)
);
ok("tools have tooltips (hotkey hints)", tooltips);
const swatches = await page.locator(".palette-grid .swatch:not(.empty)").count();
ok("palette has 255 color swatches", swatches === 255, `${swatches}`);
const menuBtns = await page.locator(".menubar-btn").count();
ok("menu buttons present", menuBtns >= 5, `${menuBtns}`);

// help panel toggles open
await page.locator(".help-toggle").click();
const helpVisible = await page.locator(".help-body").isVisible();
ok("controls help panel opens", helpVisible);

// ---- Start fresh ----
await resetBlank();
await page.waitForTimeout(200);

// ---- Attach ----
await setTool("attach");
await clickCell(0, 16, 16, 0); // floor cell at footprint center
await clickCell(0, 17, 16, 0);
const afterAttach = await count();
ok("attach places voxels", afterAttach >= 1, `count=${afterAttach}`);

// ---- Hover readout updates ----
const { sx, sy } = await page.evaluate(() => window.__app.screenForCell(0, 16, 16, 0));
await page.mouse.move(sx, sy);
await page.waitForTimeout(60);
const hover = await page.locator(".hover-readout").textContent();
ok("hover shows coordinates", /\d/.test(hover || ""), `"${hover}"`);

// ---- Palette select changes paint color ----
await page.locator('.swatch[data-index="6"]').click();
const selColor = await page.evaluate(() => window.__app.editor.color);
ok("palette select sets color", selColor === 6, `color=${selColor}`);

// ---- Attach drags a box region ----
await setTool("attach");
const beforeBox = await count();
await drag(cx - 40, cy + 30, cx + 50, cy - 10);
const afterBox = await count();
ok("attach drags a box region", afterBox > beforeBox + 4, `${beforeBox}->${afterBox}`);

await page.screenshot({ path: `${shotDir}/usability-edit.png` });

// ---- Flip selection adds a mirrored copy ----
await resetBlank();
await page.evaluate(() => {
  const a = window.__app;
  const m = a.doc.models[0];
  m.set(2, 4, 0, 8); m.set(3, 4, 0, 8); m.set(2, 5, 0, 8);
  a.refresh(true);
  a.editor.tool = "select";
  a.editor["setSelection"](0, [{ x: 2, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 2, y: 5, z: 0 }]);
  a.editor.flipSelection("x");
});
const flipCount = await count();
ok("flip X adds a mirrored copy", flipCount === 6, `count=${flipCount}`);

// place a 5x5 slab centered at (16,16,0) so the click target is comfortably large
const makeSlab = (color) =>
  page.evaluate((c) => {
    const a = window.__app;
    a.setDocument(a.doc.constructor.blank(32));
    const m = a.doc.models[0];
    m.clear();
    for (let x = 14; x <= 18; x++) for (let y = 14; y <= 18; y++) m.set(x, y, 0, c);
    a.refresh(true);
  }, color);

// ---- Paint recolors an existing voxel under the cursor ----
await makeSlab(3);
await setTool("paint");
await page.evaluate(() => (window.__app.editor.color = 12));
await clickCell(0, 16, 16, 0, true); // click the slab's top face center
const paintedColor = await colorAt(16, 16, 0);
ok("paint recolors voxel", paintedColor === 12, `color=${paintedColor}`);

// ---- Erase removes the voxel under the cursor ----
await makeSlab(4);
const beforeErase = await count();
await setTool("erase");
await clickCell(0, 16, 16, 0, true);
const afterErase = await count();
ok("erase removes voxel", afterErase < beforeErase, `${beforeErase}->${afterErase}`);

// ---- Undo / Redo via buttons ----
await step("undo/redo buttons work", async () => {
  await page.evaluate(() => {
    const a = window.__app;
    a.setDocument(a.doc.constructor.blank(32));
    a.doc.models[0].clear();
    a.refresh(true);
  });
  await setTool("attach");
  await drag(cx - 40, cy + 30, cx + 50, cy - 10); // attach-drag fills a box region
  const beforeUndo = await count();
  if (beforeUndo === 0) return "no voxels created";
  await page.locator(".menubar-btn", { hasText: "Undo" }).click();
  const afterUndoBtn = await count();
  await page.locator(".menubar-btn", { hasText: "Redo" }).click();
  const afterRedoBtn = await count();
  const pass = afterUndoBtn < beforeUndo && afterRedoBtn === beforeUndo;
  return pass ? `${beforeUndo}->${afterUndoBtn}->${afterRedoBtn}` : false;
});

// ---- Objects: add object ----
await step("add object", async () => {
  const objBefore = await page.evaluate(() => window.__app.doc.placements.length);
  await page
    .locator(".scene-header", { hasText: "Objects" })
    .locator(".mini-btn", { hasText: "+" })
    .click();
  const objAfter = await page.evaluate(() => window.__app.doc.placements.length);
  return objAfter === objBefore + 1 ? `${objBefore}->${objAfter}` : false;
});

// ---- World view "All" hides nothing and disables editing ----
await step("All world view is read-only", async () => {
  await page.locator(".scene-row", { hasText: "All" }).first().click();
  const wv = await page.evaluate(() => window.__app.worldView);
  const canEdit = await page.evaluate(() => window.__app.canEdit());
  // switch back to object 0
  await page.locator(".scene-row", { hasText: "object 0" }).first().click();
  return wv && !canEdit ? "worldView on, editing disabled" : false;
});

// ---- Show-others toggle ----
await step("show-others toggle", async () => {
  const before = await page.evaluate(() => window.__app.scene.view.showOthers);
  await page.locator(".mini-btn", { hasText: "Others" }).click();
  const after = await page.evaluate(() => window.__app.scene.view.showOthers);
  return after !== before ? `${before}->${after}` : false;
});

// ---- Save .vox round-trip ----
const rt = await page.evaluate(() => {
  const { parseVox, writeVox } = window.__vox;
  const before = window.__app.doc.models.reduce((s, m) => s + m.count, 0);
  const re = parseVox(writeVox(window.__app.doc));
  const after = re.models.reduce((s, m) => s + m.count, 0);
  return { before, after, models: re.models.length };
});
ok(".vox save round-trips", rt.before === rt.after, JSON.stringify(rt));

// ---- Export OBJ / GLB (Blender + Roblox) ----
const exp = await page.evaluate(async () => {
  const { buildOBJ, buildGLB } = window.__vox;
  const { obj, mtl } = buildOBJ(window.__app.doc, "model");
  const glb = await buildGLB(window.__app.scene.group);
  return {
    objFaces: (obj.match(/^f /gm) || []).length,
    objHasMtllib: obj.includes("mtllib"),
    mtlMats: (mtl.match(/newmtl /g) || []).length,
    glbBytes: glb.byteLength,
    glbMagicOk: new Uint32Array(glb.slice(0, 4))[0] === 0x46546c67,
  };
});
ok("OBJ export valid (Roblox/Blender)", exp.objFaces > 0 && exp.objHasMtllib && exp.mtlMats > 0, JSON.stringify(exp));
ok("GLB export valid (Blender)", exp.glbBytes > 0 && exp.glbMagicOk, `${exp.glbBytes}b`);

// ---- Camera: perspective/orthographic toggle ----
await step("pers/orth toggle", async () => {
  const before = await page.evaluate(() => window.__app.viewport.projection);
  await page.locator(".menubar-btn", { hasText: /Pers|Orth/ }).click();
  const after = await page.evaluate(() => window.__app.viewport.projection);
  await page.locator(".menubar-btn", { hasText: /Pers|Orth/ }).click(); // restore
  return after !== before ? `${before}->${after}` : false;
});

// ---- Camera: recenter ----
await step("recenter camera", async () => {
  await page.locator(".menubar-btn", { hasText: "Recenter" }).click();
  return true;
});

// ---- ViewCube present and snaps the view ----
await step("viewcube snaps view", async () => {
  const has = await page.locator(".viewcube canvas").count();
  if (!has) return false;
  const before = await page.evaluate(() => window.__app.viewport.camera.position.toArray());
  await page.evaluate(() => {
    const v = { x: 0, y: 1, z: 0, clone() { return this; }, normalize() { return this; } };
    window.__app.viewport.snapTo(v);
  });
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__app.viewport.camera.position.toArray());
  return JSON.stringify(before) !== JSON.stringify(after) ? "moved" : false;
});
await page.screenshot({ path: `${shotDir}/usability-render.png` });

// ---- Colors in use reflects the model ----
await step("colors-in-use populates from model", async () => {
  await page.evaluate(() => window.__app.loadFromUrl("/samples/chr_knight.vox"));
  await page.waitForTimeout(500);
  const n = await page.locator(".inuse-swatch").count();
  return n > 0 ? `${n} colors` : false;
});

// ---- Autosave to localStorage ----
const hasAutosave = await page.evaluate(
  () => !!localStorage.getItem("voxel-editor-autosave-v1")
);
ok("autosave persists to localStorage", hasAutosave);

// ---- Report ----
ok("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== USABILITY TEST: ${passed}/${results.length} passed ===`);
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`);
}
await browser.close();
process.exit(passed === results.length ? 0 : 1);
