import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const count=()=>page.evaluate(()=>window.__app.doc.active.count);
const cellsOf=()=>page.evaluate(()=>{const o=[];window.__app.doc.active.forEach((x,y,z,c)=>o.push(`${x},${y},${z}`));return o.sort();});
const reset=()=>page.evaluate(()=>{const a=window.__app;a.setDocument(a.doc.constructor.blank(16));const m=a.doc.models[0];m.clear();for(let x=4;x<=6;x++)for(let y=4;y<=6;y++)m.set(x,y,0,5);a.refresh(true);a.editor.tool="select";const cells=[];m.forEach((x,y,z)=>cells.push({x,y,z}));a.editor["setSelection"](0,cells);});
const mod = process.platform==="darwin"?"Meta":"Control";

// KEYBOARD move + undo
await reset(); await page.waitForTimeout(150);
const c0=await count(), cells0=await cellsOf();
await page.keyboard.press("ArrowUp"); await page.waitForTimeout(50);
const cMoved=await count();
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(80);
const cUndo=await count(), cellsUndo=await cellsOf();
ok("kbd: count restored", cUndo===c0, `c0=${c0} moved=${cMoved} undo=${cUndo}`);
ok("kbd: cells restored", JSON.stringify(cellsUndo)===JSON.stringify(cells0), `undoCells=${cellsUndo.length}`);

// GIZMO move + undo (in-bounds)
await reset(); await page.waitForTimeout(120);
const g0=await count(), gcells0=await cellsOf();
await page.evaluate(()=>window.__app.editor.__gizmoTest({ t:[0,3,0] })); // up 3 in three-y
await page.waitForTimeout(50);
const gMoved=await count();
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(80);
const gUndo=await count(), gcellsUndo=await cellsOf();
ok("gizmo: count restored", gUndo===g0, `g0=${g0} moved=${gMoved} undo=${gUndo}`);
ok("gizmo: cells restored", JSON.stringify(gcellsUndo)===JSON.stringify(gcells0), `undoCells=${gcellsUndo.length}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close();
