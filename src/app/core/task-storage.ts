import { Injectable, InjectionToken } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { PersistedState } from './models';

/** Where tasks, the change queue and the `since` marker live between visits. */
export interface TaskStorage {
  load(): Promise<PersistedState>;
  save(state: PersistedState): Promise<void>;
}

export const TASK_STORAGE = new InjectionToken<TaskStorage>('TASK_STORAGE', {
  providedIn: 'root',
  factory: () => (typeof indexedDB === 'undefined' ? new MemoryTaskStorage() : new IdbTaskStorage()),
});

interface TasksDb extends DBSchema {
  state: { key: 'tasks' | 'queue' | 'since'; value: unknown };
}

const EMPTY: PersistedState = { tasks: [], queue: [], since: null };

/** IndexedDB storage (via `idb`). One small object store, written in a single transaction. */
@Injectable()
export class IdbTaskStorage implements TaskStorage {
  private db: Promise<IDBPDatabase<TasksDb>> | null = null;

  private open(): Promise<IDBPDatabase<TasksDb>> {
    this.db ??= openDB<TasksDb>('smart-desktop-tasks', 1, {
      upgrade(db) {
        db.createObjectStore('state');
      },
    });
    return this.db;
  }

  async load(): Promise<PersistedState> {
    try {
      const db = await this.open();
      const tx = db.transaction('state', 'readonly');
      const [tasks, queue, since] = await Promise.all([
        tx.store.get('tasks'),
        tx.store.get('queue'),
        tx.store.get('since'),
      ]);
      return {
        tasks: (tasks as PersistedState['tasks']) ?? [],
        queue: (queue as PersistedState['queue']) ?? [],
        since: (since as string | null) ?? null,
      };
    } catch (err) {
      console.warn('IndexedDB unavailable, starting empty', err);
      return { ...EMPTY };
    }
  }

  async save(state: PersistedState): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('state', 'readwrite');
    await Promise.all([
      tx.store.put(state.tasks, 'tasks'),
      tx.store.put(state.queue, 'queue'),
      tx.store.put(state.since, 'since'),
      tx.done,
    ]);
  }
}

/** In-memory storage: used in tests and when IndexedDB does not exist. */
export class MemoryTaskStorage implements TaskStorage {
  state: PersistedState = { tasks: [], queue: [], since: null };

  async load(): Promise<PersistedState> {
    return structuredClone(this.state);
  }

  async save(state: PersistedState): Promise<void> {
    this.state = structuredClone(state);
  }
}
