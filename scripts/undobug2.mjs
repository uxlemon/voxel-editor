import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const count=()=>page.evaluate(()=>window.__app.doc.active.count);
const dims=()=>page.evaluate(()=>{const m=window.__app.doc.active;return [m.sizeX,m.sizeY,m.sizeZ];});
const reset=()=>page.evaluate(()=>{const a=window.__app;a.setDocument(a.doc.constructor.blank(8));const m=a.doc.models[0];m.clear();for(let x=0;x<=1;x++)for(let y=0;y<=1;y++)m.set(x,y,0,5);a.refresh(true);a.editor.tool="select";const cells=[];m.forEach((x,y,z)=>cells.push({x,y,z}));a.editor["setSelection"](0,cells);});
const mod = process.platform==="darwin"?"Meta":"Control";

// OOB keyboard move (ArrowLeft, x0 -> -1) + undo
await reset(); await page.waitForTimeout(150);
const c0=await count(), d0=await dims();
await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(60);
const cM=await count(), dM=await dims();
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(100);
const cU=await count(), dU=await dims();
ok("OOB kbd: count restored", cU===c0, `c0=${c0} moved=${cM} undo=${cU}`);
ok("OOB kbd: dims restored", JSON.stringify(dU)===JSON.stringify(d0), `d0=${d0} moved=${dM} undo=${dU}`);

// OOB gizmo move (+8 three-x beyond size) + undo
await reset(); await page.waitForTimeout(120);
const g0=await count(), gd0=await dims();
await page.evaluate(()=>window.__app.editor.__gizmoTest({ t:[8,0,0] }));
await page.waitForTimeout(60);
const gM=await count(), gdM=await dims();
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(100);
const gU=await count(), gdU=await dims();
ok("OOB gizmo: count restored", gU===g0, `g0=${g0} moved=${gM} undo=${gU}`);
ok("OOB gizmo: dims restored", JSON.stringify(gdU)===JSON.stringify(gd0), `gd0=${gd0} moved=${gdM} undo=${gdU}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close();
