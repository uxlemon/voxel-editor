import * as THREE from "three";
import { Viewport } from "../render/Viewport";
import { SceneRenderer } from "../render/SceneRenderer";
import { VoxDocument } from "../core/Document";
import { parseVox } from "../io/voxParser";
import { downloadVox, writeVox } from "../io/voxWriter";
import { exportOBJ, exportGLB, exportPNG } from "../io/exporters";
import { Editor, EditorHost, Tool } from "../edit/Editor";
import { History } from "../edit/commands";
import { Toolbar } from "../ui/Toolbar";
import { PalettePanel } from "../ui/PalettePanel";
import { ScenePanel } from "../ui/ScenePanel";
import { VolumePanel } from "../ui/VolumePanel";
import { VoxelModel } from "../core/VoxelModel";
import { ViewCube } from "../render/ViewCube";
import { OptionsMenu } from "../ui/OptionsMenu";
import { Gallery } from "../ui/Gallery";
import { ShareView } from "../ui/ShareView";
import { SaveManager } from "../save/SaveManager";
import { Thumbnailer } from "../render/thumbnailer";
import { CreationRecord, galleryStore, newId } from "../store/galleryStore";
import { randomFigureDoc } from "../core/figures";
import { pickRandomPreset } from "../core/presets";
import { icon, smileLogo } from "../ui/icons";
import { cookieConsentAnswered, setCookieConsent, setAuthorName } from "../util/cookies";
import { assetUrl } from "../util/assets";

type Mode = "home" | "edit";

const HEADLINES = [
  "REMIX & CREATE",
  "VOXEL FUN",
  "KEEP BUILDING",
  "MAKE SOMETHING",
  "BLOCK BY BLOCK",
  "BUILD IT YOUR WAY",
  "TINY WORLDS",
  "STACK SOME CUBES",
];

interface LoadOpts {
  parentId?: string | null;
  suggestedName?: string;
  author?: string | null;
  dirty?: boolean;
  serverBacked?: boolean;
  recordId?: string | null;
  /** reframe the camera on load (default true); false keeps the current view */
  reframe?: boolean;
}

interface PersistMeta {
  dirty: boolean;
  parentId: string | null;
  serverBacked: boolean;
  recordId: string | null;
  suggestedName: string;
  author: string | null;
  lastPresetId: string | null;
}

/**
 * Top-level application: owns the document, viewport, renderer, editor and
 * history, and wires the home preview, gallery, options menu and save flow
 * together. The home preview and the full-screen editor share one canvas.
 */
export class App implements EditorHost {
  readonly viewport: Viewport;
  readonly scene: SceneRenderer;
  readonly history = new History();
  readonly editor: Editor;
  doc: VoxDocument;

  private toolbar: Toolbar;
  private palettePanel: PalettePanel;
  private scenePanel!: ScenePanel;
  private volumePanel!: VolumePanel;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private authorBadge!: HTMLElement;
  private headline!: HTMLElement;
  private headlineIdx = -1;
  private options!: OptionsMenu;
  private gallery!: Gallery;
  private shareView!: ShareView;
  private saveManager!: SaveManager;
  private thumbnailer = new Thumbnailer();
  private shareableId: string | null = null;
  private committedDoc: VoxDocument | null = null;
  private committedAuthor: string | null = null;
  private hoverActive = false;
  private reeling = false;
  private prevTool: Tool = "none";

  private appRoot: HTMLElement;
  private mode: Mode = "home";
  private hovering = false;
  private advanced = false;
  private advancedLocked = false;
  private currentAuthor: string | null = null;
  private lastPresetId: string | null = null;
  private fileInput!: HTMLInputElement;
  private resizeTimer = 0;
  private viewCubeEl: HTMLElement | null = null;

  /** "All" world view: every object shown, model editing disabled. */
  worldView = false;
  private autosaveTimer = 0;

  // Ambient community growth: if a visitor lingers past the nudge threshold
  // without saving, contribute one random figure on page-leave (see armAmbient).
  private sessionStart = Date.now();
  private savedThisSession = false;
  private pendingAmbient: CreationRecord | null = null;
  private ambientSent = false;
  private ambientTimer = 0;

  private static AUTOSAVE_KEY = "voxel-editor-autosave-v1";
  private static META_KEY = "voxel-game-meta-v1";
  private static ADV_KEY = "voxel-game-advanced";
  private static AMBIENT_KEY = "voxel-last-ambient";
  /** Don't let one browser auto-contribute more than once per this window. */
  private static AMBIENT_BROWSER_THROTTLE_MS = 6 * 60 * 60 * 1000;
  /** how much more zoomed-out the preview is vs. the editor */
  private static PREVIEW_ZOOM = 1.18;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.appRoot = document.getElementById("app") as HTMLElement;
    this.viewport = new Viewport(canvas);
    this.scene = new SceneRenderer(this.viewport);
    this.doc = VoxDocument.blank(32);

    this.editor = new Editor(this, canvas);
    this.toolbar = new Toolbar(
      this.editor,
      () => this.onToolChanged(),
      () => this.recenterCamera()
    );
    this.palettePanel = new PalettePanel(
      this.editor,
      () => this.doc,
      () => this.scene.syncPalette(),
      () => this.activatePick()
    );

    this.scenePanel = new ScenePanel({
      getDoc: () => this.doc,
      isWorldView: () => this.worldView,
      isShowOthers: () => this.scene.view.showOthers,
      setActiveObject: (id) => this.setActiveObject(id),
      setWorldView: () => this.setWorldView(),
      toggleShowOthers: () => this.toggleShowOthers(),
      addObject: () => this.addObject(),
      deleteObject: (id) => this.deleteObject(id),
    });
    this.volumePanel = new VolumePanel({
      getDoc: () => this.doc,
      resizeActive: (x, y, z) => this.resizeActiveVolume(x, y, z),
    });

    new ViewCube(this.viewport);
    this.viewCubeEl = document.querySelector(".viewcube");

    this.advanced = localStorage.getItem(App.ADV_KEY) === "1";
    this.buildChrome(ui);

    // Right dock: volume + objects (Advanced only) — top-right.
    const rightDock = document.createElement("div");
    rightDock.className = "right-dock";
    rightDock.append(this.volumePanel.el, this.scenePanel.el);
    ui.appendChild(rightDock);
    this.rightDock = rightDock;

    // Bottom-center dock (sibling of the fixed stage so it doesn't fade with
    // it): save pill (top) · palette (contextual) · toolbar (bottom).
    const dock = document.createElement("div");
    dock.className = "dock-bottom";
    this.appRoot.appendChild(dock);

    // Gallery below the stage.
    this.gallery = new Gallery(
      (rec) => this.openFromGallery(rec),
      (rec) => this.hoverPreview(rec)
    );
    document.getElementById("gallery-mount")!.appendChild(this.gallery.el);

    // Share panel (frame → capture → copy unique link).
    this.shareView = new ShareView({
      captureThumb: () => this.captureThumb(),
      shareUrl: (id) => this.shareUrl(id),
      saveShare: (id, thumb) => this.saveShare(id, thumb),
      onClose: () => this.closeShare(),
    });
    this.appRoot.appendChild(this.shareView.el);

    // Save manager (pill + popup) — pill lives in the dock column.
    this.saveManager = new SaveManager(
      {
        getDoc: () => this.doc,
        renderThumb: () => this.thumbnailer.render(this.doc),
        voxBytes: () => writeVox(this.doc),
        hasUndo: () => this.history.canUndo(),
        setModifiedFlag: () => this.saveLocal(),
        onServerSaved: (rec) => this.onServerSaved(rec),
        onDiscard: () => void this.loadRandomCommunity(),
      },
      dock
    );
    dock.appendChild(this.palettePanel.el);
    dock.appendChild(this.toolbar.el);

    // Palette is contextual: shown while the pointer is on the toolbar/palette
    // for a color tool; hidden over the model or the save pill.
    const onTools = () => this.showPalette(true);
    this.toolbar.el.addEventListener("pointerenter", onTools);
    this.palettePanel.el.addEventListener("pointerenter", onTools);
    // Hovering the save pill must NOT reveal the palette.
    dock.querySelector(".save-pill")?.addEventListener("pointerenter", () => this.showPalette(false));

    this.history.onChange(() => this.updateHistoryUI());
    this.bindKeys();
    this.bindStage(canvas);
    this.bindScrollCollapse();
    this.applyAdvanced();
    this.armAmbient();
    void this.boot();

    (window as unknown as { __app: App }).__app = this;
  }

  private rightDock!: HTMLElement;

  // --- boot / content loading ---
  private async boot(): Promise<void> {
    await galleryStore
      .seedSamplesOnce(async (bytes) => this.thumbnailer.renderVox(bytes))
      .catch(() => {});
    await this.gallery.refresh();

    // Deep link: ?c=<id> opens that creation in the preview.
    const shareId = new URLSearchParams(location.search).get("c");
    if (shareId) {
      const rec = await galleryStore.get(shareId).catch(() => undefined);
      if (rec) {
        this.openFromGallery(rec);
        return;
      }
    }

    const meta = this.readMeta();
    this.lastPresetId = meta?.lastPresetId ?? null;
    const bytes = this.readBytes();
    if (meta?.dirty && bytes) {
      try {
        // Resume unsaved work directly in the editor.
        this.loadDocument(parseVox(bytes), {
          dirty: true,
          parentId: meta.parentId,
          serverBacked: meta.serverBacked,
          recordId: meta.recordId,
          suggestedName: meta.suggestedName,
          author: meta.author,
        });
        this.mode = "home";
        this.enterEdit();
        return;
      } catch {
        /* fall through to a random community model */
      }
    }
    await this.playLoadingReel();
  }

  /**
   * Loading intro: rapidly flip through community models, gradually slowing,
   * then settle on a random one (~3s). Cancels if the user picks something.
   */
  private async playLoadingReel(): Promise<void> {
    let recs: CreationRecord[] = [];
    try {
      recs = await galleryStore.list();
    } catch {
      /* ignore */
    }
    if (recs.length < 2) {
      await this.loadRandomCommunity();
      return;
    }
    const final = recs[Math.floor(Math.random() * recs.length)];
    this.reeling = true;
    this.scene.setColorMix(0); // shuffle in white
    this.appRoot.classList.add("reeling"); // hide buttons/author while loading
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Constant-speed shuffle that stops sharply when time is up (no easing).
    const TOTAL = 1000;
    const STEP = 80;
    let elapsed = 0;
    let framed = false;
    while (this.reeling && elapsed < TOTAL) {
      const r = recs[Math.floor(Math.random() * recs.length)];
      try {
        const doc = parseVox(r.voxBytes);
        if (!framed) {
          this.shareableId = r.id;
          this.loadDocument(doc, { parentId: r.id, author: r.author, suggestedName: r.name });
          this.enterHome();
          framed = true;
        } else {
          this.showPreviewDoc(doc, r.author);
        }
        this.gallery.setCurrent(r.id);
      } catch {
        /* skip bad record */
      }
      await sleep(STEP);
      elapsed += STEP;
    }
    if (!this.reeling) return; // cancelled by a user action
    this.reeling = false;
    this.appRoot.classList.remove("reeling"); // fade buttons/author back in
    // Settle on the final pick (keep the current camera).
    this.shareableId = final.id;
    this.loadDocument(parseVox(final.voxBytes), {
      parentId: final.id,
      author: final.author,
      suggestedName: final.name,
      reframe: false,
    });
    this.enterHome();
    this.gallery.setCurrent(final.id);
    this.animateColorMix(2000); // white → full color over 2s
  }

  /** Ease the voxel colors from white to full color over `ms`. */
  private animateColorMix(ms: number): void {
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      this.scene.setColorMix(k);
      if (k < 1 && !this.reeling) requestAnimationFrame(step);
      else if (this.reeling) this.scene.setColorMix(1);
    };
    requestAnimationFrame(step);
  }

  /** Show a random community creation in the preview (Remix/Create choose entry). */
  private async loadRandomCommunity(): Promise<void> {
    let recs: CreationRecord[] = [];
    try {
      recs = await galleryStore.list();
    } catch {
      /* ignore */
    }
    const rec = recs.length
      ? recs[Math.floor(Math.random() * recs.length)]
      : null;
    if (rec) {
      try {
        this.loadDocument(parseVox(rec.voxBytes), {
          parentId: rec.id,
          author: rec.author,
          suggestedName: rec.name,
        });
        this.shareableId = rec.id;
        this.enterHome();
        this.gallery.setCurrent(rec.id);
        return;
      } catch {
        /* fall through to a preset */
      }
    }
    this.loadRandomPreset();
  }

  private loadRandomPreset(): void {
    const { id, name, doc } = pickRandomPreset(this.lastPresetId ?? undefined);
    this.lastPresetId = id;
    this.shareableId = null;
    this.loadDocument(doc, { suggestedName: name });
    this.enterHome();
  }

  // --- localStorage persistence ---
  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.saveLocal(), 700);
  }

  private saveLocal(): void {
    try {
      const buf = writeVox(this.doc);
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      localStorage.setItem(App.AUTOSAVE_KEY, btoa(bin));
      const m = this.saveManager.getPersistMeta();
      const meta: PersistMeta = {
        dirty: m.dirty,
        parentId: m.parentId,
        serverBacked: m.serverBacked,
        recordId: m.recordId,
        suggestedName: m.suggestedName,
        author: this.currentAuthor,
        lastPresetId: this.lastPresetId,
      };
      localStorage.setItem(App.META_KEY, JSON.stringify(meta));
    } catch {
      /* storage may be full or unavailable; ignore */
    }
  }

  private readBytes(): ArrayBuffer | null {
    try {
      const s = localStorage.getItem(App.AUTOSAVE_KEY);
      if (!s) return null;
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    } catch {
      return null;
    }
  }

  private readMeta(): PersistMeta | null {
    try {
      const s = localStorage.getItem(App.META_KEY);
      return s ? (JSON.parse(s) as PersistMeta) : null;
    } catch {
      return null;
    }
  }

  // --- mode switching ---
  private enterEdit(): void {
    if (this.mode === "edit") return;
    this.reeling = false; // a deliberate action cancels the loading reel
    this.scene.setColorMix(1);
    this.appRoot.classList.remove("reeling");
    this.mode = "edit";
    this.editor.interactive = true; // editing enabled in full-screen mode
    this.appRoot.classList.remove("mode-home", "scrolled");
    this.appRoot.scrollTop = 0;
    this.appRoot.classList.add("mode-edit");
    this.viewport.setAmbientTilt(0, 0);
    this.viewport.setAutoSpin(false);
    this.scheduleResize();
    this.updateGridShown();
    this.updateChrome();
    this.viewport.animateZoom(1 / App.PREVIEW_ZOOM); // zoom in to editor framing
  }

  private enterHome(): void {
    const wasEdit = this.mode === "edit";
    this.mode = "home";
    // Preview is view-only: drop any active tool so clicks can't edit (they
    // orbit / shuffle the headline instead), clear any selection (so the
    // transform gizmo is hidden), and mark the editor read-only.
    this.editor.interactive = false;
    this.editor.clearSelection();
    this.toolbar.setTool("none");
    this.appRoot.classList.remove("mode-edit", "scrolled");
    this.appRoot.scrollTop = 0;
    this.appRoot.classList.add("mode-home");
    this.scheduleResize();
    this.updateGridShown();
    this.updateChrome();
    if (wasEdit) this.viewport.animateZoom(App.PREVIEW_ZOOM); // zoom out to preview
    this.viewport.setAutoSpin(!this.hovering); // idle showcase when not hovering
  }

  /** Resize the renderer to match the stage (left column width changes between
   *  the two-column home and the full-screen editor). */
  private scheduleResize(): void {
    this.viewport.resize();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.viewport.resize(), 60);
  }

  /**
   * Home-mode collapse: once the preview is scrolled past a small threshold, a
   * slim fixed header appears (and the preview scrolls away) so the community
   * grid fills the viewport; scrolling back to the top (or tapping the header)
   * hides it again. Driven by an IntersectionObserver on a top sentinel rather
   * than reading scrollTop — the observer reflects the browser's actual rendered
   * scroll position regardless of how the user scrolls (wheel / touch / keys).
   * Only meaningful in home mode — edit mode hides the grid, so #app can't scroll.
   */
  private bindScrollCollapse(): void {
    // Flow sentinel at the very top; margin cancels its 1px layout cost.
    const sentinel = document.createElement("div");
    sentinel.className = "scroll-sentinel";
    sentinel.style.cssText = "width:1px;height:1px;margin-bottom:-1px;pointer-events:none;";
    this.appRoot.insertBefore(sentinel, this.appRoot.firstChild);

    const io = new IntersectionObserver(
      (entries) => {
        if (this.mode !== "home") return;
        // sentinel visible (near top) → expanded; scrolled away → collapsed.
        this.setCollapsed(!entries[0].isIntersecting);
      },
      { root: this.appRoot, rootMargin: "40px 0px 0px 0px", threshold: 0 }
    );
    io.observe(sentinel);
  }

  private setCollapsed(on: boolean): void {
    // Pure overlay toggle — the stage keeps its height, so no canvas resize and
    // no scroll-height change.
    this.appRoot.classList.toggle("scrolled", on);
  }

  private bindStage(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerenter", () => {
      this.hovering = true;
      this.viewport.setAutoSpin(false); // pointer back over the model
      this.showPalette(false); // moving onto the model hides the palette
      this.updateGridShown();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hovering = false;
      this.viewport.setAmbientTilt(0, 0);
      // Idle: recenter and slowly orbit the preview for a 360° showcase.
      if (this.mode === "home") {
        this.recenterPreviewSmooth();
        this.viewport.setAutoSpin(true);
      }
      this.updateGridShown();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.mode === "home" && e.buttons === 0) {
        const r = canvas.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        // Flip X for hover only (drag-orbit is unaffected).
        this.viewport.setAmbientTilt(-nx, -ny);
      }
    });
    // While sharing, update the snapshot after repositioning the camera.
    canvas.addEventListener("pointerup", () => {
      if (this.appRoot.classList.contains("sharing")) this.shareView.refreshThumb();
    });

    // Home: left-drag/touch orbits the preview. A tap (the headline sits behind
    // the canvas, so it can't be clicked directly) shuffles the headline.
    let dx = 0;
    let dy = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) {
        dx = e.clientX;
        dy = e.clientY;
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.mode !== "home" || e.button !== 0) return;
      if (Math.hypot(e.clientX - dx, e.clientY - dy) < 6) this.shuffleHeadline();
    });
    // Remix/Create buttons choose how to enter the editor.
    // Cmd/Ctrl+wheel zooms (handled in Viewport).
  }

  /** Tools that pick or apply a color (and therefore want the palette). */
  private toolUsesColor(): boolean {
    return ["attach", "paint", "fill", "eyedropper"].includes(this.editor.tool);
  }

  private shuffleHeadline(): void {
    if (!this.headline) return;
    let i = this.headlineIdx;
    if (HEADLINES.length > 1) {
      while (i === this.headlineIdx) i = Math.floor(Math.random() * HEADLINES.length);
    } else i = 0;
    this.headlineIdx = i;
    this.headline.textContent = HEADLINES[i];
  }

  /** Show/hide the contextual palette above the bottom toolbar. Select and
   *  Remove don't use color, so the palette stays hidden for them. */
  private showPalette(show: boolean): void {
    if (!this.palettePanel) return;
    this.palettePanel.el.classList.toggle(
      "show",
      show && this.mode === "edit" && this.toolUsesColor()
    );
  }

  private onToolChanged(): void {
    this.updateGridShown();
    // May be invoked from the Toolbar constructor before the palette exists.
    if (!this.palettePanel) return;
    this.palettePanel.setPickActive(this.editor.tool === "eyedropper");
    // Selecting a color tool (Attach/Paint/Fill/Pick) reveals the palette;
    // Select/Remove hide it (showPalette is gated by toolUsesColor()).
    this.showPalette(true);
  }

  private updateGridShown(): void {
    // Always show the volume box in the editor; never in the home preview.
    this.scene.view.gridShown = this.mode === "edit";
    this.scene.syncVolumeBox(this.doc);
  }

  private updateChrome(): void {
    this.palettePanel.setPickActive(this.editor.tool === "eyedropper");
    // ViewCube is mounted on <body>, so toggle it from JS (CSS selectors that
    // target #app descendants can't reach it).
    if (this.viewCubeEl) {
      this.viewCubeEl.style.display = this.mode === "edit" ? "" : "none";
    }
  }

  private activatePick(): void {
    if (this.editor.tool !== "eyedropper") this.prevTool = this.editor.tool;
    this.toolbar.setTool("eyedropper");
    this.palettePanel.setPickActive(true);
    if (this.mode === "home") this.enterEdit();
  }

  // --- EditorHost ---
  setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }
  setHover(text: string): void {
    if (this.hoverEl) this.hoverEl.textContent = text;
  }
  onColorPicked(index: number): void {
    this.editor.color = index;
    this.palettePanel.select(index);
    // Pick is single-use: after grabbing a color, return to the previous tool.
    if (this.editor.tool === "eyedropper") this.toolbar.setTool(this.prevTool);
  }

  refresh(reframe = false): void {
    this.scene.sync(this.doc);
    if (reframe) this.recenterCamera();
    this.updateStatus();
  }

  /** Load a brand-new document (preset, sample, blank, file or remix). */
  private loadDocument(doc: VoxDocument, opts: LoadOpts = {}): void {
    this.doc = doc;
    this.history.clear();
    this.editor.clearSelection();
    this.worldView = false;
    this.scene.view.worldView = false;
    this.palettePanel.refresh();
    this.palettePanel.select(this.editor.color);
    this.updateGridShown();
    this.refresh(opts.reframe ?? true);
    this.scenePanel?.render();
    this.applyAdvanced();
    this.currentAuthor = opts.author ?? null;
    this.updateAuthorBadge(opts);
    this.saveManager.onBaseline({
      parentId: opts.parentId ?? null,
      suggestedName: opts.suggestedName ?? "Creation",
      dirty: opts.dirty,
      serverBacked: opts.serverBacked,
      recordId: opts.recordId,
    });
    this.saveLocal();
    // Remember this as the committed preview (list-hover previews revert to it).
    this.committedDoc = doc;
    this.committedAuthor = opts.author ?? null;
    this.hoverActive = false;
  }

  /** Lightweight swap for temporary list-hover previews (view-only, no save
   *  reset, and no camera reset — keep the current angle/zoom). */
  private showPreviewDoc(doc: VoxDocument, author: string | null): void {
    this.doc = doc;
    this.scene.sync(doc);
    this.updateAuthorBadge({ author });
  }

  /** Hover a list tile to preview it; leave (null) reverts to the committed one.
   *  Hovering only swaps the 3D preview — the enlarged "current" tile stays on
   *  the selected creation until a different one is actually clicked. */
  private hoverPreview(rec: CreationRecord | null): void {
    if (this.mode !== "home" || this.reeling) return;
    if (rec) {
      if (rec.id === this.shareableId && !this.hoverActive) return;
      try {
        this.showPreviewDoc(parseVox(rec.voxBytes), rec.author);
        this.hoverActive = true;
      } catch {
        /* ignore bad record */
      }
    } else if (this.hoverActive) {
      if (this.committedDoc) this.showPreviewDoc(this.committedDoc, this.committedAuthor);
      this.hoverActive = false;
    }
  }

  /** EditorHost-compatible document swap (used by samples/file open). */
  setDocument(doc: VoxDocument): void {
    this.loadDocument(doc, { suggestedName: "Creation" });
  }

  // --- gallery ---
  /** Clicking a creation loads it into the left preview (does not enter edit). */
  private openFromGallery(rec: CreationRecord): void {
    this.reeling = false; // picking a model cancels the loading reel
    this.scene.setColorMix(1);
    this.appRoot.classList.remove("reeling");
    try {
      this.shareableId = rec.id;
      this.loadDocument(parseVox(rec.voxBytes), {
        parentId: rec.id,
        suggestedName: rec.name,
        author: rec.author,
        reframe: false, // keep the current camera when switching preview models
      });
      this.enterHome();
      this.gallery.setCurrent(rec.id);
    } catch (err) {
      alert("Failed to open: " + (err as Error).message);
    }
  }

  private onServerSaved(rec: CreationRecord): void {
    this.currentAuthor = rec.author;
    this.shareableId = rec.id;
    // The visitor contributed for real — never also drop an ambient figure.
    this.savedThisSession = true;
    this.pendingAmbient = null;
    if (this.ambientTimer) {
      clearTimeout(this.ambientTimer);
      this.ambientTimer = 0;
    }
    this.gallery.prepend(rec);
    this.gallery.setCurrent(rec.id);
    this.updateAuthorBadge({ author: rec.author });
    // First save → offer to remember the name with a cookie.
    this.showCookieConsent(rec.author);
  }

  // --- ambient community growth -------------------------------------------
  /**
   * If a visitor lingers past the nudge threshold (~3 min) without saving, build
   * one random figure in the background, then contribute it on page-leave via a
   * beacon. Per-browser throttled (localStorage) so one visitor can't spam; the
   * server enforces a separate site-wide rate limit.
   */
  private ambientThrottled(): boolean {
    const last = Number(localStorage.getItem(App.AMBIENT_KEY) || 0);
    return Date.now() - last < App.AMBIENT_BROWSER_THROTTLE_MS;
  }

  private armAmbient(): void {
    if (this.ambientThrottled()) return; // this browser contributed recently
    const delay = this.saveManager?.NUDGE_MS ?? 3 * 60 * 1000;
    this.ambientTimer = window.setTimeout(() => this.buildAmbientCandidate(), delay);

    const onLeave = (): void => this.sendAmbient();
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onLeave();
    });
  }

  /** Pre-render a random figure (app is alive → WebGL available). */
  private buildAmbientCandidate(): void {
    if (this.savedThisSession || this.pendingAmbient) return;
    try {
      const { name, author, doc } = randomFigureDoc();
      const vox = writeVox(doc);
      const now = Date.now();
      this.pendingAmbient = {
        id: newId(),
        name,
        author,
        voxBytes: vox,
        thumb: this.thumbnailer.render(doc),
        parentId: null,
        createdAt: now,
        updatedAt: now,
        auto: true,
      };
    } catch {
      /* a failed candidate just means no ambient contribution this session */
    }
  }

  private sendAmbient(): void {
    if (this.ambientSent || this.savedThisSession || !this.pendingAmbient) return;
    if (Date.now() - this.sessionStart < (this.saveManager?.NUDGE_MS ?? 3 * 60 * 1000)) return;
    if (galleryStore.beaconContribute(this.pendingAmbient)) {
      this.ambientSent = true;
      localStorage.setItem(App.AMBIENT_KEY, String(Date.now()));
    }
  }

  /** Debug/testing hook: build + contribute immediately, bypassing only the
   *  3-min wait (still honors the per-browser throttle, like the real path). */
  __ambientNow(): boolean {
    if (this.ambientThrottled()) return false;
    this.buildAmbientCandidate();
    if (!this.pendingAmbient) return false;
    const ok = galleryStore.beaconContribute(this.pendingAmbient);
    if (ok) localStorage.setItem(App.AMBIENT_KEY, String(Date.now()));
    this.pendingAmbient = null;
    return ok;
  }

  // --- create ---
  private startCreate(): void {
    this.shareableId = null;
    this.loadDocument(VoxDocument.grayCube(), { suggestedName: "Creation" });
    this.enterEdit();
  }

  // --- share ---
  private openShare(): void {
    const id = this.shareableId ?? this.saveManager.recordId;
    if (!id) {
      // Not on the server yet — save it first to get a shareable link.
      this.saveManager.promptSave();
      return;
    }
    this.viewport.setAutoSpin(false);
    this.appRoot.classList.add("sharing");
    this.scheduleResize();
    // Keep the current camera — the snapshot is captured from this exact view.
    this.shareView.open(id);
  }

  private closeShare(): void {
    this.appRoot.classList.remove("sharing");
    this.shareView.close();
    this.scheduleResize();
    if (this.mode === "home" && !this.hovering) this.viewport.setAutoSpin(true);
  }

  /** Square PNG of the current view (from the live camera angle, never cut). */
  private captureThumb(): string {
    const dir = this.viewport.camera.position.clone().sub(this.viewport.controls.target);
    return this.thumbnailer.render(this.doc, dir);
  }

  private shareUrl(id: string): string {
    return `${location.origin}${location.pathname}?c=${encodeURIComponent(id)}`;
  }

  private async saveShare(id: string, thumb: string): Promise<void> {
    try {
      const rec = await galleryStore.get(id);
      if (!rec) return;
      const updated: CreationRecord = { ...rec, thumb, updatedAt: rec.updatedAt };
      await galleryStore.put(updated);
      this.gallery.prepend(updated);
      this.gallery.setCurrent(id);
    } catch {
      /* ignore */
    }
  }

  private updateAuthorBadge(opts: { author?: string | null; parentId?: string | null }): void {
    if (!this.authorBadge) return;
    // Only show the badge when there's a real author — hide it for your own
    // (unsaved) creation.
    if (opts.author) {
      this.authorBadge.innerHTML = `by <b>${escapeHtml(opts.author)}</b>`;
      this.authorBadge.style.display = "";
    } else {
      this.authorBadge.style.display = "none";
    }
  }

  // --- advanced mode ---
  private applyAdvanced(): void {
    this.advancedLocked = this.doc.placements.length > 1;
    const on = this.advanced || this.advancedLocked;
    if (this.rightDock) this.rightDock.style.display = on ? "" : "none";
    this.palettePanel.setMode(on ? "full" : "basic");
  }

  private setAdvanced(on: boolean): void {
    if (this.advancedLocked) return;
    this.advanced = on;
    localStorage.setItem(App.ADV_KEY, on ? "1" : "0");
    this.applyAdvanced();
  }

  // --- scene / world operations ---
  setActiveObject(modelId: number): void {
    this.worldView = false;
    this.scene.view.worldView = false;
    this.doc.activeModel = modelId;
    this.editor.clearSelection();
    this.scene.applyVisibility(this.doc);
    this.scenePanel.render();
    this.updateStatus();
  }

  setWorldView(): void {
    this.worldView = true;
    this.scene.view.worldView = true;
    this.editor.clearSelection();
    this.scene.applyVisibility(this.doc);
    this.scenePanel.render();
    this.updateStatus();
  }

  toggleShowOthers(): void {
    this.scene.view.showOthers = !this.scene.view.showOthers;
    this.scene.applyVisibility(this.doc);
    this.scenePanel.render();
  }

  canEdit(): boolean {
    return !this.worldView;
  }

  onObjectMoved(): void {
    this.scenePanel.render();
    this.updateStatus();
  }

  onStructureChanged(): void {
    this.refresh(false);
    this.editor.refreshSelectionVisuals();
    this.scenePanel.render();
    this.updateStatus();
  }

  recenterCamera(): void {
    if (this.worldView) {
      this.scene.frame(this.doc);
      return;
    }
    const p = this.doc.placements.find((pl) => pl.modelId === this.doc.activeModel);
    const model = this.doc.active;
    if (!p || !model) {
      this.scene.frame(this.doc);
      return;
    }
    const meshPos = this.scene.positionFor(p, model);
    const center = meshPos.clone().add(
      new THREE.Vector3(model.sizeX / 2, model.sizeZ / 2, model.sizeY / 2)
    );
    // The home preview is framed slightly zoomed out vs. the editor.
    const factor = this.mode === "home" ? App.PREVIEW_ZOOM : 1;
    const radius = Math.max(model.sizeX, model.sizeY, model.sizeZ) * factor;
    this.viewport.recenter(center, radius);
  }

  /** Smoothly reframe the active model to the centered preview view. */
  private recenterPreviewSmooth(): void {
    const p = this.doc.placements.find((pl) => pl.modelId === this.doc.activeModel);
    const m = this.doc.active;
    if (!p || !m) {
      this.scene.frame(this.doc);
      return;
    }
    const meshPos = this.scene.positionFor(p, m);
    const center = meshPos
      .clone()
      .add(new THREE.Vector3(m.sizeX / 2, m.sizeZ / 2, m.sizeY / 2));
    const radius = Math.max(m.sizeX, m.sizeY, m.sizeZ) * App.PREVIEW_ZOOM;
    this.viewport.recenterSmooth(center, radius);
  }

  addObject(): void {
    const model = new VoxelModel(32, 32, 32);
    const modelId = this.doc.models.length;
    this.doc.models.push(model);
    const offset = 36 * this.doc.placements.length;
    this.doc.placements.push({
      modelId,
      t: [offset, 0, 0],
      layerId: 0,
      name: `object ${this.doc.placements.length}`,
    });
    this.worldView = false;
    this.scene.view.worldView = false;
    this.doc.activeModel = modelId;
    this.history.clear();
    this.refresh(false);
    this.scenePanel.render();
    this.applyAdvanced();
  }

  deleteObject(modelId: number): void {
    if (this.doc.placements.length <= 1) return;
    this.doc.placements = this.doc.placements.filter((p) => p.modelId !== modelId);
    const remap = new Map<number, number>();
    const newModels: VoxelModel[] = [];
    this.doc.models.forEach((m, oldId) => {
      if (this.doc.placements.some((p) => p.modelId === oldId)) {
        remap.set(oldId, newModels.length);
        newModels.push(m);
      }
    });
    this.doc.models = newModels;
    this.doc.placements.forEach((p) => {
      p.modelId = remap.get(p.modelId) ?? 0;
    });
    this.doc.activeModel = this.doc.placements[0]?.modelId ?? 0;
    this.history.clear();
    this.editor.clearSelection();
    this.refresh(false);
    this.scenePanel.render();
    this.applyAdvanced();
  }

  resizeActiveVolume(x: number, y: number, z: number): void {
    const m = this.doc.active;
    if (!m) return;
    if (m.sizeX === x && m.sizeY === y && m.sizeZ === z) return;
    m.resize(x, y, z);
    this.history.clear();
    this.refresh(true);
    this.scenePanel.render();
  }

  async loadFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const name = url.split("/").pop()?.replace(/\.vox$/, "") ?? "Creation";
    this.loadDocument(parseVox(await res.arrayBuffer()), { suggestedName: name });
  }

  async loadFromFile(file: File): Promise<void> {
    const name = file.name.replace(/\.vox$/, "");
    this.loadDocument(parseVox(await file.arrayBuffer()), { suggestedName: name });
  }

  screenForCell(modelId: number, x: number, y: number, z: number, top = false): { sx: number; sy: number } {
    const p = this.doc.placements.find((pl) => pl.modelId === modelId)!;
    const model = this.doc.models[modelId];
    const meshPos = this.scene.positionFor(p, model);
    const v = new THREE.Vector3(
      meshPos.x + x + 0.5,
      meshPos.y + z + (top ? 1.0 : 0.5),
      meshPos.z + y + 0.5
    );
    v.project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return {
      sx: (v.x * 0.5 + 0.5) * rect.width + rect.left,
      sy: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  }

  private undo(): void {
    if (this.mode !== "edit") return; // preview is read-only
    if (this.history.undo()) {
      this.refresh(false);
      this.editor.refreshSelectionVisuals();
    }
  }
  private redo(): void {
    if (this.mode !== "edit") return; // preview is read-only
    if (this.history.redo()) {
      this.refresh(false);
      this.editor.refreshSelectionVisuals();
    }
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadVox(this.doc, "model.vox");
      } else if (e.key.toLowerCase() === "i" && this.mode === "edit") {
        // eyedropper shortcut (the tool button lives in the palette now)
        e.preventDefault();
        this.activatePick();
      } else if (e.key.toLowerCase() === "h" || e.key === "Home") {
        e.preventDefault();
        this.recenterCamera();
      }
    });
  }

  private updateStatus(): void {
    this.volumePanel?.render();
    const voxels = this.doc.models.reduce((s, m) => s + m.count, 0);
    if (this.worldView) {
      this.setStatus(`${voxels} voxels · World view (read-only) · ${this.doc.placements.length} objects`);
      return;
    }
    const m = this.doc.active;
    this.setStatus(
      `${voxels} voxels · object ${this.doc.activeModel} (${m.sizeX}×${m.sizeY}×${m.sizeZ})`
    );
  }

  private updateHistoryUI(): void {
    this.updateStatus();
    this.scenePanel?.render();
    this.palettePanel?.updateInUse();
    this.scheduleAutosave();
    this.saveManager?.markEdited();
  }

  // --- chrome (logo bar, options menu, status, hover, author, help) ---
  private buildChrome(ui: HTMLElement): void {
    // Options menu (logo + chevron)
    this.options = new OptionsMenu({
      newDoc: () => this.loadDocument(VoxDocument.grayCube(), { suggestedName: "Creation" }),
      openFile: () => this.fileInput.click(),
      saveVox: () => downloadVox(this.doc, "model.vox"),
      exportAs: (kind) => this.doExport(kind),
      toggleProjection: () => this.toggleProjection(),
      projectionLabel: () => (this.viewport.projection === "pers" ? "Perspective" : "Orthographic"),
      recenter: () => this.recenterCamera(),
      loadSample: (file) => this.loadSampleFile(file),
      isAdvanced: () => this.advanced,
      isAdvancedLocked: () => this.advancedLocked,
      setAdvanced: (on) => this.setAdvanced(on),
    });
    ui.appendChild(this.options.el);

    // Brand logo (top-left) — shown on the preview, where the menu is hidden.
    const brand = document.createElement("div");
    brand.className = "brand-logo";
    brand.innerHTML = `<span class="logo-mark">${smileLogo}</span>`;
    ui.appendChild(brand);

    // Slim sticky header shown when the home preview is scrolled away — tap it
    // (or scroll back to the top) to re-expand the preview.
    const header = document.createElement("div");
    header.className = "stage-header";
    header.innerHTML =
      `<span class="logo-mark">${smileLogo}</span>` +
      `<span class="stage-header-label">Voxel Play</span>` +
      `<span class="stage-header-hint">↑ Back to top</span>`;
    header.addEventListener("click", () => this.appRoot.scrollTo({ top: 0, behavior: "smooth" }));
    this.appRoot.appendChild(header);

    // Back button (edit mode only) → return to the preview.
    const back = document.createElement("button");
    back.className = "back-btn";
    back.title = "Back to preview";
    back.innerHTML = icon("back");
    back.addEventListener("click", () => this.enterHome());
    ui.appendChild(back);

    // hidden file input for Open
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".vox";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", async () => {
      const f = this.fileInput.files?.[0];
      if (f) {
        try {
          await this.loadFromFile(f);
        } catch (err) {
          alert("Failed to open: " + (err as Error).message);
        }
      }
      this.fileInput.value = "";
    });
    ui.appendChild(this.fileInput);

    // Preview actions (home only): Remix the shown model, or Create from empty.
    const actions = document.createElement("div");
    actions.className = "preview-actions";
    const remixBtn = document.createElement("button");
    remixBtn.className = "preview-btn";
    remixBtn.innerHTML = `<span class="pa-ic">${icon("remix")}</span><span class="pa-label">Remix</span>`;
    remixBtn.addEventListener("click", () => this.enterEdit());
    const createBtn = document.createElement("button");
    createBtn.className = "preview-btn";
    createBtn.innerHTML = `<span class="pa-ic">${icon("create")}</span><span class="pa-label">Create</span>`;
    createBtn.addEventListener("click", () => this.startCreate());
    const sharePreviewBtn = document.createElement("button");
    sharePreviewBtn.className = "preview-btn";
    sharePreviewBtn.innerHTML = `<span class="pa-ic">${icon("share")}</span><span class="pa-label">Share</span>`;
    sharePreviewBtn.addEventListener("click", () => this.openShare());
    actions.append(remixBtn, createBtn, sharePreviewBtn);
    ui.appendChild(actions);

    // Share button in the editor (top-right).
    const shareEdit = document.createElement("button");
    shareEdit.className = "share-btn";
    shareEdit.title = "Share";
    shareEdit.innerHTML = icon("share");
    shareEdit.addEventListener("click", () => this.openShare());
    ui.appendChild(shareEdit);

    // Oversized rotating headline BEHIND the model (the model overlaps it).
    this.headline = document.createElement("div");
    this.headline.className = "preview-headline";
    document.getElementById("stage")!.appendChild(this.headline);
    this.shuffleHeadline();
    window.setInterval(() => {
      if (this.mode === "home") this.shuffleHeadline();
    }, 5000);

    // author info — plain text, bottom-left of the preview
    this.authorBadge = document.createElement("div");
    this.authorBadge.className = "author-badge";
    ui.appendChild(this.authorBadge);

    // help (?) button + popover
    ui.appendChild(this.buildHelp());
  }

  /** Ask to remember the name via a cookie — shown once, AFTER the first save. */
  private showCookieConsent(name: string): void {
    if (cookieConsentAnswered()) return;
    const overlay = document.createElement("div");
    overlay.className = "cookie-overlay";
    const card = document.createElement("div");
    card.className = "popup-card";
    const title = document.createElement("div");
    title.className = "popup-title";
    title.textContent = "Saved! 🍪";
    const body = document.createElement("div");
    body.className = "popup-body";
    body.textContent =
      "Want me to remember your name with a cookie, so you don't have to type it next time?";
    const actions = document.createElement("div");
    actions.className = "popup-actions";
    const yes = document.createElement("button");
    yes.className = "pill-btn primary";
    yes.textContent = "Sure";
    const no = document.createElement("button");
    no.className = "pill-btn";
    no.textContent = "No thanks";
    const close = (accepted: boolean): void => {
      setCookieConsent(accepted);
      if (accepted) setAuthorName(name); // now persists to the cookie
      overlay.remove();
    };
    yes.addEventListener("click", () => close(true));
    no.addEventListener("click", () => close(false));
    actions.append(yes, no);
    card.append(title, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  private async doExport(kind: "obj" | "glb" | "png"): Promise<void> {
    try {
      if (kind === "obj") exportOBJ(this.doc, "model");
      else if (kind === "glb") await exportGLB(this.scene.group, "model");
      else exportPNG(this.viewport, "render");
    } catch (err) {
      alert("Export failed: " + (err as Error).message);
    }
  }

  private toggleProjection(): void {
    const mode = this.viewport.projection === "pers" ? "orth" : "pers";
    this.viewport.setProjection(mode);
  }

  private async loadSampleFile(file: string): Promise<void> {
    try {
      await this.loadFromUrl(assetUrl(`samples/${file}.vox`));
      this.enterHome();
    } catch (err) {
      alert("Failed to load sample: " + (err as Error).message);
    }
  }

  private buildHelp(): HTMLElement {
    const frag = document.createElement("div");
    const btn = document.createElement("button");
    btn.className = "help-btn";
    btn.title = "Controls";
    btn.innerHTML = icon("help");
    const body = document.createElement("div");
    body.className = "help-body";
    body.style.display = "none";
    body.innerHTML = [
      "<b>Left mouse</b> — use current tool",
      "<b>Right drag</b> — orbit · <b>Middle drag</b> — pan · <b>Scroll</b> — zoom",
      "<b>H</b> — recenter camera",
      "—",
      "<b>B</b> attach · <b>E</b> remove · <b>G</b> paint · <b>F</b> fill · <b>M</b> select · <b>I</b> pick",
      "<b>Ctrl+A</b> all · <b>Ctrl+D</b> deselect · <b>Ctrl+C/V</b> copy/paste",
      "Selection: <b>arrows</b>/<b>PgUp</b>/<b>PgDn</b> move · <b>Del</b> delete",
      "—",
      "<b>Ctrl+Z</b> undo · <b>Ctrl+Shift+Z</b> redo · <b>Ctrl+S</b> download .vox",
    ]
      .map((l) => (l === "—" ? "<hr>" : `<div>${l}</div>`))
      .join("");
    btn.addEventListener("click", () => {
      body.style.display = body.style.display === "none" ? "block" : "none";
    });
    frag.append(btn, body);
    return frag;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
