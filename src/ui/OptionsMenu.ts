import { icon } from "./icons";

/**
 * Small floating top-left bar: a logo placeholder + chevron that toggles a
 * dropdown holding the actions that used to live on the menu bar (New, Open,
 * Save, Export, camera projection, recenter, samples) plus the Advanced toggle.
 */
export interface OptionsHost {
  newDoc(): void;
  openFile(): void;
  saveVox(): void;
  exportAs(kind: "obj" | "glb" | "png"): void;
  toggleProjection(): void;
  projectionLabel(): string; // "Perspective" | "Orthographic"
  recenter(): void;
  loadSample(file: string): void;
  isAdvanced(): boolean;
  isAdvancedLocked(): boolean;
  setAdvanced(on: boolean): void;
}

export class OptionsMenu {
  readonly el: HTMLElement;
  private menu: HTMLElement;
  private open = false;

  constructor(private host: OptionsHost) {
    this.el = document.createElement("div");
    this.el.className = "logo-bar";

    const logo = document.createElement("button");
    logo.className = "logo-btn";
    logo.title = "Menu";
    logo.innerHTML = icon("chevron");
    logo.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.el.appendChild(logo);

    this.menu = document.createElement("div");
    this.menu.className = "options-menu hidden";
    this.el.appendChild(this.menu);

    document.addEventListener("click", () => this.close());
    this.menu.addEventListener("click", (e) => e.stopPropagation());

    this.build();
  }

  private toggle(): void {
    this.open = !this.open;
    this.menu.classList.toggle("hidden", !this.open);
    if (this.open) this.build(); // refresh dynamic labels/toggles
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.menu.classList.add("hidden");
  }

  private item(iconName: string, label: string, onClick: () => void): HTMLElement {
    const b = document.createElement("button");
    b.className = "menu-item";
    b.innerHTML = `<span class="menu-ic">${icon(iconName)}</span><span>${label}</span>`;
    b.addEventListener("click", () => {
      onClick();
      this.close();
    });
    return b;
  }

  private sep(): HTMLElement {
    const s = document.createElement("div");
    s.className = "menu-sep";
    return s;
  }

  private build(): void {
    this.menu.innerHTML = "";
    this.menu.append(
      this.item("new", "New", () => this.host.newDoc()),
      this.item("open", "Open .vox", () => this.host.openFile()),
      this.item("save", "Save .vox", () => this.host.saveVox()),
      this.sep(),
      this.item("export", "Export .obj", () => this.host.exportAs("obj")),
      this.item("export", "Export .glb", () => this.host.exportAs("glb")),
      this.item("export", "Export .png", () => this.host.exportAs("png")),
      this.sep(),
      this.item("camera", `Camera: ${this.host.projectionLabel()}`, () => this.host.toggleProjection()),
      this.sep()
    );

    // Advanced toggle (lockable)
    const adv = document.createElement("button");
    adv.className = "menu-item toggle";
    const on = this.host.isAdvanced();
    const locked = this.host.isAdvancedLocked();
    adv.innerHTML =
      `<span class="menu-ic">${icon("advanced")}</span>` +
      `<span>Advanced</span>` +
      `<span class="switch ${on ? "on" : ""}"></span>`;
    if (locked) {
      adv.classList.add("locked");
      adv.disabled = true;
      adv.title = "On — this creation has multiple objects";
    } else {
      adv.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.setAdvanced(!this.host.isAdvanced());
        this.build();
      });
    }
    this.menu.appendChild(adv);
  }
}
