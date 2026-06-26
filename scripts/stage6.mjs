// Verifies OBJ + GLB export content and render-mode visuals.
import puppeteer from "puppeteer-core";
const url = process.argv[2] || "http://localhost:5180/";
const out = process.argv[3] || "stage6.png";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: `${process.env.TMPDIR || "/tmp"}/vox-chrome-${process.pid}`,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1280,800"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));

const result = await page.evaluate(async () => {
  const app = window.__app;
  const { buildOBJ, buildGLB } = window.__vox;
  await app.loadFromUrl("/samples/chr_knight.vox");

  const { obj, mtl } = buildOBJ(app.doc, "model");
  const glb = await buildGLB(app.scene.group);
  const magic = new Uint32Array(glb.slice(0, 4))[0]; // 0x46546C67 = "glTF"

  // turn on render mode (baked AO + environment)
  app.viewport.setRenderMode(true);
  app.scene.setRenderMode(true);

  return {
    objVerts: (obj.match(/^v /gm) || []).length,
    objFaces: (obj.match(/^f /gm) || []).length,
    objHasMtllib: obj.includes("mtllib"),
    mtlMaterials: (mtl.match(/newmtl /g) || []).length,
    glbBytes: glb.byteLength,
    glbMagicOk: magic === 0x46546c67,
  };
});

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: out });
console.log("RESULT:", JSON.stringify(result, null, 2));
console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 2 : 0);
