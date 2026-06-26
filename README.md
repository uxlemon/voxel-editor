# Voxel Editor

A browser-based voxel editor inspired by MagicaVoxel, built with **Vite + TypeScript + Three.js**. It reads and writes the standard MagicaVoxel `.vox` format and exports meshes for **Blender** and **Roblox**.

This is original code — not a port or decompilation of MagicaVoxel. It uses the public `.vox` file format for compatibility.

## Run

```bash
npm install      # if registry is slow, see note below
npm run dev      # http://localhost:5173 (or the port Vite prints)
```

Production build:

```bash
npm run build && npm run preview
```

> npm registry note: if `npm install` hangs on an internal registry, use
> `npm install --registry https://registry.npmjs.org/ --cache "$TMPDIR/npm-cache-voxel"`.

## Features

- **Edit tools** — Attach, Erase, Paint, Eyedropper, Box, Line, Fill (flood), Select
- **Brush size** and **mirror** (X/Y/Z) for symmetric modeling
- **Selection** — box-select, then move (arrows / PgUp / PgDn), Delete, duplicate (Ctrl+D)
- **256-color palette** with live color editing
- **Undo / redo** (full history, ⌘/Ctrl+Z, Shift to redo)
- **Layers** — show/hide, rename, multiple layers
- **World / multi-model** — multiple objects placed in a scene
- **`.vox` open & save** — round-trips real MagicaVoxel files exactly
- **Render mode** — baked ambient occlusion, soft shadows, image-based lighting, tone mapping
- **Autosave** to the browser (localStorage) so work survives a refresh

## Controls

| Action | Input |
|--------|-------|
| Use current tool | **Left mouse** (click or drag) |
| Orbit camera | **Right-drag** |
| Pan | **Middle-drag** |
| Zoom | **Scroll** |
| Frame model | **H** |
| Tools | **B** attach · **E** erase · **G** paint · **I** pick · **X** box · **L** line · **F** fill · **M** select |
| Box/Line erase | hold **Alt** while dragging |
| Undo / Redo / Save | **Ctrl+Z** / **Ctrl+Shift+Z** / **Ctrl+S** |

A collapsible **Controls** cheat-sheet is in the bottom-right of the app.

## Exporting

Use the **Export…** dropdown in the menu bar.

### Blender
- **`.glb`** (recommended): `File ▸ Import ▸ glTF 2.0` — single file, colors baked as vertex colors.
- **`.obj` + `.mtl`**: `File ▸ Import ▸ Wavefront (.obj)` — keep the `.obj` and `.mtl` together; each palette color becomes a material.

In Blender, to render the blocky look crisp, set the material to **Flat / no interpolation** and (optionally) add a Decimate or keep as-is — the mesh is already face-culled.

### Roblox Studio
- Export **`.obj` + `.mtl`**.
- In Studio: insert a **MeshPart**, set its `MeshId` to the imported `.obj`, or use **3D Importer** (`File menu ▸ Import 3D`) and select the `.obj`. The importer reads the `.mtl` for per-color materials.
- Voxels are 1 unit each; scale the MeshPart in Studio to taste. Hidden interior faces are already removed, keeping triangle counts low.

### Screenshot
- **`.png`** exports the current viewport (turn on **Render** first for the nicer lit look).

## Project layout

```
src/
  core/      VoxelModel, Document (models + placements + layers), palette
  io/        voxParser, voxWriter (.vox), exporters (.obj/.glb/.png)
  render/    Viewport (Three.js scene), SceneRenderer, mesher (face culling + AO)
  edit/      Editor (tools, raycasting, cursor), commands (undo/redo)
  ui/        Toolbar, PalettePanel, ScenePanel
  app/       App (wires everything together)
scripts/     headless test harnesses (Playwright + puppeteer-core)
```

## Tests

Headless browser checks drive the real app through Chrome:

```bash
node scripts/usability.mjs        # Playwright: full feature + usability suite (21 checks)
node scripts/shot.mjs <url> out.png   # screenshot + .vox round-trip self-test
```

## Coordinate system

The data model is **Z-up** (matching `.vox`). The renderer maps model `(x, y, z)` to
Three.js `(x, z, y)` so models stand upright; exports are emitted **Y-up** for Blender/Roblox.
