import { Editor, Tool } from "../edit/Editor";
import { icon } from "./icons";

interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
}

// Pick (eyedropper) lives in the palette panel, not here.
const TOOLS: ToolDef[] = [
  { tool: "select", label: "Select", key: "M" },
  { tool: "attach", label: "Attach", key: "B" },
  { tool: "erase", label: "Remove", key: "E" },
  { tool: "paint", label: "Paint", key: "G" },
  { tool: "fill", label: "Fill", key: "F" },
];

/**
 * Left-hand toolbar: tool selection, brush size, and (for Select) flip + mode.
 * Keeps button highlight state in sync with the editor.
 */
export class Toolbar {
  readonly el: HTMLElement;
  private buttons = new Map<Tool, HTMLButtonElement>();
  private selectMenu!: HTMLElement;
  private flipRow!: HTMLElement;
  private selectModeBtns = new Map<"box" | "rect" | "color", HTMLButtonElement>();

  constructor(
    private editor: Editor,
    private onToolChange?: () => void,
    private onRecenter?: () => void
  ) {
    this.el = document.createElement("div");
    this.el.className = "panel toolbar";

    const tools = document.createElement("div");
    tools.className = "tool-group";
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.className = "tool-btn icon-btn";
      b.innerHTML = icon(t.tool);
      b.title = `${t.label} (${t.key})`;
      // Click an already-active tool to deselect it (back to orbit/no-tool).
      b.addEventListener("click", () =>
        this.setTool(this.editor.tool === t.tool ? "none" : t.tool)
      );
      this.buttons.set(t.tool, b);
      // The Select button carries a chevron that opens a mode menu.
      tools.appendChild(t.tool === "select" ? this.buildSelectControl(b) : b);
    }
    this.el.appendChild(tools);

    // Recenter camera — a standalone button to the right of the tools.
    const camRow = document.createElement("div");
    camRow.className = "tool-row";
    const recenter = document.createElement("button");
    recenter.className = "mini-btn icon-btn";
    recenter.innerHTML = icon("recenter");
    recenter.title = "Recenter camera (H)";
    recenter.addEventListener("click", () => this.onRecenter?.());
    camRow.appendChild(recenter);
    this.el.appendChild(camRow);

    // Close the select-mode menu on any outside click.
    document.addEventListener("click", () => this.closeSelectMenu());

    // Flip selection (creates a mirrored copy) — shown for the Select tool
    this.flipRow = document.createElement("div");
    this.flipRow.className = "tool-row select-row";
    const fl = document.createElement("span");
    fl.textContent = "Flip";
    this.flipRow.appendChild(fl);
    for (const axis of ["x", "y", "z"] as const) {
      const b = document.createElement("button");
      b.className = "mini-btn";
      b.textContent = axis.toUpperCase();
      b.title = `Mirror the selection across ${axis.toUpperCase()} (adds a flipped copy)`;
      b.addEventListener("click", () => editor.flipSelection(axis));
      this.flipRow.appendChild(b);
    }
    this.el.appendChild(this.flipRow);

    this.setSelectMode(editor.selectMode);

    this.setTool(editor.tool);

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) this.setTool(t.tool);
    });
  }

  /** Build the Select tool button wrapped with a chevron + mode dropdown. */
  private buildSelectControl(btn: HTMLButtonElement): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "tool-with-menu";
    wrap.appendChild(btn);

    const chev = document.createElement("button");
    chev.className = "tool-chevron";
    chev.innerHTML = icon("chevron");
    chev.title = "Select mode";
    chev.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSelectMenu();
    });
    wrap.appendChild(chev);

    this.selectMenu = document.createElement("div");
    this.selectMenu.className = "select-menu hidden";
    const modes: Array<["box" | "rect" | "color", string]> = [
      ["rect", "Rectangle"],
      ["box", "Box"],
      ["color", "Same color"],
    ];
    for (const [mode, label] of modes) {
      const item = document.createElement("button");
      item.className = "select-menu-item";
      item.innerHTML = `<span class="menu-ic">${icon(mode)}</span><span>${label}</span>`;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setTool("select");
        this.setSelectMode(mode);
        this.closeSelectMenu();
      });
      this.selectMenu.appendChild(item);
      this.selectModeBtns.set(mode, item);
    }
    wrap.appendChild(this.selectMenu);
    return wrap;
  }

  private toggleSelectMenu(): void {
    this.selectMenu.classList.toggle("hidden");
  }
  private closeSelectMenu(): void {
    this.selectMenu?.classList.add("hidden");
  }

  setTool(tool: Tool): void {
    this.editor.tool = tool;
    this.editor.hideCursor();
    this.editor.applyToolMode();
    for (const [t, b] of this.buttons) b.classList.toggle("active", t === tool);
    const sel = tool === "select";
    this.flipRow.style.display = sel ? "" : "none";
    if (!sel) this.closeSelectMenu();
    this.onToolChange?.();
  }

  setSelectMode(mode: "box" | "rect" | "color"): void {
    this.editor.selectMode = mode;
    this.editor.hideCursor();
    for (const [m, b] of this.selectModeBtns) b.classList.toggle("active", m === mode);
  }
}
