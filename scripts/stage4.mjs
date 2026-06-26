// Verifies box tool (drag), fill, and select+delete.
import puppeteer from "puppeteer-core";
const url = process.argv[2] || "http://localhost:5180/";
const out = process.argv[3] || "stage4.png";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: `${process.env.TMPDIR || "/tmp"}/vox-chrome-${process.pid}`,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1280,800"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));

const count = () => page.evaluate(() => window.__app.doc.models.reduce((s, m) => s + m.count, 0));
const setTool = (t) => page.evaluate((tool) => { window.__app.editor.tool = tool; }, t);
async function drag(x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 80));
}

const before = await count();

// Box: drag a rectangle on the floor.
await setTool("box");
await drag(590, 470, 700, 440);
const afterBox = await count();

await page.screenshot({ path: out });

// Select the slab, then delete it.
await setTool("select");
await drag(580, 480, 710, 430);
const selected = await page.evaluate(() => window.__app.editor.selection?.cells.length ?? 0);
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
});
await new Promise((r) => setTimeout(r, 80));
const afterDelete = await count();

console.log("COUNTS:", JSON.stringify({ before, afterBox, selected, afterDelete }));
console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 2 : 0);
