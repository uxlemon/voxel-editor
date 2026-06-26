// Verifies multi-model world: add object, round-trip 2 models with placements,
// and layer visibility toggling.
import puppeteer from "puppeteer-core";
const url = process.argv[2] || "http://localhost:5180/";
const out = process.argv[3] || "stage5.png";
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
  const { parseVox, writeVox } = window.__vox;
  await app.loadFromUrl("/samples/chr_knight.vox");
  const models0 = app.doc.models.length;

  // add a second object and fill it with a small cube
  app.addObject();
  const m = app.doc.models[app.doc.activeModel];
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++)
      for (let z = 0; z < 4; z++) m.set(x, y, z, 5);
  app.refresh(false);

  // round-trip the whole document
  const reparsed = parseVox(writeVox(app.doc));

  // visibility: count visible meshes, then hide layer 0
  const visBefore = app.scene.raycastTargets.filter((o) => o.visible).length;
  app.toggleLayerVisibility(app.doc.layers[0].id);
  const visAfterHide = app.scene.raycastTargets.filter((o) => o.visible).length;
  app.toggleLayerVisibility(app.doc.layers[0].id); // restore

  return {
    models0,
    modelsAfterAdd: app.doc.models.length,
    placements: app.doc.placements.length,
    reModels: reparsed.models.length,
    rePlacements: reparsed.placements.length,
    reTranslations: reparsed.placements.map((p) => p.t),
    visBefore,
    visAfterHide,
  };
});

await page.screenshot({ path: out });
console.log("RESULT:", JSON.stringify(result, null, 2));
console.log("ERRORS:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 2 : 0);
