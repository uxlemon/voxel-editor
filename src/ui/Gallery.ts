import { galleryStore, CreationRecord } from "../store/galleryStore";

/**
 * The community grid shown beneath the stage. Lists saved creations (newest
 * first) with a thumbnail, name and author. Clicking a tile asks the host to
 * open it in the preview (for viewing / remixing).
 */
export class Gallery {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private currentId: string | null = null;

  constructor(
    private onOpen: (rec: CreationRecord) => void,
    private onHover?: (rec: CreationRecord | null) => void
  ) {
    this.el = document.createElement("section");
    this.el.className = "gallery";

    const header = document.createElement("div");
    header.className = "gallery-header";
    header.innerHTML = `<h2>Community creations</h2>`;
    this.el.appendChild(header);

    this.grid = document.createElement("div");
    this.grid.className = "gallery-grid";
    this.el.appendChild(this.grid);

    // Revert the hover-preview only when leaving the whole list (not when
    // crossing the gaps between tiles).
    this.el.addEventListener("mouseleave", () => this.onHover?.(null));
  }

  /** Highlight the creation currently shown in the preview. */
  setCurrent(id: string | null): void {
    this.currentId = id;
    for (const t of Array.from(this.grid.children)) {
      const el = t as HTMLElement;
      el.classList.toggle("current", !!id && el.dataset.id === id);
    }
  }

  async refresh(): Promise<void> {
    let recs: CreationRecord[] = [];
    try {
      recs = await galleryStore.list();
    } catch {
      /* ignore */
    }
    this.grid.innerHTML = "";
    if (recs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent = "No creations yet — be the first to save one!";
      this.grid.appendChild(empty);
      return;
    }
    for (const rec of recs) this.grid.appendChild(this.tile(rec));
  }

  /** Add or move a record to the front without a full reload. */
  prepend(rec: CreationRecord): void {
    const existing = this.grid.querySelector(`[data-id="${cssEscape(rec.id)}"]`);
    if (existing) existing.remove();
    const empty = this.grid.querySelector(".gallery-empty");
    if (empty) empty.remove();
    this.grid.prepend(this.tile(rec));
  }

  private tile(rec: CreationRecord): HTMLElement {
    const tile = document.createElement("button");
    tile.className = "tile";
    if (rec.id === this.currentId) tile.classList.add("current");
    tile.dataset.id = rec.id;
    tile.title = `by ${rec.author}`;

    const thumb = document.createElement("div");
    thumb.className = "tile-thumb";
    if (rec.thumb) thumb.style.backgroundImage = `url(${rec.thumb})`;

    tile.append(thumb);
    tile.addEventListener("click", () => this.onOpen(rec));
    tile.addEventListener("mouseenter", () => this.onHover?.(rec));
    return tile;
  }
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
