import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const mod = process.platform==="darwin"?"Meta":"Control";
// L-shape so mirror is visually distinguishable; cells x0-2,y0 + x0,y1 (color5)
const setup=()=>page.evaluate(()=>{const a=window.__app;a.setDocument(a.doc.constructor.blank(16));const m=a.doc.models[0];m.clear();m.set(0,0,0,5);m.set(1,0,0,5);m.set(2,0,0,5);m.set(0,1,0,5);a.refresh(true);a.editor.tool="select";const cells=[];m.forEach((x,y,z)=>cells.push({x,y,z}));a.editor["setSelection"](0,cells);});
const cells=()=>page.evaluate(()=>{const o=[];window.__app.doc.active.forEach((x,y,z)=>o.push(`${x},${y},${z}`));return o.sort();});
const count=()=>page.evaluate(()=>window.__app.doc.active.count);

await setup(); await page.waitForTimeout(150);
const c0=await count();
await page.evaluate(()=>window.__app.editor.flipSelection("x"));
await page.waitForTimeout(60);
const cAfter=await count(), cellsAfter=await cells();
// originals (x0-2,y0; x0,y1) preserved (4) + mirror across max x=2: x'=2*2+1-x=5-x -> x0->5,x1->4,x2->3,x0(y1)->5 => mirror cells {3,0,0},{4,0,0},{5,0,0},{5,1,0}
const hasOrig = await page.evaluate(()=>{const m=window.__app.doc.active;return m.has(0,0,0)&&m.has(2,0,0)&&m.has(0,1,0);});
const hasMirror = await page.evaluate(()=>{const m=window.__app.doc.active;return m.has(3,0,0)&&m.has(5,0,0)&&m.has(5,1,0);});
ok("flip X adds mirrored copy, keeps original", cAfter===c0*2 && hasOrig && hasMirror, `count ${c0}->${cAfter} orig=${hasOrig} mirror=${hasMirror}`);
// selection is the mirror
const selIsMirror = await page.evaluate(()=>{const s=window.__app.editor.selectionInfo; return s && s.cells.every(c=>c.x>=3);});
ok("selection is the mirrored copy", selIsMirror);
// undo removes the mirror
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(80);
ok("undo removes mirror copy", await count()===c0, `count->${await count()}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close();
