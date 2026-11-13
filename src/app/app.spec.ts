import { TestBed } from '@angular/core/testing';
import { App, UNDO_MS } from './app';
import { SettingsService } from './core/settings.service';
import { SyncApi } from './core/sync-api';
import { MemoryTaskStorage, TASK_STORAGE } from './core/task-storage';
import { TaskStore } from './core/task-store';

describe('App', () => {
  let storage: MemoryTaskStorage;

  beforeEach(() => {
    localStorage.clear();
    storage = new MemoryTaskStorage();
    storage.state.tasks = [
      { id: 'a', title: 'Open task', isDone: false, isDeleted: false, version: 1, updatedAt: '2026-11-01T00:00:00Z' },
      { id: 'b', title: 'Done task', isDone: true, isDeleted: false, version: 1, updatedAt: '2026-11-02T00:00:00Z' },
    ];
    // A never-answering API keeps the queue visible as "Not sent yet".
    const api = { sync: () => new Promise(() => {}) };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: TASK_STORAGE, useValue: storage },
        { provide: SyncApi, useValue: api },
      ],
    });
    TestBed.inject(SettingsService).save('http://localhost:5080', 'key');
  });

  afterEach(() => localStorage.clear());

  async function render() {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(TaskStore).load();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lists tasks, not done first, with progress', async () => {
    const { el } = await render();
    const titles = [...el.querySelectorAll('app-task-item .title')].map((n) => n.textContent?.trim());
    expect(titles).toEqual(['Open task', 'Done task']);
    expect(el.querySelector('.count')?.textContent).toBe('1 of 2 done');
  });

  it('adds a task and marks it "Not sent yet"', async () => {
    const { fixture, el } = await render();
    const input = el.querySelector<HTMLInputElement>('#new-task')!;
    input.value = 'Fresh';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    const row = el.querySelector('app-task-item')!;
    expect(row.textContent).toContain('Fresh');
    expect(row.textContent).toContain('Not sent yet');
    expect(input.value).toBe('');
  });

  it('gives icon buttons accessible names', async () => {
    const { el } = await render();
    const labels = [...el.querySelectorAll('app-task-item button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Mark done: Open task');
    expect(labels).toContain('Mark not done: Done task');
    expect(labels).toContain('Rename: Open task');
    expect(labels).toContain('Delete: Open task');
  });

  it('hides a deleted task, offers undo, and queues the delete after the undo window', async () => {
    const { fixture, el } = await render();
    try {
      const store = TestBed.inject(TaskStore);
      el.querySelector<HTMLButtonElement>('[aria-label="Delete: Open task"]')!.click();
      await fixture.whenStable();
      expect(el.querySelectorAll('app-task-item')).toHaveLength(1);
      expect(el.querySelector('.toast')?.textContent).toContain('Undo');

      el.querySelector<HTMLButtonElement>('.toast button')!.click();
      await fixture.whenStable();
      expect(el.querySelectorAll('app-task-item')).toHaveLength(2);
      expect(store.queue()).toEqual([]);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      el.querySelector<HTMLButtonElement>('[aria-label="Delete: Open task"]')!.click();
      expect(store.queue()).toEqual([]);
      vi.advanceTimersByTime(UNDO_MS);
      expect(store.queue()).toEqual([expect.objectContaining({ op: 'delete', id: 'a', baseVersion: 1 })]);
    } finally {
      vi.useRealTimers();
    }
  });
});
