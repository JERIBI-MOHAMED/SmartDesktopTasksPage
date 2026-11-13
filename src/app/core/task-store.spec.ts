import { TestBed } from '@angular/core/testing';
import { Task } from './models';
import { MemoryTaskStorage, TASK_STORAGE } from './task-storage';
import { TaskStore } from './task-store';

function serverTask(over: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Server task',
    isDone: false,
    isDeleted: false,
    version: 1,
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

describe('TaskStore', () => {
  let storage: MemoryTaskStorage;
  let store: TaskStore;

  async function setup(initial?: Partial<MemoryTaskStorage['state']>) {
    storage = new MemoryTaskStorage();
    storage.state = { tasks: [], queue: [], since: null, ...initial };
    TestBed.configureTestingModule({ providers: [{ provide: TASK_STORAGE, useValue: storage }] });
    store = TestBed.inject(TaskStore);
    await store.load();
  }

  it('loads tasks, queue and since from storage', async () => {
    const t = serverTask();
    await setup({ tasks: [t], queue: [{ seq: 7, op: 'update', id: t.id, title: 'x', isDone: false, baseVersion: 1 }], since: 'S1' });
    expect(store.tasks().map((x) => x.id)).toEqual([t.id]);
    expect(store.pendingCount()).toBe(1);
    expect(store.since()).toBe('S1');
    // seq continues after the highest stored one
    store.toggle(t.id);
    store.add('next');
    expect(store.queue().at(-1)!.seq).toBe(8);
  });

  it('adds a task locally, queues a create and persists both', async () => {
    await setup();
    const task = store.add('  Buy cable  ')!;
    expect(task.title).toBe('Buy cable');
    expect(task.version).toBe(0);
    expect(store.tasks()).toHaveLength(1);
    expect(store.queue()).toEqual([{ seq: 1, op: 'create', id: task.id, title: 'Buy cable', isDone: false }]);
    expect(store.pendingIds().has(task.id)).toBe(true);
    await store.flush();
    expect(storage.state.tasks).toHaveLength(1);
    expect(storage.state.queue).toHaveLength(1);
  });

  it('rejects empty titles and trims to 200 characters', async () => {
    await setup();
    expect(store.add('   ')).toBeNull();
    expect(store.add('a'.repeat(250))!.title).toHaveLength(200);
  });

  it('sorts not-done first, then most recently updated', async () => {
    const a = serverTask({ title: 'a', updatedAt: '2026-11-01T10:00:00Z' });
    const b = serverTask({ title: 'b', updatedAt: '2026-11-02T10:00:00Z' });
    const c = serverTask({ title: 'c', isDone: true, updatedAt: '2026-11-03T10:00:00Z' });
    await setup({ tasks: [c, a, b] });
    expect(store.tasks().map((t) => t.title)).toEqual(['b', 'a', 'c']);
    expect(store.doneCount()).toBe(1);
    expect(store.totalCount()).toBe(3);
  });

  it('queues an update with the server version as baseVersion', async () => {
    const t = serverTask({ version: 3 });
    await setup({ tasks: [t] });
    store.toggle(t.id);
    expect(store.find(t.id)!.isDone).toBe(true);
    expect(store.queue()).toEqual([{ seq: 1, op: 'update', id: t.id, title: 'Server task', isDone: true, baseVersion: 3 }]);
  });

  it('merges consecutive unsent updates of the same task', async () => {
    const t = serverTask({ version: 3 });
    await setup({ tasks: [t] });
    store.rename(t.id, 'Renamed');
    store.toggle(t.id);
    expect(store.queue()).toHaveLength(1);
    expect(store.queue()[0]).toMatchObject({ op: 'update', title: 'Renamed', isDone: true, baseVersion: 3 });
  });

  it('folds a rename into an unsent create', async () => {
    await setup();
    const t = store.add('Draft')!;
    store.rename(t.id, 'Final');
    expect(store.queue()).toEqual([{ seq: 1, op: 'create', id: t.id, title: 'Final', isDone: false }]);
  });

  it('queues a separate update (baseVersion 1) when a new task is ticked before it is sent', async () => {
    await setup();
    const t = store.add('New')!;
    store.toggle(t.id);
    expect(store.queue().map((c) => c.op)).toEqual(['create', 'update']);
    expect(store.queue()[1]).toMatchObject({ isDone: true, baseVersion: 1 });
  });

  it('does not merge into a change that is already in flight', async () => {
    const t = serverTask({ version: 2 });
    await setup({ tasks: [t] });
    store.rename(t.id, 'One');
    const batch = store.takeBatch();
    store.rename(t.id, 'Two');
    expect(batch).toHaveLength(1);
    expect(store.queue()).toHaveLength(2);
    expect(store.queue()[1]).toMatchObject({ title: 'Two', baseVersion: 3 });
  });

  it('drops a never-sent task entirely when it is deleted', async () => {
    await setup();
    const t = store.add('Oops')!;
    store.remove(t.id);
    expect(store.tasks()).toEqual([]);
    expect(store.queue()).toEqual([]);
  });

  it('replaces unsent updates with one delete and hides the task', async () => {
    const t = serverTask({ version: 4 });
    await setup({ tasks: [t] });
    store.toggle(t.id);
    store.remove(t.id);
    expect(store.tasks()).toEqual([]);
    expect(store.queue()).toEqual([{ seq: 2, op: 'delete', id: t.id, baseVersion: 4 }]);
  });

  it('ignores edits of unknown or deleted tasks and no-op renames', async () => {
    const t = serverTask();
    await setup({ tasks: [t] });
    store.toggle('nope');
    store.rename(t.id, 'Server task');
    expect(store.queue()).toEqual([]);
  });

  it('emits changed after each edit', async () => {
    await setup();
    let count = 0;
    store.changed.subscribe(() => count++);
    const t = store.add('a')!;
    store.toggle(t.id);
    store.remove(t.id);
    expect(count).toBe(3);
  });

  it('releaseBatch makes the changes sendable again', async () => {
    await setup();
    store.add('a');
    const first = store.takeBatch();
    expect(store.takeBatch()).toEqual([]);
    store.releaseBatch(first);
    expect(store.takeBatch()).toHaveLength(1);
  });
});
