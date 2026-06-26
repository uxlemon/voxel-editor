import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__app));
await page.evaluate(() => window.__app.loadFromUrl("/samples/chr_knight.vox"));
await page.waitForTimeout(700);
await page.evaluate(() => (window.__app.editor.tool = "select"));

// find a top-exposed occupied cell to click for same-color select
const top = await page.evaluate(() => {
  const m = window.__app.doc.active;
  let best = null;
  m.forEach((x, y, z, c) => {
    if (!m.has(x, y, z + 1) && (!best || z > best.z)) best = { x, y, z, c };
  });
  return best;
});

// SAME-COLOR select
await page.evaluate(() => (window.__app.editor.selectMode = "color"));
const sc = await page.evaluate(([X, Y, Z]) => window.__app.screenForCell(0, X, Y, Z, true), [top.x, top.y, top.z]);
await page.mouse.click(sc.sx, sc.sy);
await page.waitForTimeout(80);
const colorSel = await page.evaluate(() => {
  const s = window.__app.editor.selectionInfo;
  if (!s) return null;
  const m = window.__app.doc.active;
  const colors = new Set(s.cells.map((c) => m.get(c.x, c.y, c.z)));
  return { count: s.cells.length, distinctColors: colors.size };
});

// RECTANGLE select: drag a big rect over the whole model
await page.evaluate(() => { window.__app.editor.clearSelection(); window.__app.editor.selectMode = "rect"; });
await page.mouse.move(450, 250);
await page.mouse.down();
await page.mouse.move(850, 600, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(80);
const rectSel = await page.evaluate(() => window.__app.editor.selectionInfo?.cells.length ?? 0);

console.log("same-color:", JSON.stringify(colorSel));
console.log("rect select count:", rectSel);
console.log("errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(colorSel && colorSel.distinctColors === 1 && colorSel.count > 1 && rectSel > 10 ? 0 : 1);
