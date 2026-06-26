import { VoxelModel } from "../core/VoxelModel";

/** A reversible editor action. */
export interface Command {
  readonly label: string;
  apply(): void;
  undo(): void;
}

/** A single voxel change: cell (x,y,z) goes from `before` to `after`. */
export interface VoxelChange {
  x: number;
  y: number;
  z: number;
  before: number;
  after: number;
}

/**
 * A batch of voxel writes on one model (e.g. a whole brush stroke). Records
 * before/after per cell so it can be undone and redone exactly.
 */
export class EditVoxelsCommand implements Command {
  constructor(
    readonly label: string,
    private model: VoxelModel,
    private changes: VoxelChange[]
  ) {}

  apply(): void {
    for (const c of this.changes) this.model.set(c.x, c.y, c.z, c.after);
  }
  undo(): void {
    for (const c of this.changes) this.model.set(c.x, c.y, c.z, c.before);
  }
}

/**
 * Accumulates voxel writes during a stroke, deduplicating by cell (keeping the
 * original `before` and the latest `after`), and produces one command.
 */
export class StrokeRecorder {
  private map = new Map<string, VoxelChange>();
  constructor(private model: VoxelModel) {}

  write(x: number, y: number, z: number, color: number): boolean {
    if (!this.model.inBounds(x, y, z)) return false;
    const current = this.model.get(x, y, z);
    if (current === color) return false; // no-op
    const k = `${x},${y},${z}`;
    const existing = this.map.get(k);
    if (existing) {
      existing.after = color;
    } else {
      this.map.set(k, { x, y, z, before: current, after: color });
    }
    // apply live so the user sees it immediately
    this.model.set(x, y, z, color);
    return true;
  }

  get touched(): number {
    return this.map.size;
  }

  finish(label: string): EditVoxelsCommand | null {
    const changes = [...this.map.values()].filter((c) => c.before !== c.after);
    if (changes.length === 0) return null;
    return new EditVoxelsCommand(label, this.model, changes);
  }
}

/** Undo/redo stack. Commands are assumed already applied when pushed. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  maxDepth = 200;

  /** Push an already-applied command. */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  /** Apply a fresh command and record it. */
  run(cmd: Command): void {
    cmd.apply();
    this.push(cmd);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit();
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply();
    this.undoStack.push(cmd);
    this.emit();
    return cmd;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }
}
