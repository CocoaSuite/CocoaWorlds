/**
 * Undo/redo built on commands. Every change to a scene goes through `execute`, so every change is undoable.
 * One user gesture (a drag, a typed value) becomes one history entry, as in CocoaCanvas.
 */

export interface Command {
  /** Shown in Edit > Undo "<label>". */
  label: string;
  apply(): void;
  revert(): void;
  /**
   * Commands with the same merge key that arrive back-to-back while a transaction is open
   * collapse into one entry (e.g. every pointer-move of a drag).
   */
  mergeKey?: string;
}

interface Entry {
  label: string;
  commands: Command[];
}

export const HISTORY_LIMIT = 200;

export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];
  private open: Entry | null = null;
  private listeners = new Set<() => void>();
  private savedMarker: Entry | null | undefined = null;

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /** Run a command and record it. Inside a transaction it joins the open entry. */
  execute(cmd: Command): void {
    cmd.apply();
    this.undone = [];
    if (this.open) {
      const last = this.open.commands[this.open.commands.length - 1];
      if (cmd.mergeKey && last?.mergeKey === cmd.mergeKey) {
        // Keep the first command's revert (the original state) and the newest apply.
        this.open.commands[this.open.commands.length - 1] = { ...cmd, revert: () => last.revert() };
      } else {
        this.open.commands.push(cmd);
      }
    } else {
      this.push({ label: cmd.label, commands: [cmd] });
    }
    this.emit();
  }

  /** Group everything until `commit()` into one undo step. */
  begin(label: string): void {
    if (this.open) this.commit();
    this.open = { label, commands: [] };
  }

  commit(): void {
    const e = this.open;
    this.open = null;
    if (e && e.commands.length) this.push(e);
    this.emit();
  }

  /** Abandon the open transaction and roll back its commands. */
  cancel(): void {
    const e = this.open;
    this.open = null;
    if (e) for (let i = e.commands.length - 1; i >= 0; i--) e.commands[i]!.revert();
    this.emit();
  }

  undo(): boolean {
    if (this.open) this.commit();
    const e = this.done.pop();
    if (!e) return false;
    for (let i = e.commands.length - 1; i >= 0; i--) e.commands[i]!.revert();
    this.undone.push(e);
    this.emit();
    return true;
  }

  redo(): boolean {
    const e = this.undone.pop();
    if (!e) return false;
    for (const c of e.commands) c.apply();
    this.done.push(e);
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.done.length > 0 || !!this.open?.commands.length;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get undoLabel(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }

  /** Call after saving; `isDirty` then reports whether anything changed since. */
  markSaved(): void {
    this.savedMarker = this.done[this.done.length - 1] ?? null;
    this.emit();
  }
  get isDirty(): boolean {
    return (this.done[this.done.length - 1] ?? null) !== this.savedMarker;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.open = null;
    this.savedMarker = null;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private push(e: Entry): void {
    this.done.push(e);
    if (this.done.length > this.limit) {
      const dropped = this.done.shift();
      // If the saved state fell off the end, the document can no longer be "clean" by undoing.
      if (dropped === this.savedMarker) this.savedMarker = undefined;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
