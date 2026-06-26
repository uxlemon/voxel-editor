// Generate a 1200x630 Open Graph share image (brand banner) → public/og-image.png
import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;font-family:"Inter","Segoe UI",system-ui,sans-serif;
    background:#eef0f4;
    background-image:radial-gradient(#d3d8e2 1.6px, transparent 1.6px);
    background-size:26px 26px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px}
  .smile{position:relative;width:150px;height:150px;border:13px solid rgba(0,0,0,.9);border-radius:100em}
  .smile .eye{position:absolute;width:15px;height:15px;background:rgba(0,0,0,.9);top:38px;border-radius:3px}
  .smile .eye.l{left:26px}.smile .eye.r{right:26px}
  .smile .mouth{position:absolute;width:68px;height:44px;bottom:14px;left:16px;
    border:13px solid rgba(0,0,0,.9);border-top:none;
    border-bottom-right-radius:50px;border-bottom-left-radius:50px}
  h1{font-size:96px;font-weight:800;letter-spacing:-.04em;color:#1b1f24}
  p{font-size:34px;font-weight:500;color:#5b6170}
  .row{display:flex;gap:16px;margin-top:6px}
  .cube{width:46px;height:46px;border-radius:9px;box-shadow:0 4px 10px rgba(20,23,33,.14)}
</style></head><body>
  <div class="smile"><span class="eye l"></span><span class="eye r"></span><span class="mouth"></span></div>
  <h1>Voxel Play</h1>
  <p>Build &amp; share voxel art in your browser — no login</p>
  <div class="row">
    <span class="cube" style="background:#e2483d"></span>
    <span class="cube" style="background:#f5a623"></span>
    <span class="cube" style="background:#5fbf5a"></span>
    <span class="cube" style="background:#46c7e8"></span>
    <span class="cube" style="background:#6c63e0"></span>
    <span class="cube" style="background:#e85aa0"></span>
  </div>
</body></html>`;
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir:`${process.env.TMPDIR}/vox-og-${process.pid}`, args:["--no-sandbox","--force-device-scale-factor=1"] });
const p = await b.newPage();
await p.setViewport({ width:1200, height:630, deviceScaleFactor:1 });
await p.setContent(html, { waitUntil:"networkidle0" });
await p.screenshot({ path:"public/og-image.png", clip:{ x:0, y:0, width:1200, height:630 } });
console.log("wrote public/og-image.png");
await b.close();
