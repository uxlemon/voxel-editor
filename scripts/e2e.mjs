// End-to-end smoke + usability test for the voxel creation game.
// Drives the real app in headless Chrome and asserts state via window.__app
// and the DOM. Captures screenshots at key stages. Exit 0 only if all pass.
//
// Usage: node scripts/e2e.mjs [url]
import puppeteer from "puppeteer-core";

const url = process.argv[2] || "http://localhost:5184/";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = `${process.env.TMPDIR || "/tmp"}/vox-e2e-${process.pid}-${Math.floor(Math.random() * 1e6)}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: profileDir,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--window-size=1280,860",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("console: " + m.text());
});

const shot = (f) => page.screenshot({ path: `scripts/e2e-${f}.png` });

try {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000); // loading reel settles

  // ---- A. Boot / home ----
  const boot = await page.evaluate(() => {
    const app = window.__app;
    const c = document.querySelector(".stage canvas");
    const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
    const vc = document.querySelector(".viewcube canvas");
    return {
      mode: app?.mode,
      tiles: document.querySelectorAll(".gallery .tile").length,
      hasCanvas: !!c,
      hasGL: !!gl,
      vcW: vc ? vc.getBoundingClientRect().width : 0,
    };
  });
  check("boot: mode is home", boot.mode === "home", `mode=${boot.mode}`);
  check("boot: gallery seeded (>=3 tiles)", boot.tiles >= 3, `tiles=${boot.tiles}`);
  check("boot: webgl canvas present", boot.hasCanvas && boot.hasGL);
  await shot("home");

  const galleryCountBefore = boot.tiles;

  // ---- B. Create -> gray cube, no template modal ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /create/i.test(x.textContent || ""));
    b && b.click();
  });
  await sleep(700);
  const create = await page.evaluate(() => {
    const app = window.__app;
    const modal = [...document.querySelectorAll(".popup-title, .popup-body")]
      .map((e) => e.textContent || "")
      .join(" ");
    const logo = document.querySelector(".logo-btn");
    return {
      mode: app?.mode,
      count: app?.doc?.active?.count ?? -1,
      templateModal: /template|starting shape/i.test(modal),
      logoSvgs: logo ? logo.querySelectorAll("svg").length : -1,
    };
  });
  check("create: entered edit mode", create.mode === "edit", `mode=${create.mode}`);
  check("create: gray cube loaded (4096 voxels)", create.count === 4096, `count=${create.count}`);
  check("create: no 'start from a template' modal", !create.templateModal);
  check("menu button: chevron only (1 svg, no hamburger)", create.logoSvgs === 1, `svgs=${create.logoSvgs}`);
  const vcW = await page.evaluate(() => {
    const vc = document.querySelector(".viewcube canvas");
    return vc ? vc.getBoundingClientRect().width : 0;
  });
  check("usability: view cube ~144px (1.5x) in editor", vcW >= 130, `w=${Math.round(vcW)}`);
  await shot("create");

  // ---- C. Tools + palette ----
  const clickToolByTitle = (re) =>
    page.evaluate((reSrc) => {
      const rx = new RegExp(reSrc, "i");
      const b = [...document.querySelectorAll(".toolbar .tool-btn")].find((x) => rx.test(x.title || ""));
      if (b) { b.click(); return true; }
      return false;
    }, re.source);

  await clickToolByTitle(/attach/);
  await sleep(250);
  const palAttach = await page.evaluate(() => {
    const p = document.querySelector(".palette-panel");
    return {
      shown: p?.classList.contains("show"),
      title: !!document.querySelector(".palette-panel .panel-title"),
      idxLabel: !!document.querySelector(".palette-panel .palette-label"),
      swatches: document.querySelectorAll(".palette-panel .swatch").length,
      gridPad: p ? getComputedStyle(p.querySelector(".palette-grid")).padding : "",
    };
  });
  check("tool attach: palette shown", palAttach.shown);
  check("palette: 'Palette' title removed", !palAttach.title);
  check("palette: '#17' index label removed", !palAttach.idxLabel);
  check("palette: basic shows ~32 swatches", palAttach.swatches >= 30 && palAttach.swatches <= 40, `n=${palAttach.swatches}`);
  check("usability: palette grid has padding (outline not clipped)", parseFloat(palAttach.gridPad) > 0, `pad=${palAttach.gridPad}`);

  await clickToolByTitle(/select/);
  await sleep(200);
  const palSelect = await page.evaluate(() => document.querySelector(".palette-panel")?.classList.contains("show"));
  check("tool select: palette hidden", !palSelect);

  // ---- K. Usability: black accent + equal button heights ----
  const usab = await page.evaluate(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const back = document.querySelector(".back-btn")?.getBoundingClientRect().height || 0;
    const logo = document.querySelector(".logo-btn")?.getBoundingClientRect().height || 0;
    return { accent, back: Math.round(back), logo: Math.round(logo) };
  });
  // #1b1f24 -> dark; check it's not the old blue (#5b6cff)
  check("usability: accent is black/dark (not blue)", /1b1f24|#1b|27, ?31|rgb\(27/.test(usab.accent) || usab.accent.toLowerCase() === "#1b1f24", `accent=${usab.accent}`);
  check("usability: menu button height == back button height", Math.abs(usab.back - usab.logo) <= 1, `back=${usab.back} logo=${usab.logo}`);

  // ---- D. Advanced toggle ----
  await page.evaluate(() => document.querySelector(".logo-btn")?.click());
  await sleep(150);
  await page.evaluate(() => {
    const adv = [...document.querySelectorAll(".options-menu .menu-item")].find((x) => /advanced/i.test(x.textContent || ""));
    adv && adv.click();
  });
  await sleep(300);
  await clickToolByTitle(/attach/); // reveal palette to count full swatches
  await sleep(250);
  const adv = await page.evaluate(() => {
    const app = window.__app;
    const rd = document.querySelector(".right-dock") || document.querySelector('[class*="right"]');
    const vol = document.querySelector(".volume-panel");
    const scn = document.querySelector(".scene-panel");
    const visible = (el) => el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
    return {
      advanced: app?.advanced,
      volShown: visible(vol),
      scnShown: visible(scn),
      swatches: document.querySelectorAll(".palette-panel .swatch").length,
    };
  });
  check("advanced: flag on", adv.advanced === true);
  check("advanced: Volume panel visible", adv.volShown);
  check("advanced: Objects/scene panel visible", adv.scnShown);
  check("advanced: full palette (>200 swatches)", adv.swatches > 200, `n=${adv.swatches}`);
  await shot("advanced");

  // toggle advanced back off
  await page.evaluate(() => document.querySelector(".logo-btn")?.click());
  await sleep(120);
  await page.evaluate(() => {
    const adv = [...document.querySelectorAll(".options-menu .menu-item")].find((x) => /advanced/i.test(x.textContent || ""));
    adv && adv.click();
  });
  await sleep(250);
  const advOff = await page.evaluate(() => ({
    advanced: window.__app?.advanced,
    swatches: document.querySelectorAll(".palette-panel .swatch").length,
  }));
  check("advanced: toggles back off (basic palette)", advOff.advanced === false && advOff.swatches <= 40, `n=${advOff.swatches}`);

  // ---- E. Edit + undo/redo ----
  const editRes = await page.evaluate(() => {
    const app = window.__app;
    const m = app.doc.active;
    // erase a 3x3x3 corner via a fabricated, reversible command
    const changes = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
      changes.push({ x, y, z, before: m.get(x, y, z) });
    }
    const cmd = {
      label: "test-erase",
      apply() { for (const c of changes) m.set(c.x, c.y, c.z, 0); },
      undo() { for (const c of changes) m.set(c.x, c.y, c.z, c.before); },
    };
    app.history.run(cmd);
    return { afterEdit: m.count };
  });
  check("edit: erased 27 voxels (4096->4069)", editRes.afterEdit === 4069, `count=${editRes.afterEdit}`);

  await page.keyboard.down("Meta"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Meta");
  await sleep(200);
  const afterUndo = await page.evaluate(() => window.__app.doc.active.count);
  check("undo: restores to 4096", afterUndo === 4096, `count=${afterUndo}`);

  await page.keyboard.down("Meta"); await page.keyboard.down("Shift"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Shift"); await page.keyboard.up("Meta");
  await sleep(200);
  const afterRedo = await page.evaluate(() => window.__app.doc.active.count);
  check("redo: re-applies (4069)", afterRedo === 4069, `count=${afterRedo}`);

  // ---- F. Keep-it save flow ----
  // Reset the save manager (clears any pending nudge timer from earlier edits)
  // and lower thresholds so the nudge fires immediately on the next edit.
  await page.evaluate(() => {
    const sm = window.__app.saveManager;
    sm.onBaseline({ suggestedName: "Creation" });
    sm.NUDGE_MS = 30; sm.CHANGE_OPS = 1; sm.CHANGE_RATIO = 0.001;
  });
  await page.evaluate(() => {
    const app = window.__app;
    const m = app.doc.active;
    const c = { x: 5, y: 5, z: 5, before: m.get(5, 5, 5) };
    const cmd = { label: "nudge", apply() { m.set(5, 5, 5, 0); }, undo() { m.set(5, 5, 5, c.before); } };
    app.history.run(cmd);
  });
  await sleep(600);
  const popupShown = await page.evaluate(() => {
    const p = document.querySelector(".popup-overlay");
    return p && !p.classList.contains("hidden");
  });
  check("keep-it: nudge popup appears after threshold", popupShown);
  await shot("popup");

  // invalid name (too long) is rejected
  const invalid = await page.evaluate(() => {
    const inp = document.querySelector(".popup-overlay input");
    inp.value = "x".repeat(60);
    const save = [...document.querySelectorAll(".popup-actions .pill-btn.primary")][0];
    save.click();
    const err = document.querySelector(".popup-error")?.textContent || "";
    const stillOpen = !document.querySelector(".popup-overlay").classList.contains("hidden");
    return { err, stillOpen };
  });
  check("keep-it: over-long name rejected with error", invalid.err.length > 0 && invalid.stillOpen, `err="${invalid.err}"`);

  // valid name saves
  await page.evaluate(() => {
    const inp = document.querySelector(".popup-overlay input");
    inp.value = "TesterBot";
    [...document.querySelectorAll(".popup-actions .pill-btn.primary")][0].click();
  });
  await sleep(1500);
  const saved = await page.evaluate(() => {
    const pill = document.querySelector(".save-pill");
    return {
      pillClass: pill ? pill.className : "",
      tiles: document.querySelectorAll(".gallery .tile").length,
    };
  });
  check("keep-it: pill shows Saved", /saved/.test(saved.pillClass), `pill="${saved.pillClass}"`);
  check("keep-it: new tile prepended to gallery", saved.tiles === galleryCountBefore + 1, `${galleryCountBefore}->${saved.tiles}`);
  await shot("saved");

  // ---- G. View cube click (snap) — real mouse events ----
  const vcErrBefore = pageErrors.length;
  const vcRect = await page.evaluate(() => {
    const c = document.querySelector(".viewcube canvas");
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.35 };
  });
  await page.mouse.click(vcRect.x, vcRect.y);
  await sleep(400);
  check("view cube: click face produces no error", pageErrors.length === vcErrBefore);

  // ---- I. Back to home = read-only preview ----
  await page.evaluate(() => {
    const b = document.querySelector(".back-btn");
    b && b.click();
  });
  await sleep(500);
  const home = await page.evaluate(() => {
    const app = window.__app;
    const before = app.doc.active.count;
    // attempt undo in home mode — must be a no-op (read-only)
    const m = app.doc.active;
    const c = { before: m.get(8, 8, 8) };
    const cmd = { label: "x", apply() { m.set(8, 8, 8, 0); }, undo() { m.set(8, 8, 8, c.before); } };
    app.history.run(cmd); // edits model directly (count drops by 1)
    const afterEdit = m.count;
    app.undo(); // private at TS level; in home mode should early-return (no-op)
    const afterUndo = m.count;
    return { mode: app.mode, interactive: app.editor.interactive, afterEdit, afterUndo };
  });
  check("back: returns to home mode", home.mode === "home", `mode=${home.mode}`);
  check("read-only: editor.interactive is false in home", home.interactive === false);
  check("read-only: undo is a no-op in home/preview", home.afterUndo === home.afterEdit, `${home.afterEdit} vs ${home.afterUndo}`);

  // ---- J. Open from gallery ----
  const errBeforeOpen = pageErrors.length;
  await page.evaluate(() => {
    const t = document.querySelector(".gallery .tile");
    t && t.click();
  });
  await sleep(700);
  const opened = await page.evaluate(() => ({ mode: window.__app?.mode }));
  check("gallery: clicking a tile opens it in home preview", opened.mode === "home" && pageErrors.length === errBeforeOpen, `mode=${opened.mode}`);
  await shot("gallery-open");

  // ---- K2. Scroll-collapse: fixed header appears when scrolled (home mode) ----
  // Use scrollIntoView (native scroll the browser actually renders) so the
  // IntersectionObserver fires, rather than the headless-flaky scrollTop setter.
  const collapseDown = await page.evaluate(async () => {
    const tiles = document.querySelectorAll(".gallery .tile");
    tiles[tiles.length - 1].scrollIntoView({ block: "end" });
    await new Promise((r) => setTimeout(r, 400));
    const app = document.getElementById("app");
    const hdr = document.querySelector(".stage-header");
    const r = hdr.getBoundingClientRect();
    return {
      scrolled: app.classList.contains("scrolled"),
      headerVisible: getComputedStyle(hdr).display !== "none",
      headerPinnedTop: Math.round(r.top) === 0 && r.height > 0 && r.height <= 80,
      headerH: Math.round(r.height),
    };
  });
  check("scroll: collapses → fixed header shown (.scrolled)", collapseDown.scrolled && collapseDown.headerVisible);
  check("scroll: header pinned to top, slim (~60px)", collapseDown.headerPinnedTop, `h=${collapseDown.headerH}`);
  await shot("collapsed");

  const collapseUp = await page.evaluate(async () => {
    const app = document.getElementById("app");
    document.getElementById("stage").scrollIntoView({ block: "start" });
    await new Promise((r) => setTimeout(r, 400));
    return { scrolled: app.classList.contains("scrolled") };
  });
  check("scroll: re-expands at top (header hidden)", !collapseUp.scrolled);

  // ---- L. Seed library expansion ----
  const seedInfo = await page.evaluate(async () => {
    const mod = await import("/src/core/figures.ts");
    const seeds = mod.buildSeedFigures();
    const FIG = mod.FIG;
    let allFit = true;
    let allNonEmpty = true;
    for (const s of seeds) {
      const m = s.doc.models[0];
      if (m.count === 0) allNonEmpty = false;
      if (m.sizeX > FIG.X || m.sizeY > FIG.Y || m.sizeZ > FIG.Z) allFit = false;
    }
    const names = seeds.map((s) => s.name);
    const hasNew = ["Tree", "Car", "House", "Planet"].every((n) => names.includes(n));
    return { count: seeds.length, allFit, allNonEmpty, hasNew };
  });
  check("seeds: expanded library (>=45 figures)", seedInfo.count >= 45, `n=${seedInfo.count}`);
  check("seeds: every figure non-empty and fits 20³", seedInfo.allNonEmpty && seedInfo.allFit);
  check("seeds: new categories present (tree/car/house/planet)", seedInfo.hasNew);

  // ---- M. randomFigureDoc palette variety ----
  const variety = await page.evaluate(async () => {
    const mod = await import("/src/core/figures.ts");
    const sig = () => {
      const { doc } = mod.randomFigureDoc();
      const used = new Set();
      doc.models[0].forEach((_x, _y, _z, c) => used.add(`${c}:${JSON.stringify(doc.palette.get(c))}`));
      return [...used].sort().join("|");
    };
    const a = sig(), b = sig(), c = sig();
    return { distinct: new Set([a, b, c]).size };
  });
  check("ambient: randomFigureDoc varies palette across calls", variety.distinct >= 2, `distinct=${variety.distinct}`);

  // ---- N. Ambient contribution (IndexedDB path) + per-browser throttle ----
  // Earlier sections saved a creation (sets savedThisSession); reset to simulate
  // a visitor who lingered without saving.
  await page.evaluate(() => { window.__app.savedThisSession = false; });
  const before = await page.evaluate(async () => (await (await import("/src/store/galleryStore.ts")).galleryStore.list()).length);
  const amb = await page.evaluate(() => window.__app.__ambientNow());
  await sleep(900); // IndexedDB put has a simulated delay
  const afterFirst = await page.evaluate(async () => (await (await import("/src/store/galleryStore.ts")).galleryStore.list()).length);
  const ambAgain = await page.evaluate(() => window.__app.__ambientNow());
  await sleep(300);
  const afterSecond = await page.evaluate(async () => (await (await import("/src/store/galleryStore.ts")).galleryStore.list()).length);
  check("ambient: __ambientNow adds one figure", amb === true && afterFirst === before + 1, `${before}->${afterFirst}`);
  check("ambient: per-browser throttle blocks immediate repeat", ambAgain === false && afterSecond === afterFirst, `again=${ambAgain} ${afterFirst}->${afterSecond}`);

  // ---- O. Auto figures sort below human creations ----
  const sortRes = await page.evaluate(async () => {
    const list = await (await import("/src/store/galleryStore.ts")).galleryStore.list();
    const firstAutoIdx = list.findIndex((r) => r.auto);
    const lastHumanIdx = list.map((r) => !r.auto).lastIndexOf(true);
    // every human (auto falsy) must come before every auto
    return { ok: firstAutoIdx === -1 || lastHumanIdx < firstAutoIdx, n: list.length };
  });
  check("sort: human-made creations rank above auto figures", sortRes.ok, `n=${sortRes.n}`);

  // ---- P. sendBeacon payload (REST path, stubbed) ----
  const beacon = await page.evaluate(async () => {
    const captured = [];
    const realApi = window.VOXEL_API;
    const realBeacon = navigator.sendBeacon;
    window.VOXEL_API = { base: "https://example.test/wp-json/voxel/v1/" };
    navigator.sendBeacon = (url, blob) => { captured.push({ url, blob }); return true; };
    const mod = await import("/src/store/galleryStore.ts");
    const rec = {
      id: mod.newId(), name: "Probe", author: "Alex",
      voxBytes: new Uint8Array([1, 2, 3, 4]).buffer, thumb: "data:image/png;base64,xx",
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(), auto: true,
    };
    const ok = mod.galleryStore.beaconContribute(rec);
    const text = captured.length ? await captured[0].blob.text() : "";
    let body = {};
    try { body = JSON.parse(text); } catch {}
    window.VOXEL_API = realApi;
    navigator.sendBeacon = realBeacon;
    return {
      ok, url: captured[0]?.url || "",
      auto: body.auto, ambient: body.ambient, owner: body.owner || "",
      authorLen: (body.author || "").length, hasVox: !!body.voxBytes, hasThumb: !!body.thumb,
    };
  });
  check("beacon: REST contribute POSTs to /creations with auto+ambient", beacon.ok && /\/creations$/.test(beacon.url) && beacon.auto === true && beacon.ambient === true);
  check("beacon: payload valid (author 1–24, vox+thumb present)", beacon.authorLen >= 1 && beacon.authorLen <= 24 && beacon.hasVox && beacon.hasThumb, `authorLen=${beacon.authorLen}`);
  check("security: payload carries an owner token (anti-overwrite)", beacon.owner.length >= 8, `ownerLen=${beacon.owner.length}`);

  // ---- runtime errors ----
  check("no uncaught runtime errors during run", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
} catch (err) {
  check("test harness completed without throwing", false, String(err && err.message));
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n==== ${passed}/${results.length} checks passed, ${failed} failed ====`);
if (pageErrors.length) console.log("PAGE ERRORS:\n" + pageErrors.join("\n"));
await browser.close();
process.exit(failed ? 2 : 0);
