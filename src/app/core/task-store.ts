import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { PendingChange, SyncChange, SyncResponse, TITLE_MAX_LENGTH, Task } from './models';
import { TASK_STORAGE } from './task-storage';

export function newId(): string {
  return crypto.randomUUID();
}

/** Not done first, then most recently updated first (same order as GET /api/tasks). */
export function compareTasks(a: Task, b: Task): number {
  if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function cleanTitle(title: string): string | null {
  const t = title.trim();
  return t.length === 0 ? null : t.slice(0, TITLE_MAX_LENGTH);
}

/**
 * Local source of truth for the task list.
 *
 * Every edit is applied to the local copy immediately and appended to a change
 * queue; both are persisted to IndexedDB. SyncService drains the queue.
 *
 * Queue rules (keep at most one unsent change per task where possible):
 * - an update following an unsent update of the same task is merged into it;
 * - a rename of a task whose create is still unsent is merged into the create;
 * - deleting a task whose create was never sent drops it without a request;
 * - `baseVersion` = last server version + number of changes for that task
 *   still ahead in the queue (the server bumps the version by 1 per change).
 */
@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly storage = inject(TASK_STORAGE);

  private readonly _tasks = signal<Task[]>([]);
  private readonly _queue = signal<PendingChange[]>([]);
  private readonly _since = signal<string | null>(null);
  private readonly _loaded = signal(false);
  private readonly inFlight = new Set<number>();
  private nextSeq = 1;
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

  /** Emits after every local edit (SyncService debounces a sync on it). */
  readonly changed = new Subject<void>();

  readonly loaded = this._loaded.asReadonly();
  readonly since = this._since.asReadonly();
  readonly queue = this._queue.asReadonly();

  readonly tasks = computed(() => this._tasks().filter((t) => !t.isDeleted).sort(compareTasks));
  readonly totalCount = computed(() => this.tasks().length);
  readonly doneCount = computed(() => this.tasks().filter((t) => t.isDone).length);
  readonly pendingCount = computed(() => this._queue().length);
  readonly pendingIds = computed(() => new Set(this._queue().map((c) => c.id)));

  /** Loads the persisted state once. Safe to call many times. */
  load(): Promise<void> {
    this.loading ??= this.storage.load().then((state) => {
      this._tasks.set(state.tasks);
      this._queue.set(state.queue);
      this._since.set(state.since);
      this.nextSeq = state.queue.reduce((max, c) => Math.max(max, c.seq), 0) + 1;
      this._loaded.set(true);
    });
    return this.loading;
  }

  /** Resolves when everything changed so far is written to storage. */
  flush(): Promise<void> {
    return this.saving;
  }

  find(id: string): Task | undefined {
    return this._tasks().find((t) => t.id === id);
  }

  add(title: string): Task | null {
    const clean = cleanTitle(title);
    if (!clean) return null;
    const task: Task = {
      id: newId(),
      title: clean,
      isDone: false,
      isDeleted: false,
      version: 0,
      updatedAt: new Date().toISOString(),
    };
    this._tasks.update((list) => [...list, task]);
    this.enqueue({ op: 'create', id: task.id, title: task.title, isDone: false });
    this.commit();
    return task;
  }

  rename(id: string, title: string): void {
    const clean = cleanTitle(title);
    const task = this.find(id);
    if (!clean || !task || task.isDeleted || task.title === clean) return;
    this.edit(task, { title: clean });
  }

  toggle(id: string): void {
    const task = this.find(id);
    if (!task || task.isDeleted) return;
    this.edit(task, { isDone: !task.isDone });
  }

  remove(id: string): void {
    const task = this.find(id);
    if (!task || task.isDeleted) return;
    const ops = this._queue().filter((c) => c.id === id);
    const neverSent = ops.some((c) => c.op === 'create' && !this.inFlight.has(c.seq));
    if (neverSent) {
      // The server has never heard of this task: forget it entirely.
      this._queue.update((q) => q.filter((c) => c.id !== id));
      this._tasks.update((list) => list.filter((t) => t.id !== id));
    } else {
      // Unsent updates are pointless now; in-flight ones must stay counted.
      this._queue.update((q) => q.filter((c) => c.id !== id || this.inFlight.has(c.seq)));
      this.enqueue({ op: 'delete', id, baseVersion: this.expectedVersion(task) });
      this.replace({ ...task, isDeleted: true, updatedAt: new Date().toISOString() });
    }
    this.commit();
  }

  /** Hands the current queue to the sync service and marks it in flight. */
  takeBatch(): PendingChange[] {
    const batch = this._queue().filter((c) => !this.inFlight.has(c.seq));
    batch.forEach((c) => this.inFlight.add(c.seq));
    return batch.map((c) => ({ ...c }));
  }

  /** The batch was not delivered: keep it queued for the next attempt. */
  releaseBatch(batch: PendingChange[]): void {
    batch.forEach((c) => this.inFlight.delete(c.seq));
  }

  /** Forget the `since` marker so the next sync downloads everything (e.g. new API URL). */
  resetSince(): void {
    this._since.set(null);
    this.persist();
  }

  /**
   * Applies a POST /api/sync response for `batch`.
   * Sent changes leave the queue (applied or not); conflicts and changed tasks
   * from the server replace local copies (server wins); serverTime becomes `since`.
   */
  applySyncResult(batch: PendingChange[], res: SyncResponse): void {
    const sent = new Set(batch.map((c) => c.seq));
    sent.forEach((seq) => this.inFlight.delete(seq));
    const conflictIds = new Set(res.conflicts.map((t) => t.id));

    // Drop what was sent, and any later local edit of a conflicted task (server wins).
    const queue = this._queue().filter((c) => !sent.has(c.seq) && !conflictIds.has(c.id));
    const stillPending = new Set(queue.map((c) => c.id));

    const byId = new Map(this._tasks().map((t) => [t.id, t] as const));
    const incoming = [...res.tasks.filter((t) => !conflictIds.has(t.id)), ...res.conflicts];
    for (const server of incoming) {
      const local = byId.get(server.id);
      if (stillPending.has(server.id) && local) {
        // Newer local edits are queued: keep them on screen, remember the server version.
        byId.set(server.id, { ...local, version: server.version });
      } else if (server.isDeleted) {
        byId.delete(server.id);
      } else {
        byId.set(server.id, server);
      }
    }
    // A local-only task whose create was sent but not accepted would otherwise linger forever.
    for (const [id, t] of byId) {
      if (t.version === 0 && !stillPending.has(id) && !this.inFlightFor(id)) byId.delete(id);
      else if (t.isDeleted && !stillPending.has(id) && !this.inFlightFor(id)) byId.delete(id);
    }

    this._queue.set(queue);
    this._tasks.set([...byId.values()]);
    this._since.set(res.serverTime);
    this.persist();
  }

  private inFlightFor(id: string): boolean {
    return this._queue().some((c) => c.id === id && this.inFlight.has(c.seq));
  }

  private edit(task: Task, patch: Partial<Pick<Task, 'title' | 'isDone'>>): void {
    const next: Task = { ...task, ...patch, updatedAt: new Date().toISOString() };
    const ops = this._queue().filter((c) => c.id === task.id);
    const last = ops.at(-1);
    const mergeable = last && !this.inFlight.has(last.seq);

    if (mergeable && last.op === 'update') {
      this.updateQueued(last.seq, { title: next.title, isDone: next.isDone });
    } else if (mergeable && last.op === 'create' && !next.isDone) {
      this.updateQueued(last.seq, { title: next.title });
    } else {
      this.enqueue({
        op: 'update',
        id: task.id,
        title: next.title,
        isDone: next.isDone,
        baseVersion: this.expectedVersion(task),
      });
    }
    this.replace(next);
    this.commit();
  }

  /** Version the server will have once every queued change for the task is applied. */
  private expectedVersion(task: Task): number {
    const ahead = this._queue().filter((c) => c.id === task.id && c.op !== 'delete').length;
    return task.version + ahead;
  }

  private enqueue(change: SyncChange): void {
    const entry: PendingChange = { ...change, seq: this.nextSeq++ };
    this._queue.update((q) => [...q, entry]);
  }

  private updateQueued(seq: number, patch: Partial<SyncChange>): void {
    this._queue.update((q) => q.map((c) => (c.seq === seq ? { ...c, ...patch } : c)));
  }

  private replace(task: Task): void {
    this._tasks.update((list) => list.map((t) => (t.id === task.id ? task : t)));
  }

  private commit(): void {
    this.persist();
    this.changed.next();
  }

  private persist(): void {
    const snapshot = { tasks: this._tasks(), queue: this._queue(), since: this._since() };
    this.saving = this.saving
      .then(() => this.storage.save(snapshot))
      .catch((err) => console.warn('Could not save tasks locally', err));
  }
}
