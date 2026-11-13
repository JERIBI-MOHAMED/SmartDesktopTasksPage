/** A task exactly as the API returns it (contract v1). */
export interface Task {
  id: string;
  title: string;
  isDone: boolean;
  isDeleted: boolean;
  /** Set by the server. 0 locally means "created here, never confirmed by the server". */
  version: number;
  updatedAt: string;
}

export type ChangeOp = 'create' | 'update' | 'delete';

/** One entry of the change shape sent to POST /api/sync. */
export interface SyncChange {
  op: ChangeOp;
  id: string;
  title?: string;
  isDone?: boolean;
  baseVersion?: number;
}

/** A change waiting in the local queue. `seq` orders the queue and identifies an entry. */
export interface PendingChange extends SyncChange {
  seq: number;
}

export interface SyncRequest {
  since: string | null;
  changes: SyncChange[];
}

export interface SyncResponse {
  serverTime: string;
  applied: string[];
  conflicts: Task[];
  tasks: Task[];
}

/** Everything the page keeps in IndexedDB. */
export interface PersistedState {
  tasks: Task[];
  queue: PendingChange[];
  since: string | null;
}

export const TITLE_MAX_LENGTH = 200;
