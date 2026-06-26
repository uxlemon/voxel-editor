import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error"&&!/favicon|404/.test(m.text()))errs.push(m.text());});
await page.goto("http://localhost:5180/", { waitUntil:"networkidle" });
await page.waitForFunction(()=>Boolean(window.__app));
const r={}; const ok=(n,p,d="")=>{r[n]={p:!!p,d};};
const sel=()=>page.evaluate(()=>window.__app.editor.selectionInfo?.cells.length ?? 0);
const count=()=>page.evaluate(()=>window.__app.doc.active.count);
const reset=()=>page.evaluate(()=>{ const a=window.__app; a.setDocument(a.doc.constructor.blank(16)); const m=a.doc.models[0]; m.clear(); for(let x=4;x<=6;x++)for(let y=4;y<=6;y++)m.set(x,y,0,5); a.refresh(true); a.editor.tool="select"; });
const mod = process.platform === "darwin" ? "Meta" : "Control";

await reset(); await page.waitForTimeout(150);
await page.keyboard.press(`${mod}+a`); await page.waitForTimeout(50);
ok("Cmd+A selects all", await sel() === 9, `${await sel()}`);
await page.keyboard.press(`${mod}+c`); await page.waitForTimeout(50);
ok("Cmd+C copies", (await page.evaluate(()=>window.__app.editor["clipboard"]?.length ?? 0)) === 9);
for (let i=0;i<3;i++){ await page.keyboard.press("ArrowUp"); await page.waitForTimeout(30); }
const afterMove = await count();
await page.keyboard.press(`${mod}+v`); await page.waitForTimeout(60);
const afterPaste = await count();
ok("Cmd+V pastes at original position", afterPaste === 18, `move=${afterMove} paste=${afterPaste}`);
await page.keyboard.press(`${mod}+d`); await page.waitForTimeout(40);
ok("Cmd+D deselects", await sel() === 0, `${await sel()}`);

// undo restores selection position after a move
await reset(); await page.waitForTimeout(100);
await page.keyboard.press(`${mod}+a`); await page.waitForTimeout(40);
await page.keyboard.press("ArrowUp"); await page.waitForTimeout(40); // y4-6 -> y5-7
const movedMinY = await page.evaluate(()=>Math.min(...window.__app.editor.selectionInfo.cells.map(c=>c.y)));
await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(60); // undo
const undoMinY = await page.evaluate(()=>{ const s=window.__app.editor.selectionInfo; return s? Math.min(...s.cells.map(c=>c.y)) : -1; });
ok("undo restores selection position", movedMinY===5 && undoMinY===4, `moved=${movedMinY} undo=${undoMinY}`);

ok("no errors", errs.length===0, errs.join("|"));
console.log(JSON.stringify(r,null,1));
await b.close(); process.exit(Object.values(r).every(x=>x.p)?0:1);
