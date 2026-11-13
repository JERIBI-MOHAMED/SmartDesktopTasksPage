import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Subscription, debounceTime } from 'rxjs';
import { PendingChange, SyncChange } from './models';
import { SettingsService } from './settings.service';
import { SyncApi } from './sync-api';
import { TaskStore } from './task-store';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error' | 'not-configured';

export const SYNC_INTERVAL_MS = 60_000;
export const SYNC_DEBOUNCE_MS = 1_000;

function toWire(c: PendingChange): SyncChange {
  switch (c.op) {
    case 'create':
      return { op: 'create', id: c.id, title: c.title, isDone: c.isDone ?? false };
    case 'update':
      return { op: 'update', id: c.id, title: c.title, isDone: c.isDone, baseVersion: c.baseVersion };
    case 'delete':
      return { op: 'delete', id: c.id, baseVersion: c.baseVersion };
  }
}

/**
 * Sends the local change queue to POST /api/sync and merges the answer.
 * Runs on start, when the browser comes back online, shortly after each edit,
 * and every 60 seconds. Only one sync runs at a time; a request made while one
 * is running triggers exactly one follow-up.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(TaskStore);
  private readonly api = inject(SyncApi);
  private readonly settings = inject(SettingsService);

  private readonly _status = signal<SyncStatus>('idle');
  private readonly _online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly _lastSyncedAt = signal<string | null>(null);

  readonly status = this._status.asReadonly();
  readonly online = this._online.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();

  private running: Promise<void> | null = null;
  private again = false;
  private started = false;
  private sub: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly onOnline = () => {
    this._online.set(true);
    void this.syncNow();
  };
  private readonly onOffline = () => this._online.set(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sub = this.store.changed.pipe(debounceTime(SYNC_DEBOUNCE_MS)).subscribe(() => void this.syncNow());
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    void this.syncNow();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.sub?.unsubscribe();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs a sync now (or right after the one in progress). */
  async syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => (this.running = null));
    await this.running;
    if (this.again) {
      this.again = false;
      await this.syncNow();
    }
  }

  private async run(): Promise<void> {
    await this.store.load();
    if (!this.settings.isConfigured()) {
      this._status.set('not-configured');
      return;
    }
    this._status.set('syncing');
    const batch = this.store.takeBatch();
    try {
      const res = await this.api.sync({ since: this.store.since(), changes: batch.map(toWire) });
      this.store.applySyncResult(batch, res);
      this._online.set(true);
      this._lastSyncedAt.set(res.serverTime);
      this._status.set('idle');
    } catch (err) {
      this.store.releaseBatch(batch);
      this._status.set(this.classify(err));
    }
  }

  private classify(err: unknown): SyncStatus {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'offline';
      if (err.status === 401) return 'unauthorized';
    }
    return 'error';
  }
}
