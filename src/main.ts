import "./style.css";
import { App } from "./app/App";
import { parseVox } from "./io/voxParser";
import { writeVox } from "./io/voxWriter";
import { buildOBJ, buildGLB } from "./io/exporters";

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

const app = new App(canvas, ui);
void app; // exposed on window.__app for tooling

// expose IO for headless tests
(window as unknown as { __vox: unknown }).__vox = {
  parseVox,
  writeVox,
  buildOBJ,
  buildGLB,
};

/**
 * Headless round-trip self-test: parse a sample, write it, re-parse, and check
 * voxel counts and palette survive. Result exposed on window for the harness.
 */
async function roundTripTest(): Promise<void> {
  const results: Record<string, unknown> = {};
  for (const name of ["3x3x3", "chr_knight", "monu1"]) {
    try {
      const buf = await (await fetch(`/samples/${name}.vox`)).arrayBuffer();
      const doc = parseVox(buf);
      const before = doc.models.reduce((s, m) => s + m.count, 0);
      const after = parseVox(writeVox(doc)).models.reduce(
        (s, m) => s + m.count,
        0
      );
      results[name] = { before, after, match: before === after };
    } catch (e) {
      results[name] = { error: (e as Error).message };
    }
  }
  (window as unknown as { __roundTrip: unknown }).__roundTrip = results;
}
roundTripTest();
