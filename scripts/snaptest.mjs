import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
// 1) snapshot/restore in isolation
const snap = await page.evaluate(()=>{
  const a=window.__app; a.setDocument(a.doc.constructor.blank(8)); const m=a.doc.models[0];
  for(let x=0;x<=1;x++)for(let y=0;y<=1;y++)m.set(x,y,0,5);
  const s=m.snapshot(); const dataLen=s.data.length;
  m.clear();
  const afterClear=m.count;
  m.restore(s);
  return { dataLen, afterClear, afterRestore:m.count };
});
// 2) OOB gizmo move; inspect history + counts via two undos
const flow = await page.evaluate(()=>{
  const a=window.__app; a.setDocument(a.doc.constructor.blank(8)); const m=a.doc.models[0]; m.clear();
  for(let x=0;x<=1;x++)for(let y=0;y<=1;y++)m.set(x,y,0,5);
  a.refresh(true); a.editor.tool="select"; const cells=[]; m.forEach((x,y,z)=>cells.push({x,y,z})); a.editor["setSelection"](0,cells);
  const c0=a.doc.active.count;
  a.editor.__gizmoTest({ t:[8,0,0] });
  const cMoved=a.doc.active.count;
  // peek history depth via undo returning truthy
  const u1 = a.history.undo(); const c1=a.doc.active.count;
  const u2 = a.history.undo(); const c2=a.doc.active.count;
  return { c0, cMoved, undo1:!!u1, c1, undo2:!!u2, c2 };
});
console.log("snapshot/restore:", JSON.stringify(snap));
console.log("oob flow:", JSON.stringify(flow));
console.log("errors:", errs.length?errs.join("|"):"none");
await b.close();
