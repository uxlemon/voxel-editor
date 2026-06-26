import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error"&&!/favicon|404/.test(m.text()))errs.push(m.text());});
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const dims=()=>page.evaluate(()=>{const m=window.__app.doc.active;return [m.sizeX,m.sizeY,m.sizeZ];});
const count=()=>page.evaluate(()=>window.__app.doc.active.count);
const reset=()=>page.evaluate(()=>{const a=window.__app;a.setDocument(a.doc.constructor.blank(8));const m=a.doc.models[0];m.clear();for(let x=0;x<=1;x++)for(let y=0;y<=1;y++)m.set(x,y,0,5);a.refresh(true);a.editor.tool="select";const cells=[];m.forEach((x,y,z)=>cells.push({x,y,z}));a.editor["setSelection"](0,cells);});
const mod = process.platform==="darwin"?"Meta":"Control";

// keyboard move into negative x -> grow (shift)
await reset(); await page.waitForTimeout(150);
const c0=await count(), d0=await dims();
await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(60); // dx=-1, x0 -> -1 OOB
const d1=await dims(), c1=await count();
ok("kbd move OOB grows volume", d1[0] > d0[0] && c1===c0, `dims ${d0}->${d1} count ${c0}->${c1}`);
// undo restores size
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(60);
const d2=await dims(), c2=await count();
ok("undo restores volume size", d2[0]===d0[0] && c2===c0, `dims->${d2} count->${c2}`);

// gizmo move +x beyond bounds -> grow (positive)
await reset(); await page.waitForTimeout(120);
const gd0=await dims(), gc0=await count();
await page.evaluate(()=>window.__app.editor.__gizmoTest({ t:[8,0,0] }));
await page.waitForTimeout(60);
const gd1=await dims(), gc1=await count();
ok("gizmo move OOB grows volume", gd1[0] > gd0[0] && gc1===gc0, `dims ${gd0}->${gd1} count ${gc0}->${gc1}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close(); process.exit(Object.values(r).every(x=>x.p)?0:1);
