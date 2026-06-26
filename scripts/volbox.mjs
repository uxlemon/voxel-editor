// Verifies the editable volume box + MagicaVoxel-style plane-locked drawing.
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = process.env.TMPDIR || "/tmp";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__app));
await page.waitForTimeout(400);

const results = [];
const ok = (n, p, d = "") => results.push({ n, p: !!p, d });

// fresh 16^3 volume
await page.evaluate(() => {
  const a = window.__app;
  a.setDocument(a.doc.constructor.blank(16));
  a.doc.models[0].clear();
  a.editor.mirror = { x: false, y: false, z: false };
  a.refresh(true);
});
await page.waitForTimeout(400);

// 3 of 6 box faces should be visible (floor + two far walls)
const visFaces = await page.evaluate(() => window.__app.scene.volumeBox.pickTargets.length);
ok("3 box faces visible (floor + far walls)", visFaces === 3, `${visFaces}`);

await page.screenshot({ path: `${dir}/volbox.png` });

// plane-lock: drag attach across the floor -> all voxels stay at z=0
async function drag(p0, p1) {
  await page.mouse.move(p0.sx, p0.sy);
  await page.mouse.down();
  await page.mouse.move((p0.sx + p1.sx) / 2, p0.sy - 40, { steps: 6 }); // wander upward mid-drag
  await page.mouse.move(p1.sx, p1.sy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
await page.evaluate(() => (window.__app.editor.tool = "attach"));
const a = await page.evaluate(() => window.__app.screenForCell(0, 3, 8, 0));
const b = await page.evaluate(() => window.__app.screenForCell(0, 12, 8, 0));
await drag(a, b);
const zs = await page.evaluate(() => {
  const set = new Set();
  let count = 0;
  window.__app.doc.models[0].forEach((x, y, z) => { set.add(z); count++; });
  return { zVals: [...set], count };
});
ok("plane-lock keeps drag flat on floor (all z=0)", zs.zVals.length === 1 && zs.zVals[0] === 0 && zs.count >= 2, JSON.stringify(zs));

// resize volume to 24 x 8 x 32
await page.evaluate(() => window.__app.resizeActiveVolume(24, 8, 32));
await page.waitForTimeout(200);
const size = await page.evaluate(() => {
  const m = window.__app.doc.active;
  return [m.sizeX, m.sizeY, m.sizeZ];
});
ok("resize volume per axis", size[0] === 24 && size[1] === 8 && size[2] === 32, JSON.stringify(size));

console.log(`\n=== VOLUME BOX TEST: ${results.filter(r => r.p).length}/${results.length} ===`);
for (const r of results) console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.d ? "  [" + r.d + "]" : ""}`);
ok("no console errors", errors.length === 0, errors.join(" | "));
if (errors.length) console.log("ERRORS:", errors.join("\n"));
await browser.close();
process.exit(results.every(r => r.p) ? 0 : 1);
