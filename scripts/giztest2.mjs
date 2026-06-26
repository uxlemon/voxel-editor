import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = process.env.TMPDIR || "/tmp";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
// build a block and select it (gizmo shows)
await page.evaluate(()=>{ const a=window.__app; a.setDocument(a.doc.constructor.blank(16)); const m=a.doc.models[0]; for(let x=6;x<=9;x++)for(let y=6;y<=9;y++)for(let z=0;z<=3;z++)m.set(x,y,z,5); a.refresh(true); a.editor.tool="select"; const cells=[]; m.forEach((x,y,z)=>cells.push({x,y,z})); a.editor["setSelection"](0,cells); a.recenterCamera(); });
await page.waitForTimeout(300);

// 1) plane handles hidden
const planes = await page.evaluate(()=>{
  const g = window.__app.editor["gizmoHelper"]; const out=[];
  g.traverse(o=>{ if(["XY","YZ","XZ"].includes(o.name)) out.push(o.visible); });
  return out;
});
const planesHidden = planes.length>0 && planes.every(v=>v===false);

// 2) placeholders suppressed when hovering a gizmo handle (simulate axis hover)
const sc = await page.evaluate(()=>window.__app.screenForCell(0,7,9,3,true));
await page.evaluate(()=>{ window.__app.editor["gizmo"].axis = "X"; }); // simulate hover
await page.mouse.move(sc.sx, sc.sy);
await page.waitForTimeout(60);
const overGiz = await page.evaluate(()=>{ const e=window.__app.editor; return { ghost:e["regionBox"].visible, face:e["faceQuad"].visible, wire:e["cursor"].visible, cur: document.querySelector("canvas").style.cursor }; });
await page.evaluate(()=>{ window.__app.editor["gizmo"].axis = null; });

await page.screenshot({ path: `${dir}/gizmo-arrows.png` });
console.log("planeVisibilities:", JSON.stringify(planes), "-> hidden:", planesHidden);
console.log("overGizmo placeholders:", JSON.stringify(overGiz));
console.log("errors:", errs.length?errs.join("|"):"none");
await b.close();
process.exit(planesHidden && !overGiz.ghost && !overGiz.face && !overGiz.wire ? 0 : 1);
