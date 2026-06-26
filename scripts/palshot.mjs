import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = process.env.TMPDIR || "/tmp";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__app));
await page.evaluate(() => window.__app.loadFromUrl("/samples/chr_knight.vox"));
await page.waitForTimeout(900);
const inUse = await page.evaluate(() => document.querySelectorAll(".inuse-swatch").length);
console.log("colors in use:", inUse);
// crop to the palette panel for a clear view
const panel = await page.$(".palette-panel");
await panel.screenshot({ path: `${dir}/palette.png` });
await page.screenshot({ path: `${dir}/palette-full.png` });
await browser.close();
