import { VoxDocument } from "../core/Document";

export interface VolumeOps {
  getDoc(): VoxDocument;
  resizeActive(x: number, y: number, z: number): void;
}

/**
 * Compact volume-size panel (top-right): per-axis X/Y/Z inputs (red/green/blue)
 * for the active model, with a Set button.
 */
export class VolumePanel {
  readonly el: HTMLElement;
  private inputs: HTMLInputElement[] = [];

  constructor(private ops: VolumeOps) {
    this.el = document.createElement("div");
    this.el.className = "panel volume-panel";

    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = "Volume";
    this.el.appendChild(title);

    const row = document.createElement("div");
    row.className = "vol-row";
    const colors = ["#ff5555", "#55cc66", "#5599ff"];
    ["x", "y", "z"].forEach((axis, i) => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.max = "1024";
      inp.className = "vol-input";
      inp.title = `${axis.toUpperCase()} size`;
      inp.style.borderBottom = `2px solid ${colors[i]}`;
      inp.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") this.apply();
      });
      this.inputs[i] = inp;
      row.appendChild(inp);
    });
    const set = document.createElement("button");
    set.className = "mini-btn";
    set.textContent = "Set";
    set.title = "Resize volume";
    set.addEventListener("click", () => this.apply());
    row.appendChild(set);
    this.el.appendChild(row);

    this.render();
  }

  private apply(): void {
    const c = (v: string) => Math.min(1024, Math.max(1, Math.round(Number(v)) || 1));
    this.ops.resizeActive(c(this.inputs[0].value), c(this.inputs[1].value), c(this.inputs[2].value));
  }

  render(): void {
    const m = this.ops.getDoc().active;
    if (m && document.activeElement?.className !== "vol-input") {
      this.inputs[0].value = String(m.sizeX);
      this.inputs[1].value = String(m.sizeY);
      this.inputs[2].value = String(m.sizeZ);
    }
  }
}
