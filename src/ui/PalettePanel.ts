import { Editor } from "../edit/Editor";
import { VoxDocument } from "../core/Document";
import { Palette, rgbaToHex, hexToRGBA } from "../core/palette";
import { icon } from "./icons";

/**
 * Palette panel laid out like MagicaVoxel: 8 columns x 32 rows of the 256
 * palette slots. The slots are arranged for readability by a hue sweep (dark
 * neutrals on top, then a red->magenta->...->orange rainbow, then light
 * neutrals and white at the bottom) — this is display order only; the palette
 * indices the voxels reference are unchanged. Slot 0 is the empty slot.
 *
 * Below the grid is a "Colors in use" section listing the palette indices that
 * actually appear in the active model, each clickable to select.
 */

const COLS = 8;
const ROWS = 32;

/**
 * Curated 32-color "basic" palette: a vibrant row and a matching pastel row,
 * including browns. Selecting one reuses an existing palette index of that
 * color or writes it to a free index, so loaded models are never recolored.
 */
const CURATED: string[] = [
  // vibrant (16)
  "#111111", "#8a909c", "#e2483d", "#f2772e", "#f5a623", "#f5d536", "#5fbf5a", "#2fb89e",
  "#46c7e8", "#4a90e2", "#6c63e0", "#9b59b6", "#e85aa0", "#a9743f", "#6e4a2f", "#ffffff",
  // pastel (16)
  "#c9cdd6", "#e7e9ee", "#f6b8b2", "#fbcfa3", "#fde2a8", "#fbeeb0", "#c6e9c2", "#b6e6dc",
  "#c2ebf6", "#c2dbf6", "#cfccf3", "#e0c8ec", "#f6c2dd", "#d8b48c", "#c9a079", "#f3f4f7",
];

/** RGB(0..255) -> {h:0..360, s:0..1, l:0..1}. */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

/**
 * Compute the display order: an array of 256 palette indices read top-left to
 * bottom-right. Neutrals split to top (dark) and bottom (light); chromatic
 * colors sweep by descending hue so red sits near the top and orange near the
 * bottom — matching MagicaVoxel's panel.
 */
function computeDisplayOrder(pal: Palette): number[] {
  const neutralDark: number[] = [];
  const neutralLight: number[] = [];
  const chroma: Array<{ i: number; h: number; l: number }> = [];
  for (let i = 1; i < 256; i++) {
    const c = pal.get(i);
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    if (s < 0.12) {
      (l < 0.5 ? neutralDark : neutralLight).push(i);
    } else {
      chroma.push({ i, h, l });
    }
  }
  neutralDark.sort((a, b) => lum(pal, a) - lum(pal, b));
  neutralLight.sort((a, b) => lum(pal, a) - lum(pal, b));
  // hue descending (red 360 -> magenta -> ... -> orange -> red 0); within a hue
  // band, lighter to the right by lightness
  chroma.sort((a, b) => b.h - a.h || a.l - b.l);
  const order = [
    ...neutralDark,
    ...chroma.map((c) => c.i),
    ...neutralLight,
    0, // empty slot last
  ];
  return order.slice(0, COLS * ROWS);
}

function lum(pal: Palette, i: number): number {
  const c = pal.get(i);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

export class PalettePanel {
  readonly el: HTMLElement;
  private swatches = new Map<number, HTMLButtonElement>(); // index -> button
  private picker: HTMLInputElement;
  private inUseEl: HTMLElement;
  private gridEl: HTMLElement;
  private pickBtn: HTMLButtonElement;
  private basicButtons: Array<{ hex: string; btn: HTMLButtonElement }> = [];
  /** basic = curated ~32 colors; full = all 256 (Advanced mode). */
  private mode: "basic" | "full" = "basic";

  constructor(
    private editor: Editor,
    private getDoc: () => VoxDocument,
    private onPaletteChange: () => void,
    private onPickTool?: () => void
  ) {
    this.el = document.createElement("div");
    this.el.className = "panel palette-panel";

    this.gridEl = document.createElement("div");
    this.gridEl.className = "palette-grid";
    this.el.appendChild(this.gridEl);
    this.renderGrid();

    const editorRow = document.createElement("div");
    editorRow.className = "palette-editor";
    this.picker = document.createElement("input");
    this.picker.type = "color";
    this.picker.title = "Edit selected color";
    this.picker.addEventListener("input", () => this.applyColor());
    // Pick (eyedropper) tool lives here, next to the color editor.
    this.pickBtn = document.createElement("button");
    this.pickBtn.className = "mini-btn icon-btn";
    this.pickBtn.innerHTML = icon("eyedropper");
    this.pickBtn.title = "Pick color (I)";
    this.pickBtn.addEventListener("click", () => this.onPickTool?.());
    editorRow.append(this.pickBtn, this.picker);
    this.el.appendChild(editorRow);

    // Colors in use
    const inUseTitle = document.createElement("div");
    inUseTitle.className = "panel-subtitle";
    inUseTitle.textContent = "Colors in use";
    this.el.appendChild(inUseTitle);
    this.inUseEl = document.createElement("div");
    this.inUseEl.className = "inuse-grid";
    this.el.appendChild(this.inUseEl);

    this.refresh();
    this.select(this.editor.color);
  }

  /** Switch between the curated 32-color palette and the full 256-color grid. */
  setMode(mode: "basic" | "full"): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.renderGrid();
    this.refresh();
    this.select(this.editor.color);
  }

  /** Reflect the eyedropper tool's active state on the Pick button. */
  setPickActive(active: boolean): void {
    this.pickBtn.classList.toggle("active", active);
  }

  /** (Re)build the swatch grid for the current mode. */
  private renderGrid(): void {
    const pal = this.getDoc().palette;
    this.gridEl.innerHTML = "";
    this.swatches.clear();
    this.basicButtons = [];
    this.gridEl.classList.toggle("basic", this.mode === "basic");
    this.el.classList.toggle("full-mode", this.mode === "full");

    if (this.mode === "basic") {
      for (const hex of CURATED) {
        const b = document.createElement("button");
        b.className = "swatch";
        b.style.background = hex;
        b.title = hex;
        b.addEventListener("click", () => this.selectCurated(hex));
        this.gridEl.appendChild(b);
        this.basicButtons.push({ hex: hex.toLowerCase(), btn: b });
      }
      return;
    }

    for (const index of computeDisplayOrder(pal)) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.dataset.index = String(index);
      if (index === 0) {
        b.classList.add("empty"); // eraser / empty slot
        b.title = "empty";
      } else {
        b.title = `#${index}`;
        b.addEventListener("click", () => this.select(index));
      }
      this.gridEl.appendChild(b);
      this.swatches.set(index, b);
    }
  }

  /** Repaint full-mode swatches; refresh highlight + colors-in-use. */
  refresh(): void {
    const pal = this.getDoc().palette;
    for (const [i, b] of this.swatches) {
      if (i >= 1) b.style.background = rgbaToHex(pal.get(i));
    }
    this.updateHighlight();
    this.updateInUse();
  }

  /**
   * Select a curated color without recoloring the model: reuse an existing
   * palette index of that exact color, otherwise write it to a free index.
   */
  private selectCurated(hex: string): void {
    const pal = this.getDoc().palette;
    const want = hex.toLowerCase();
    let idx = -1;
    for (let i = 1; i < 256; i++) {
      if (rgbaToHex(pal.get(i)).toLowerCase() === want) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      const used = new Set<number>();
      this.getDoc().active?.forEach((_x, _y, _z, c) => used.add(c));
      for (let i = 1; i < 256; i++) {
        if (!used.has(i)) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = this.editor.color || 1;
      pal.set(idx, hexToRGBA(hex, 255));
      this.onPaletteChange();
    }
    this.select(idx);
  }

  select(index: number): void {
    if (index < 1) return;
    this.editor.color = index;
    this.updateHighlight();
    this.picker.value = rgbaToHex(this.getDoc().palette.get(index));
  }

  /** Highlight the swatch matching the current color (by index, or by hex). */
  private updateHighlight(): void {
    if (this.mode === "full") {
      for (const [i, b] of this.swatches) b.classList.toggle("selected", i === this.editor.color);
    } else {
      const cur = rgbaToHex(this.getDoc().palette.get(this.editor.color)).toLowerCase();
      for (const { hex, btn } of this.basicButtons) btn.classList.toggle("selected", hex === cur);
    }
  }

  /** Rebuild the "colors in use" row from the active model. */
  updateInUse(): void {
    const doc = this.getDoc();
    const model = doc.active;
    const used = new Set<number>();
    model?.forEach((_x, _y, _z, c) => used.add(c));
    const sorted = [...used].filter((c) => c > 0).sort((a, b) => a - b);

    this.inUseEl.innerHTML = "";
    if (sorted.length === 0) {
      const empty = document.createElement("span");
      empty.className = "inuse-empty";
      empty.textContent = "—";
      this.inUseEl.appendChild(empty);
      return;
    }
    for (const i of sorted) {
      const b = document.createElement("button");
      b.className = "swatch inuse-swatch";
      b.style.background = rgbaToHex(doc.palette.get(i));
      b.title = `#${i}`;
      if (i === this.editor.color) b.classList.add("selected");
      b.addEventListener("click", () => this.select(i));
      this.inUseEl.appendChild(b);
    }
  }

  private applyColor(): void {
    const idx = this.editor.color;
    const rgba = hexToRGBA(this.picker.value, 255);
    this.getDoc().palette.set(idx, rgba);
    const b = this.swatches.get(idx);
    if (b) b.style.background = rgbaToHex(rgba);
    this.onPaletteChange();
    this.updateInUse();
  }
}
