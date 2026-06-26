// Drives the editor with real mouse input to verify the place/erase/undo path.
// Usage: node scripts/interact.mjs <url> <outPng>
import puppeteer from "puppeteer-core";

const url = process.argv[2] || "http://localhost:5180/";
const out = process.argv[3] || "interact.png";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: `${process.env.TMPDIR || "/tmp"}/vox-chrome-${process.pid}`,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--window-size=1280,800",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});

await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

const count = () =>
  page.evaluate(() =>
    window.__app.doc.models.reduce((s, m) => s + m.count, 0)
  );

const before = await count();

// Place several voxels by clicking across the viewport center area.
const cx = 640,
  cy = 430;
for (const [dx, dy] of [
  [0, 0],
  [18, 0],
  [-18, 0],
  [0, 18],
  [0, -18],
  [18, 18],
]) {
  await page.mouse.click(cx + dx, cy + dy);
  await new Promise((r) => setTimeout(r, 60));
}
const afterPlace = await count();

await page.screenshot({ path: out });

// Undo once, check count decreased.
await page.evaluate(() => window.__app.history.undo());
await new Promise((r) => setTimeout(r, 50));
const afterUndo = await page.evaluate(() =>
  window.__app.doc.models.reduce((s, m) => s + m.count, 0)
);
// Redo, check it comes back.
await page.evaluate(() => window.__app.history.redo());
const afterRedo = await page.evaluate(() =>
  window.__app.doc.models.reduce((s, m) => s + m.count, 0)
);

console.log(
  "COUNTS:",
  JSON.stringify({ before, afterPlace, afterUndo, afterRedo })
);
console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 2 : 0);
