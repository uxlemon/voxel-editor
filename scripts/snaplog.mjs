import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
page.on("console",m=>console.log("[c]",m.type(),m.text()));
page.on("pageerror",e=>console.log("[err]",e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const info = await page.evaluate(()=>{
  const a=window.__app; a.setDocument(a.doc.constructor.blank(8)); const m=a.doc.models[0]; m.clear();
  for(let x=0;x<=1;x++)for(let y=0;y<=1;y++)m.set(x,y,0,5);
  a.refresh(true); a.editor.tool="select"; const cells=[]; m.forEach((x,y,z)=>cells.push({x,y,z})); a.editor["setSelection"](0,cells);
  a.editor.__gizmoTest({ t:[8,0,0] });
  return { size:[m.sizeX,m.sizeY,m.sizeZ], count:m.count };
});
await page.waitForTimeout(150);
console.log("after move:", JSON.stringify(info));
await b.close();
