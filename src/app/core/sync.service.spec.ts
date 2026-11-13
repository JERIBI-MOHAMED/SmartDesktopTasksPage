import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SyncRequest, SyncResponse, Task } from './models';
import { SettingsService } from './settings.service';
import { SyncApi } from './sync-api';
import { SyncService } from './sync.service';
import { MemoryTaskStorage, TASK_STORAGE } from './task-storage';
import { TaskStore } from './task-store';

function task(over: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Task',
    isDone: false,
    isDeleted: false,
    version: 1,
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

function response(over: Partial<SyncResponse> = {}): SyncResponse {
  return { serverTime: '2026-11-13T12:00:00.000Z', applied: [], conflicts: [], tasks: [], ...over };
}

/** Fake API: records requests and answers with queued responses (or a default). */
class FakeApi {
  requests: SyncRequest[] = [];
  next: Array<(req: SyncRequest) => SyncResponse | Promise<SyncResponse>> = [];
  sync = vi.fn(async (req: SyncRequest) => {
    this.requests.push(structuredClone(req));
    const handler = this.next.shift();
    return handler ? handler(req) : response();
  });
}

describe('SyncService', () => {
  let storage: MemoryTaskStorage;
  let api: FakeApi;
  let store: TaskStore;
  let sync: SyncService;

  function setup(initial?: Partial<MemoryTaskStorage['state']>, configured = true) {
    localStorage.clear();
    storage = new MemoryTaskStorage();
    storage.state = { tasks: [], queue: [], since: null, ...initial };
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: TASK_STORAGE, useValue: storage },
        { provide: SyncApi, useValue: api },
      ],
    });
    if (configured) TestBed.inject(SettingsService).save('http://localhost:5080/', 'secret');
    store = TestBed.inject(TaskStore);
    sync = TestBed.inject(SyncService);
  }

  afterEach(() => {
    sync?.stop();
    localStorage.clear();
  });

  describe('queue', () => {
    it('sends queued changes in order in the contract shape', async () => {
      const existing = task({ version: 3, title: 'Old' });
      setup({ tasks: [existing], since: 'S0' });
      await store.load();
      const created = store.add('New')!;
      store.rename(existing.id, 'Renamed');
      const doomed = task({ version: 5 });
      // add a third server task and delete it
      store['_tasks'].update((l) => [...l, doomed]);
      store.remove(doomed.id);

      await sync.syncNow();

      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]).toEqual({
        since: 'S0',
        changes: [
          { op: 'create', id: created.id, title: 'New', isDone: false },
          { op: 'update', id: existing.id, title: 'Renamed', isDone: false, baseVersion: 3 },
          { op: 'delete', id: doomed.id, baseVersion: 5 },
        ],
      });
    });

    it('empties the queue and takes server copies after a successful sync', async () => {
      setup();
      await store.load();
      const t = store.add('Hello')!;
      api.next.push(() =>
        response({ applied: [t.id], tasks: [task({ id: t.id, title: 'Hello', version: 1, updatedAt: '2026-11-13T11:59:59Z' })] }),
      );
      await sync.syncNow();
      expect(store.queue()).toEqual([]);
      expect(store.pendingIds().size).toBe(0);
      expect(store.find(t.id)!.version).toBe(1);
      expect(sync.status()).toBe('idle');
      await store.flush();
      expect(storage.state.queue).toEqual([]);
    });

    it('keeps the queue when the network fails and reports offline', async () => {
      setup();
      await store.load();
      store.add('Offline task');
      api.next.push(() => {
        throw new HttpErrorResponse({ status: 0 });
      });
      await sync.syncNow();
      expect(sync.status()).toBe('offline');
      expect(store.pendingCount()).toBe(1);
      expect(store.since()).toBeNull();

      await sync.syncNow(); // "Try again"
      expect(api.requests[1].changes).toHaveLength(1);
      expect(store.pendingCount()).toBe(0);
    });

    it('reports a rejected API key and keeps the queue', async () => {
      setup();
      await store.load();
      store.add('x');
      api.next.push(() => {
        throw new HttpErrorResponse({ status: 401 });
      });
      await sync.syncNow();
      expect(sync.status()).toBe('unauthorized');
      expect(store.pendingCount()).toBe(1);
    });

    it('does not call the API before settings are saved', async () => {
      setup({}, false);
      await sync.syncNow();
      expect(api.sync).not.toHaveBeenCalled();
      expect(sync.status()).toBe('not-configured');
    });

    it('keeps edits made during a sync queued for the next one', async () => {
      const t = task({ version: 2, title: 'A' });
      setup({ tasks: [t] });
      await store.load();
      store.rename(t.id, 'B');
      api.next.push(() => {
        store.rename(t.id, 'C'); // user types while the request is in flight
        return response({ applied: [t.id], tasks: [{ ...t, title: 'B', version: 3, updatedAt: '2026-11-13T11:00:00Z' }] });
      });
      api.next.push(() => response({ applied: [t.id], tasks: [{ ...t, title: 'C', version: 4 }] }));

      await sync.syncNow();
      // First response did not overwrite the newer local title, but took the new version.
      expect(store.find(t.id)).toMatchObject({ title: 'C', version: 3 });
      expect(store.queue()).toEqual([expect.objectContaining({ title: 'C', baseVersion: 3 })]);

      await sync.syncNow();
      expect(api.requests[1].changes).toEqual([{ op: 'update', id: t.id, title: 'C', isDone: false, baseVersion: 3 }]);
      expect(store.find(t.id)).toMatchObject({ title: 'C', version: 4 });
      expect(store.queue()).toEqual([]);
    });

    it('runs one follow-up sync when asked during a running sync', async () => {
      setup();
      await store.load();
      let release!: () => void;
      api.next.push(() => new Promise((r) => (release = () => r(response()))));
      const first = sync.syncNow();
      await vi.waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1));
      void sync.syncNow();
      void sync.syncNow();
      release();
      await first;
      expect(api.sync).toHaveBeenCalledTimes(2);
    });
  });

  describe('conflicts', () => {
    it('replaces the local copy with the server copy', async () => {
      const t = task({ version: 2, title: 'Mine' });
      setup({ tasks: [t] });
      await store.load();
      store.rename(t.id, 'Local edit');
      const serverCopy = { ...t, title: 'Edited on tablet', isDone: true, version: 5 };
      api.next.push(() => response({ conflicts: [serverCopy] }));
      await sync.syncNow();
      expect(store.find(t.id)).toEqual(serverCopy);
      expect(store.pendingCount()).toBe(0);
    });

    it('drops later queued edits of a conflicted task (server wins)', async () => {
      const t = task({ version: 2 });
      setup({ tasks: [t] });
      await store.load();
      store.rename(t.id, 'First');
      const serverCopy = { ...t, title: 'Server', version: 9 };
      api.next.push(() => {
        store.toggle(t.id); // queued while in flight, based on a stale version
        return response({ conflicts: [serverCopy] });
      });
      await sync.syncNow();
      expect(store.queue()).toEqual([]);
      expect(store.find(t.id)).toEqual(serverCopy);
    });

    it('removes a task the server reports as deleted in a conflict', async () => {
      const t = task({ version: 2 });
      setup({ tasks: [t] });
      await store.load();
      store.toggle(t.id);
      api.next.push(() => response({ conflicts: [{ ...t, isDeleted: true, version: 3 }] }));
      await sync.syncNow();
      expect(store.find(t.id)).toBeUndefined();
      expect(store.tasks()).toEqual([]);
    });

    it('conflict copy wins over the same task in the tasks list', async () => {
      const t = task({ version: 2 });
      setup({ tasks: [t] });
      await store.load();
      store.toggle(t.id);
      const conflict = { ...t, title: 'conflict', version: 6 };
      api.next.push(() => response({ conflicts: [conflict], tasks: [{ ...t, title: 'list', version: 6 }] }));
      await sync.syncNow();
      expect(store.find(t.id)!.title).toBe('conflict');
    });
  });

  describe('since tracking', () => {
    it('sends null the first time and stores serverTime as the next since', async () => {
      setup();
      api.next.push(() => response({ serverTime: 'T1' }));
      api.next.push(() => response({ serverTime: 'T2' }));
      await sync.syncNow();
      expect(api.requests[0].since).toBeNull();
      expect(store.since()).toBe('T1');
      await sync.syncNow();
      expect(api.requests[1].since).toBe('T1');
      expect(store.since()).toBe('T2');
      await store.flush();
      expect(storage.state.since).toBe('T2');
    });

    it('resumes from the persisted since after a reload', async () => {
      setup({ since: 'PERSISTED' });
      await sync.syncNow();
      expect(api.requests[0].since).toBe('PERSISTED');
    });

    it('does not advance since when the sync fails', async () => {
      setup({ since: 'T1' });
      api.next.push(() => {
        throw new HttpErrorResponse({ status: 500 });
      });
      await sync.syncNow();
      expect(sync.status()).toBe('error');
      expect(store.since()).toBe('T1');
    });

    it('merges changes from other devices, including deletions', async () => {
      const keep = task({ title: 'keep' });
      const gone = task({ title: 'gone' });
      setup({ tasks: [keep, gone], since: 'T1' });
      const fresh = task({ title: 'from tablet', updatedAt: '2026-11-13T09:00:00Z' });
      api.next.push(() => response({ tasks: [fresh, { ...gone, isDeleted: true, version: 2 }, { ...keep, isDone: true, version: 2 }] }));
      await sync.syncNow();
      expect(store.tasks().map((t) => t.title)).toEqual(['from tablet', 'keep']);
      expect(store.find(keep.id)!.isDone).toBe(true);
    });

    it('resetSince makes the next sync a full download', async () => {
      setup({ since: 'T1' });
      await store.load();
      store.resetSince();
      await sync.syncNow();
      expect(api.requests[0].since).toBeNull();
    });
  });

  describe('triggers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('syncs on start, after edits (debounced), on reconnect and every 60 s', async () => {
      setup();
      await store.load();
      sync.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sync).toHaveBeenCalledTimes(1);

      store.add('a');
      store.add('b');
      await vi.advanceTimersByTimeAsync(1_100);
      expect(api.sync).toHaveBeenCalledTimes(2);
      expect(api.requests[1].changes).toHaveLength(2);

      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sync).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(api.sync).toHaveBeenCalledTimes(4);
    });
  });
});
