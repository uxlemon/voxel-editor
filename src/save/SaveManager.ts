import { VoxDocument } from "../core/Document";
import { galleryStore, CreationRecord, newId } from "../store/galleryStore";
import { validateAuthorName, NAME_MAX } from "../util/validation";
import { getAuthorName, setAuthorName } from "../util/cookies";

/**
 * Owns the bottom-center status pill and the friendly "Save" popup, plus
 * the dirty/save lifecycle. Pill states:
 *   hidden  → no unsaved work
 *   dirty   → unsaved modifications: shows Save / Discard
 *   saving  → spinning cube + "Saving…"
 *   saved   → static cube + "Saved"
 * Pressing Save collects a name, writes to the simulated server,
 * then keeps autosaving silently. Discard asks the host to load a fresh preset.
 */

export interface SaveHost {
  getDoc(): VoxDocument;
  /** PNG data URL of the current document. */
  renderThumb(): string;
  /** raw .vox bytes of the current document. */
  voxBytes(): ArrayBuffer;
  /** true when there is undoable history (i.e. a real modification exists). */
  hasUndo(): boolean;
  /** persist the "local work is modified" flag for crash/refresh recovery. */
  setModifiedFlag(modified: boolean): void;
  /** a new server record was saved — prepend it to the gallery + update UI. */
  onServerSaved(rec: CreationRecord): void;
  /** the user discarded unsaved work — load a fresh random preset. */
  onDiscard(): void;
}

interface BaselineOpts {
  parentId?: string | null;
  suggestedName?: string;
  dirty?: boolean;
  serverBacked?: boolean;
  recordId?: string | null;
}

export class SaveManager {
  // pill
  private pill: HTMLElement;
  private pillCube: HTMLElement;
  private pillText: HTMLElement;
  private pillActions: HTMLElement;
  // popup
  private popup: HTMLElement;
  private nameInput!: HTMLInputElement;
  private popupError!: HTMLElement;
  private popupTitle!: HTMLElement;
  private popupBody!: HTMLElement;

  // state
  private parentId: string | null = null;
  private suggestedName = "Creation";
  private currentRecordId: string | null = null;
  private serverBacked = false;
  private dirty = false;
  private baselineCount = 0;
  private ops = 0;
  private nudged = false;
  private timer = 0;
  private autosaveTimer = 0;

  // tuning (exposed for tests via window.__app)
  NUDGE_MS = 3 * 60 * 1000;
  CHANGE_RATIO = 0.15;
  CHANGE_OPS = 10;

  constructor(private host: SaveHost, mount: HTMLElement) {
    this.pill = document.createElement("div");
    this.pill.className = "save-pill hidden";
    this.pillCube = document.createElement("span");
    this.pillCube.className = "cube";
    this.pillCube.innerHTML = "<i></i><i></i><i></i><i></i><i></i><i></i>";
    this.pillText = document.createElement("span");
    this.pillText.className = "save-pill-text";
    this.pillActions = document.createElement("span");
    this.pillActions.className = "save-pill-actions";
    this.pill.append(this.pillCube, this.pillText, this.pillActions);
    mount.appendChild(this.pill);

    // The popup is a full-screen fixed overlay — mount it on <body>, NOT inside
    // the dock (the dock's transform would make `position:fixed` resolve to the
    // dock's box, shrinking the overlay to a gray sliver).
    this.popup = this.buildPopup();
    document.body.appendChild(this.popup);
  }

  /** Called whenever a new document is loaded (preset, gallery open, restore). */
  onBaseline(opts: BaselineOpts = {}): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    if (this.autosaveTimer) { clearTimeout(this.autosaveTimer); this.autosaveTimer = 0; }
    this.parentId = opts.parentId ?? null;
    this.suggestedName = opts.suggestedName ?? "Creation";
    this.serverBacked = !!opts.serverBacked;
    this.currentRecordId = opts.recordId ?? null;
    this.baselineCount = this.countVoxels();
    this.ops = 0;
    this.nudged = false;
    this.dirty = !!opts.dirty;
    this.closePopup();
    if (this.dirty) {
      this.showDirty();
      this.armNudge();
    } else if (this.serverBacked) {
      this.setSaved();
    } else {
      this.hidePill();
    }
  }

  /** Called on every history change (real edit or a history clear). */
  markEdited(): void {
    const hasMods = this.host.hasUndo();
    if (!hasMods) {
      // fully undone or a programmatic clear — treat as clean
      if (this.dirty && !this.serverBacked) {
        this.dirty = false;
        this.host.setModifiedFlag(false);
        this.hidePill();
      }
      return;
    }
    this.dirty = true;
    this.ops++;
    this.host.setModifiedFlag(true);
    if (this.serverBacked) {
      this.scheduleAutosave();
    } else {
      this.showDirty();
      this.armNudge();
    }
  }

  get author(): string {
    return getAuthorName();
  }

  /** The server id of the current creation, or null if not yet saved. */
  get recordId(): string | null {
    return this.serverBacked ? this.currentRecordId : null;
  }

  /** Open the name popup (used by Share when the creation isn't saved yet). */
  promptSave(): void {
    this.openPopup(false);
  }

  /** State the host persists to localStorage for refresh/crash recovery. */
  getPersistMeta(): {
    dirty: boolean;
    parentId: string | null;
    serverBacked: boolean;
    recordId: string | null;
    suggestedName: string;
  } {
    return {
      dirty: this.dirty,
      parentId: this.parentId,
      serverBacked: this.serverBacked,
      recordId: this.currentRecordId,
      suggestedName: this.suggestedName,
    };
  }

  // --- nudge popup ---
  private armNudge(): void {
    if (this.timer || this.nudged || this.serverBacked) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.serverBacked || !this.dirty || this.nudged) return;
      if (this.enoughChange()) this.openPopup(true);
    }, this.NUDGE_MS);
  }

  private enoughChange(): boolean {
    const ratio = Math.abs(this.countVoxels() - this.baselineCount) / Math.max(this.baselineCount, 64);
    return this.ops >= this.CHANGE_OPS || ratio >= this.CHANGE_RATIO;
  }

  private countVoxels(): number {
    return this.host.getDoc().models.reduce((s, m) => s + m.count, 0);
  }

  // --- pill rendering ---
  private hidePill(): void {
    this.pill.className = "save-pill hidden";
  }

  private showDirty(): void {
    this.pill.className = "save-pill dirty";
    this.pillCube.classList.remove("spinning");
    this.pillText.textContent = "Unsaved changes";
    this.pillActions.innerHTML = "";
    const save = document.createElement("button");
    save.className = "pill-btn primary";
    save.textContent = "Save";
    save.addEventListener("click", () => this.requestSave());
    const discard = document.createElement("button");
    discard.className = "pill-btn";
    discard.textContent = "Discard";
    discard.addEventListener("click", () => this.discard());
    this.pillActions.append(save, discard);
  }

  private setSaving(): void {
    this.pill.className = "save-pill saving";
    this.pillCube.classList.add("spinning");
    this.pillText.textContent = "Saving…";
    this.pillActions.innerHTML = "";
  }

  private setSaved(): void {
    this.pill.className = "save-pill saved";
    this.pillCube.classList.remove("spinning");
    this.pillText.textContent = "Saved";
    this.pillActions.innerHTML = "";
  }

  // --- save / discard ---
  /** Save entry point (pill button or popup confirm). */
  private requestSave(): void {
    if (this.serverBacked) {
      void this.commit(this.author);
      return;
    }
    this.openPopup(false);
  }

  private discard(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    this.dirty = false;
    this.host.setModifiedFlag(false);
    this.hidePill();
    this.host.onDiscard();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = 0;
      void this.commit(this.author);
    }, 1500);
  }

  /** Write the current document to the simulated server. */
  private async commit(author: string): Promise<void> {
    const v = validateAuthorName(author);
    if (!v.ok) {
      // shouldn't happen for autosave (author already validated), but guard
      this.openPopup(false);
      return;
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    this.setSaving();
    const now = Date.now();
    const id = this.currentRecordId ?? newId();
    const isNew = !this.serverBacked;
    const rec: CreationRecord = {
      id,
      name: this.suggestedName,
      author,
      voxBytes: this.host.voxBytes(),
      thumb: this.host.renderThumb(),
      parentId: this.parentId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await galleryStore.put(rec);
      this.currentRecordId = id;
      this.serverBacked = true;
      this.dirty = false;
      this.host.setModifiedFlag(false);
      if (isNew) this.host.onServerSaved(rec);
      this.setSaved();
    } catch (e) {
      this.pillText.textContent = (e as Error).message || "Save failed";
      this.pill.className = "save-pill dirty";
      this.pillCube.classList.remove("spinning");
      // restore Save/Discard so the user can retry
      this.showDirty();
      this.pillText.textContent = (e as Error).message || "Save failed";
    }
  }

  // --- popup ---
  private buildPopup(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "popup-overlay hidden";

    const card = document.createElement("div");
    card.className = "popup-card";

    this.popupTitle = document.createElement("div");
    this.popupTitle.className = "popup-title";

    this.popupBody = document.createElement("div");
    this.popupBody.className = "popup-body";

    const field = document.createElement("div");
    field.className = "popup-field";
    const lbl = document.createElement("label");
    lbl.textContent = "Your name";
    this.nameInput = document.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.placeholder = "e.g. Alex";
    this.nameInput.value = this.author;
    this.nameInput.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.confirmPopup();
    });
    field.append(lbl, this.nameInput);

    this.popupError = document.createElement("div");
    this.popupError.className = "popup-error";

    const actions = document.createElement("div");
    actions.className = "popup-actions";
    const keep = document.createElement("button");
    keep.className = "pill-btn primary";
    keep.textContent = "Save";
    keep.addEventListener("click", () => this.confirmPopup());
    const nah = document.createElement("button");
    nah.className = "pill-btn";
    nah.textContent = "Nah";
    nah.addEventListener("click", () => {
      this.nudged = true; // don't auto-nudge again this load
      this.closePopup();
    });
    actions.append(keep, nah);

    card.append(this.popupTitle, this.popupBody, field, this.popupError, actions);
    overlay.appendChild(card);
    return overlay;
  }

  private openPopup(fromNudge: boolean): void {
    if (fromNudge) this.nudged = true;
    // Auto-nudge greets the user; a user-initiated Save just asks for a name.
    if (fromNudge) {
      this.popupTitle.textContent = "Hey, nice creation! 👋";
      this.popupBody.textContent =
        "Do you want to save it so others can view it? You can keep editing either way.";
    } else {
      this.popupTitle.textContent = "What's your name?";
      this.popupBody.textContent =
        "Add a name so others can see who made it. You can keep editing either way.";
    }
    this.popupError.textContent = "";
    this.nameInput.value = this.author;
    this.popup.classList.remove("hidden");
    this.nameInput.focus();
    this.nameInput.select();
  }

  private closePopup(): void {
    this.popup.classList.add("hidden");
  }

  private confirmPopup(): void {
    const name = this.nameInput.value;
    const v = validateAuthorName(name);
    if (!v.ok) {
      this.popupError.textContent = v.reason ?? "Invalid name.";
      return;
    }
    const clean = name.trim().replace(/\s+/g, " ");
    setAuthorName(clean);
    this.closePopup();
    void this.commit(clean);
  }
}
