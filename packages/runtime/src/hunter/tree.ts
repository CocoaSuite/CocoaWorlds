/**
 * A small behaviour tree. Each think, the root is ticked from the top: a priority selector re-checks its
 * branches in order, so a higher branch whose guard becomes true takes over and the lower one is aborted.
 * Every node can be aborted at any point and then starts afresh.
 */
export type Status = 'running' | 'success' | 'failure';

export interface Node<C> {
  tick(c: C): Status;
  abort(c: C): void;
}

/** The first branch that doesn't fail wins; a running one is aborted when a higher branch takes over. */
export class Priority<C> implements Node<C> {
  private active = -1;
  constructor(private kids: Node<C>[]) {}
  tick(c: C): Status {
    for (let i = 0; i < this.kids.length; i++) {
      const s = this.kids[i]!.tick(c);
      if (s === 'failure') {
        if (i === this.active) this.active = -1;
        continue;
      }
      if (this.active >= 0 && this.active !== i) this.kids[this.active]!.abort(c);
      this.active = s === 'running' ? i : -1;
      return s;
    }
    this.active = -1;
    return 'failure';
  }
  abort(c: C): void {
    if (this.active >= 0) this.kids[this.active]!.abort(c);
    this.active = -1;
  }
}

/** Its children one after another; a failure ends it. It remembers where it got to. */
export class Sequence<C> implements Node<C> {
  private at = 0;
  constructor(private kids: Node<C>[]) {}
  tick(c: C): Status {
    while (this.at < this.kids.length) {
      const s = this.kids[this.at]!.tick(c);
      if (s === 'running') return s;
      if (s === 'failure') {
        this.at = 0;
        return s;
      }
      this.at++;
    }
    this.at = 0;
    return 'success';
  }
  abort(c: C): void {
    this.kids[this.at]?.abort(c);
    this.at = 0;
  }
}

/** Runs its child only while a condition holds (aborting it when it stops holding). */
export class Guard<C> implements Node<C> {
  private on = false;
  constructor(private when: (c: C) => boolean, private kid: Node<C>) {}
  tick(c: C): Status {
    if (!this.when(c)) {
      this.abort(c);
      return 'failure';
    }
    const s = this.kid.tick(c);
    this.on = s === 'running';
    return s;
  }
  abort(c: C): void {
    if (this.on) this.kid.abort(c);
    this.on = false;
  }
}

/** Starts its child again from the beginning whenever `key` changes (new news while investigating). */
export class Restart<C> implements Node<C> {
  private key: unknown;
  constructor(private keyOf: (c: C) => unknown, private kid: Node<C>) {}
  tick(c: C): Status {
    const k = this.keyOf(c);
    if (k !== this.key) {
      this.kid.abort(c);
      this.key = k;
    }
    return this.kid.tick(c);
  }
  abort(c: C): void {
    this.kid.abort(c);
    this.key = undefined;
  }
}

/** A leaf: `start` once, `update` until it stops running, `stop` when it ends or is aborted. */
export abstract class Task<C> implements Node<C> {
  private started = false;
  protected start(_c: C): Status | void {}
  protected abstract update(c: C): Status;
  protected stop(_c: C): void {}
  tick(c: C): Status {
    if (!this.started) {
      this.started = true;
      const s = this.start(c);
      if (s && s !== 'running') return this.end(c, s);
    }
    const s = this.update(c);
    return s === 'running' ? s : this.end(c, s);
  }
  abort(c: C): void {
    if (this.started) this.end(c, 'failure');
  }
  private end(c: C, s: Status): Status {
    this.started = false;
    this.stop(c);
    return s;
  }
}

/** A leaf made of functions. */
export class Act<C> extends Task<C> {
  constructor(private fns: { start?: (c: C) => Status | void; update?: (c: C) => Status; stop?: (c: C) => void }) {
    super();
  }
  protected override start(c: C) {
    return this.fns.start?.(c);
  }
  protected update(c: C): Status {
    return this.fns.update ? this.fns.update(c) : 'success';
  }
  protected override stop(c: C): void {
    this.fns.stop?.(c);
  }
}
