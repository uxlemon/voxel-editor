import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const sc=(x,y,z,top=false)=>page.evaluate(([X,Y,Z,T])=>window.__app.screenForCell(0,X,Y,Z,T),[x,y,z,top]);
// fresh 16^3, attach tool, mirror X on, place a voxel off-center on the floor
await page.evaluate(()=>{ const a=window.__app; a.setDocument(a.doc.constructor.blank(16)); a.doc.models[0].clear(); a.refresh(true); a.editor.tool="attach"; a.editor.mirror={x:true,y:false,z:false}; a.editor.color=5; });
await page.waitForTimeout(200);
const p = await sc(4,8,0,false); // floor cell x=4
await page.mouse.click(p.sx,p.sy); await page.waitForTimeout(80);
const cells = await page.evaluate(()=>{const o=[];window.__app.doc.active.forEach((x,y,z)=>o.push([x,y,z]));return o;});
// expect a voxel at x=4 and mirror at x=11 (16-1-4) same y,z
console.log("cells:", JSON.stringify(cells), "errors:", errs.length?errs.join("|"):"none");
await b.close();
