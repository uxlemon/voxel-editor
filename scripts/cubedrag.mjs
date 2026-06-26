import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__app));
await page.waitForTimeout(400);

const pos = () => page.evaluate(() => window.__app.viewport.camera.position.toArray().map((n) => +n.toFixed(2)));
const box = await page.locator(".viewcube canvas").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

const before = await pos();
// drag across the cube
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 40, cy + 10, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(60);
const afterDrag = await pos();

// click (no drag) on the cube to snap
await page.mouse.click(cx, cy);
await page.waitForTimeout(60);
const afterClick = await pos();

const dragMoved = JSON.stringify(before) !== JSON.stringify(afterDrag);
const clickMoved = JSON.stringify(afterDrag) !== JSON.stringify(afterClick);
console.log("before:", JSON.stringify(before));
console.log("afterDrag:", JSON.stringify(afterDrag), "-> orbit moved:", dragMoved);
console.log("afterClick:", JSON.stringify(afterClick), "-> snap moved:", clickMoved);
await browser.close();
process.exit(dragMoved ? 0 : 1);
