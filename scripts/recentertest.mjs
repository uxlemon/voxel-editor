import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r = await page.evaluate(()=>{
  const a=window.__app;
  a.setDocument(a.doc.constructor.blank(16));
  a.doc.models[0].set(8,8,0,5);
  a.addObject();
  a.refresh(true);
  // recenter while editing object 0 should target object-0 center, not world center
  a.setActiveObject(0);
  a.recenterCamera();
  const t0 = a.viewport.controls.target.toArray().map(n=>+n.toFixed(1));
  const p0 = a.doc.placements.find(pl=>pl.modelId===0), m0=a.doc.models[0];
  const mp0 = a.scene.meshFor(p0).position;
  const c0 = [mp0.x+m0.sizeX/2, mp0.y+m0.sizeZ/2, mp0.z+m0.sizeY/2].map(n=>+n.toFixed(1));
  // switch to object 1, recenter -> different target
  a.setActiveObject(1);
  a.recenterCamera();
  const t1 = a.viewport.controls.target.toArray().map(n=>+n.toFixed(1));
  return { t0, c0, t1, matches0: JSON.stringify(t0)===JSON.stringify(c0), differ: JSON.stringify(t0)!==JSON.stringify(t1) };
});
console.log(JSON.stringify(r));
await b.close();
process.exit(r.matches0 && r.differ ? 0 : 1);
