import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = process.env.TMPDIR || "/tmp";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
await page.evaluate(()=>window.__app.loadFromUrl("/samples/chr_knight.vox"));
await page.waitForTimeout(700);
const top = await page.evaluate(()=>{ const m=window.__app.doc.active; let best=null; m.forEach((x,y,z,c)=>{ if(!m.has(x,y,z+1)&&(!best||z>best.z)) best={x,y,z}; }); return best; });
const sc = await page.evaluate(([X,Y,Z])=>window.__app.screenForCell(0,X,Y,Z,true),[top.x,top.y,top.z]);

async function probe(tool, mode){
  await page.evaluate(([t,m])=>{ const e=window.__app.editor; e.tool=t; if(m) e.selectMode=m; }, [tool, mode]);
  await page.mouse.move(sc.sx+1, sc.sy+1); await page.mouse.move(sc.sx, sc.sy); // trigger move
  await page.waitForTimeout(60);
  return page.evaluate(()=>{ const e=window.__app.editor; const c=document.querySelector("canvas");
    return { cur: c.style.cursor,
      ghost: e["regionBox"].visible, face: e["faceQuad"].visible, wire: e["cursor"].visible, outline: e["regionOutline"].visible };
  });
}
const r = {};
r.attach = await probe("attach");
r.paint = await probe("paint");
r.fill = await probe("fill");
r.pick = await probe("eyedropper");
r.erase = await probe("erase");
r.selBox = await probe("select","box");
await page.screenshot({ path: `${dir}/cursor-selbox.png` });
r.selRect = await probe("select","rect");
r.selColor = await probe("select","color");
await probe("attach"); await page.screenshot({ path: `${dir}/cursor-attach.png` });
await probe("paint"); await page.screenshot({ path: `${dir}/cursor-paint.png` });
console.log(JSON.stringify(r,null,1));
console.log("errors:", errs.length?errs.join("|"):"none");
await b.close();
