// Headless browser check: loads a URL, captures console errors + page errors,
// waits for the app to settle, and writes a screenshot.
// Usage: node scripts/shot.mjs <url> <outPng> [waitMs]
import puppeteer from "puppeteer-core";

const url = process.argv[2] || "http://localhost:5180/";
const out = process.argv[3] || "shot.png";
const waitMs = parseInt(process.argv[4] || "1500", 10);

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profileDir = `${process.env.TMPDIR || "/tmp"}/vox-chrome-${process.pid}`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: profileDir,
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
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) =>
  errors.push("requestfailed: " + r.url() + " " + r.failure()?.errorText)
);

await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, waitMs));

await page.screenshot({ path: out });

// Report whether a WebGL canvas exists and has non-trivial drawing buffer.
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return { canvas: true, w: c.width, h: c.height, gl: !!gl };
});

console.log("CANVAS:", JSON.stringify(canvasInfo));

// Report the app's round-trip self-test if present.
const roundTrip = await page.evaluate(() => window.__roundTrip ?? null);
if (roundTrip) console.log("ROUNDTRIP:", JSON.stringify(roundTrip, null, 2));

console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 2 : 0);
