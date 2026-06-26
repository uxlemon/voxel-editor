import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5173/";
const OUT = "/tmp/claude";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: `/tmp/claude/cp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  args: ["--no-sandbox", "--window-size=1280,860"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3800)); // let the loading reel settle
console.log("cookie on boot (should be false):", !!(await page.$(".cookie-overlay")));

await page.screenshot({ path: `${OUT}/01-home.png` });
const home = await page.evaluate(() => ({
  tiles: document.querySelectorAll(".tile").length,
  gridCols: getComputedStyle(document.querySelector(".gallery-grid")).gridTemplateColumns.split(" ").length,
  actions: document.querySelectorAll(".preview-actions .preview-btn").length,
  current: document.querySelectorAll(".tile.current").length,
}));
console.log("home:", home);

// click a gallery tile to preview it
const tiles = await page.$$(".tile");
if (tiles[2]) {
  await page.$eval('.tile:nth-child(3)', (el) => el.click());
  await new Promise((r) => setTimeout(r, 600));
}
await page.screenshot({ path: `${OUT}/02-preview.png` });
const curAfter = await page.$$eval(".tile.current", (els) => els.length);
console.log("current tiles after click:", curAfter);

// Remix → enter editor
await page.$eval(".preview-btn", (el) => el.click()); // first = Remix
await new Promise((r) => setTimeout(r, 700));
const modeEdit = await page.$eval("#app", (e) => e.className);
console.log("mode after Remix:", modeEdit);
const listHiddenInEdit = await page.$eval("#gallery-mount", (e) => getComputedStyle(e).display);
console.log("gallery display in edit:", listHiddenInEdit);

// make a real edit and check the save pill
await page.keyboard.press("b");
const bx = await (await page.$("#viewport")).boundingBox();
await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
await page.mouse.down();
await page.mouse.move(bx.x + bx.width / 2 + 30, bx.y + bx.height / 2 + 20, { steps: 10 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
const pill = await page
  .$eval(".save-pill", (e) => `${getComputedStyle(e).display} | ${e.className} | ${e.textContent.trim()}`)
  .catch(() => "no pill");
console.log("pill:", pill);
const diag = await page.evaluate(() => ({
  canUndo: window.__app.history.canUndo(),
  tool: window.__app.editor.tool,
  vox: window.__app.doc.models.reduce((s, m) => s + m.count, 0),
}));
console.log("diag:", diag);

// reliable edit via screenForCell, then re-check the pill
const cell = await page.evaluate(() => {
  const a = window.__app;
  const m = a.doc.active;
  return a.screenForCell(a.doc.activeModel, 1, 1, m.sizeZ - 1, true);
});
await page.mouse.click(cell.sx, cell.sy);
await new Promise((r) => setTimeout(r, 400));
const pill2 = await page
  .$eval(".save-pill", (e) => `${getComputedStyle(e).display} | rect=${JSON.stringify(e.getBoundingClientRect())} | ${e.textContent.trim()}`)
  .catch(() => "no pill");
console.log("pill2:", pill2);
await page.screenshot({ path: `${OUT}/03-editor.png` });

// Keep-it popup should be a full-size card, not a gray sliver
await page.$eval(".save-pill .pill-btn.primary", (el) => el.click());
await new Promise((r) => setTimeout(r, 300));
const popup = await page.evaluate(() => {
  const ov = document.querySelector(".popup-overlay");
  const card = document.querySelector(".popup-card");
  const r = card ? card.getBoundingClientRect() : { width: 0, height: 0 };
  return { overlayVisible: !!ov && getComputedStyle(ov).display !== "none", cardW: Math.round(r.width), cardH: Math.round(r.height) };
});
console.log("popup:", popup);
await page.screenshot({ path: `${OUT}/06-popup.png` });
await page.$eval(".popup-actions .pill-btn:last-child", (el) => el.click()); // Nah → close

// Share view from the editor
await page.$eval(".share-btn", (el) => el.click());
await new Promise((r) => setTimeout(r, 400));
const share = await page.evaluate(() => {
  const sv = document.querySelector(".share-view");
  const url = document.querySelector(".share-input[readonly]")?.value || "";
  return { visible: !!sv && !sv.classList.contains("hidden"), url };
});
console.log("share:", share);
await page.screenshot({ path: `${OUT}/05-share.png` });
await page.$eval(".share-card .icon-btn", (el) => el.click()); // close

// Back to preview
await page.$eval(".back-btn", (el) => el.click());
await new Promise((r) => setTimeout(r, 600));
console.log("mode after Back:", await page.$eval("#app", (e) => e.className));

// Create → empty editor
await page.$eval(".preview-actions .preview-btn:nth-child(2)", (el) => el.click());
await new Promise((r) => setTimeout(r, 600));
const voxCount = await page.evaluate(() =>
  window.__app.doc.models.reduce((s, m) => s + m.count, 0)
);
console.log("voxels after Create (expect 0):", voxCount);
await page.screenshot({ path: `${OUT}/04-create.png` });

console.log("console errors:", errors.slice(0, 10));
await browser.close();
