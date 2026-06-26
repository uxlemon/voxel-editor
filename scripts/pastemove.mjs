import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const count=()=>page.evaluate(()=>window.__app.doc.active.count);
const reset=()=>page.evaluate(()=>{ const a=window.__app; a.setDocument(a.doc.constructor.blank(20)); const m=a.doc.models[0]; m.clear(); for(let x=4;x<=6;x++)for(let y=4;y<=6;y++)m.set(x,y,0,5); a.refresh(true); a.editor.tool="select"; });
const mod = process.platform==="darwin"?"Meta":"Control";

// keyboard: copy, paste, move +3 (arrows) -> two copies (18)
await reset(); await page.waitForTimeout(150);
await page.keyboard.press(`${mod}+a`); await page.waitForTimeout(40);
await page.keyboard.press(`${mod}+c`); await page.waitForTimeout(40);
await page.keyboard.press(`${mod}+v`); await page.waitForTimeout(40);
for(let i=0;i<3;i++){ await page.keyboard.press("ArrowUp"); await page.waitForTimeout(25); }
ok("keyboard: paste+move leaves two copies", await count()===18, `count=${await count()}`);
// originals still at y4-6?
const origStays = await page.evaluate(()=>{ const m=window.__app.doc.active; let n=0; for(let x=4;x<=6;x++)for(let y=4;y<=6;y++) if(m.has(x,y,0)) n++; return n; });
ok("keyboard: original copy stayed", origStays===9, `orig=${origStays}`);

// gizmo: copy, paste, gizmo translate +5 three-x -> two copies
await reset(); await page.waitForTimeout(120);
await page.keyboard.press(`${mod}+a`); await page.waitForTimeout(40);
await page.keyboard.press(`${mod}+c`); await page.waitForTimeout(40);
await page.keyboard.press(`${mod}+v`); await page.waitForTimeout(40);
await page.evaluate(()=>window.__app.editor.__gizmoTest({ t:[5,0,0] }));
await page.waitForTimeout(40);
ok("gizmo: paste+move leaves two copies", await count()===18, `count=${await count()}`);
const origStays2 = await page.evaluate(()=>{ const m=window.__app.doc.active; let n=0; for(let x=4;x<=6;x++)for(let y=4;y<=6;y++) if(m.has(x,y,0)) n++; return n; });
ok("gizmo: original copy stayed", origStays2===9, `orig=${origStays2}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close(); process.exit(Object.values(r).every(x=>x.p)?0:1);
