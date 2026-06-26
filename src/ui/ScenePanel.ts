import { VoxDocument } from "../core/Document";

export interface SceneOps {
  getDoc(): VoxDocument;
  isWorldView(): boolean;
  isShowOthers(): boolean;
  setActiveObject(modelId: number): void;
  setWorldView(): void;
  toggleShowOthers(): void;
  addObject(): void;
  deleteObject(modelId: number): void;
}

/**
 * Left-side panel: editable volume size, and the list of objects (model
 * instances). The first row, "All", selects a read-only world view that shows
 * every object. A "Show others" toggle displays the other objects as context
 * while editing one. Rebuilt via {@link render} when the document changes.
 */
export class ScenePanel {
  readonly el: HTMLElement;
  private objectsEl: HTMLElement;
  private othersBtn!: HTMLButtonElement;

  constructor(private ops: SceneOps) {
    this.el = document.createElement("div");
    this.el.className = "panel scene-panel";

    // Objects
    const objHeader = section("Objects");
    this.othersBtn = miniAction("Others", "Show other objects while editing", (e) => {
      e.stopPropagation();
      this.ops.toggleShowOthers();
    });
    this.othersBtn.classList.add("wide-mini");
    const addObj = miniAction("+", "Add object", () => this.ops.addObject());
    objHeader.append(this.othersBtn, addObj);
    this.el.appendChild(objHeader);
    this.objectsEl = document.createElement("div");
    this.objectsEl.className = "scene-list";
    this.el.appendChild(this.objectsEl);

    this.render();
  }

  render(): void {
    const doc = this.ops.getDoc();
    const worldView = this.ops.isWorldView();
    this.othersBtn.classList.toggle("active", this.ops.isShowOthers());
    this.othersBtn.style.display = worldView ? "none" : "";

    this.objectsEl.innerHTML = "";

    // "All" world-view row
    const allRow = document.createElement("div");
    allRow.className = "scene-row";
    if (worldView) allRow.classList.add("active");
    const allName = document.createElement("span");
    allName.className = "scene-row-name";
    allName.textContent = "All (world view)";
    allRow.appendChild(allName);
    allRow.addEventListener("click", () => this.ops.setWorldView());
    this.objectsEl.appendChild(allRow);

    doc.placements.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "scene-row";
      if (!worldView && p.modelId === doc.activeModel) row.classList.add("active");
      const m = doc.models[p.modelId];
      const name = document.createElement("span");
      name.className = "scene-row-name";
      name.textContent = p.name || `object ${i}`;
      const meta = document.createElement("span");
      meta.className = "scene-row-meta";
      meta.textContent = m ? `${m.count}` : "0";
      row.append(name, meta);
      row.addEventListener("click", () => this.ops.setActiveObject(p.modelId));
      if (doc.placements.length > 1) {
        const del = miniAction("×", "Delete object", (e) => {
          e.stopPropagation();
          this.ops.deleteObject(p.modelId);
        });
        row.appendChild(del);
      }
      this.objectsEl.appendChild(row);
    });
  }
}

function section(title: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "scene-header";
  const t = document.createElement("span");
  t.textContent = title;
  h.appendChild(t);
  return h;
}

function miniAction(
  label: string,
  title: string,
  onClick: (e: MouseEvent) => void
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "mini-btn";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}
