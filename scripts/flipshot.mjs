import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = process.env.TMPDIR || "/tmp";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
await page.evaluate(()=>window.__app.loadFromUrl("/samples/chr_knight.vox"));
await page.waitForTimeout(600);
await page.evaluate(()=>{ const a=window.__app; a.editor.tool="select"; const cells=[]; a.doc.active.forEach((x,y,z)=>{ if(x<10) cells.push({x,y,z}); }); a.editor["setSelection"](0,cells); });
// click the Select tool button so toolbar rows show
await page.locator(".tool-btn", { hasText: "Select" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${dir}/flip-ui.png` });
const flipBtns = await page.locator(".tool-row", { hasText: "Flip" }).locator(".mini-btn").count();
console.log("flip buttons:", flipBtns);
await b.close();
