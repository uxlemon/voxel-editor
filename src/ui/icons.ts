/**
 * Inline SVG icon set rendered from Font Awesome Free (solid) path data.
 * `icon(name)` returns SVG markup suitable for `button.innerHTML`.
 *
 * Each Font Awesome icon ships as `[width, height, …, pathData]`; we center the
 * path in a square viewBox so non-square glyphs aren't distorted by the fixed
 * `svg { width; height }` rules in style.css. Only the icons imported below are
 * bundled (tree-shaken). Icons: Font Awesome Free, CC BY 4.0.
 */
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import {
  faCube,
  faEraser,
  faPaintbrush,
  faFillDrip,
  faObjectGroup,
  faEyeDropper,
  faClone,
  faArrowsUpDownLeftRight,
  faRotate,
  faUpRightAndDownLeftFromCenter,
  faLeftRight,
  faFile,
  faFolderOpen,
  faFloppyDisk,
  faFileExport,
  faVideo,
  faCrosshairs,
  faShapes,
  faSliders,
  faCircleQuestion,
  faChevronDown,
  faBars,
  faArrowLeft,
  faShuffle,
  faPlus,
  faArrowUpFromBracket,
  faCopy,
  faCamera,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

const fa = (def: IconDefinition): string => {
  const [w, h, , , path] = def.icon;
  const d = Array.isArray(path) ? path.join(" ") : path;
  const s = Math.max(w, h);
  const ox = (s - w) / 2;
  const oy = (s - h) / 2;
  return `<svg viewBox="0 0 ${s} ${s}" fill="currentColor" aria-hidden="true"><path transform="translate(${ox} ${oy})" d="${d}"/></svg>`;
};

const ICONS: Record<string, string> = {
  // tools
  attach: fa(faCube),
  erase: fa(faEraser),
  paint: fa(faPaintbrush),
  fill: fa(faFillDrip),
  select: fa(faObjectGroup),
  eyedropper: fa(faEyeDropper),

  // select sub-modes
  box: fa(faCube),
  rect: fa(faObjectGroup),
  same: fa(faClone),

  // gizmo
  translate: fa(faArrowsUpDownLeftRight),
  rotate: fa(faRotate),
  scale: fa(faUpRightAndDownLeftFromCenter),
  flip: fa(faLeftRight),

  // options menu
  new: fa(faFile),
  open: fa(faFolderOpen),
  save: fa(faFloppyDisk),
  export: fa(faFileExport),
  camera: fa(faVideo),
  recenter: fa(faCrosshairs),
  samples: fa(faShapes),
  advanced: fa(faSliders),
  help: fa(faCircleQuestion),
  chevron: fa(faChevronDown),
  menu: fa(faBars),
  back: fa(faArrowLeft),
  remix: fa(faShuffle),
  create: fa(faPlus),
  share: fa(faArrowUpFromBracket),
  copy: fa(faCopy),
  camera2: fa(faCamera),
  close: fa(faXmark),
  plus: fa(faPlus),
};

export function icon(name: string): string {
  return ICONS[name] ?? ICONS.help;
}

/**
 * lemonliu.com's icon-smile — the original div structure (eyes + mouth).
 * Styled by the `.icon-smile` rules in style.css (copied verbatim from the
 * source, only scaled to fit the logo slot).
 */
export const smileLogo =
  `<span class="icon-smile">` +
  `<span class="icon eye left"></span>` +
  `<span class="icon eye right"></span>` +
  `<span class="icon mouth"></span>` +
  `</span>`;
