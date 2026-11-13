import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TITLE_MAX_LENGTH, Task } from './core/models';
import { SettingsService } from './core/settings.service';
import { SyncService } from './core/sync.service';
import { TaskStore } from './core/task-store';
import { Icon } from './ui/icon';
import { SettingsDialog } from './ui/settings-dialog';
import { TaskItem } from './ui/task-item';

export const UNDO_MS = 6_000;

type BannerKind = 'setup' | 'offline' | 'unreachable' | 'unauthorized' | 'error';

@Component({
  selector: 'app-root',
  imports: [Icon, TaskItem, SettingsDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  protected readonly store = inject(TaskStore);
  protected readonly sync = inject(SyncService);
  protected readonly settings = inject(SettingsService);

  private readonly settingsDialog = viewChild.required(SettingsDialog);
  private readonly newTaskInput = viewChild.required<ElementRef<HTMLInputElement>>('newTask');

  protected readonly maxLength = TITLE_MAX_LENGTH;
  protected readonly newTitle = signal('');

  /** A delete waiting out its undo window; it reaches the store (and queue) when the window ends. */
  protected readonly pendingDelete = signal<Task | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly tasks = computed(() => {
    const hidden = this.pendingDelete()?.id;
    return this.store.tasks().filter((t) => t.id !== hidden);
  });
  protected readonly total = computed(() => this.tasks().length);
  protected readonly done = computed(() => this.tasks().filter((t) => t.isDone).length);
  protected readonly progress = computed(() => (this.total() ? Math.round((this.done() / this.total()) * 100) : 0));

  protected readonly banner = computed<BannerKind | null>(() => {
    if (!this.settings.isConfigured()) return 'setup';
    if (!this.sync.online()) return 'offline';
    switch (this.sync.status()) {
      case 'offline':
        return 'unreachable';
      case 'unauthorized':
        return 'unauthorized';
      case 'error':
        return 'error';
      default:
        return null;
    }
  });

  protected readonly pendingText = computed(() => {
    const n = this.store.pendingCount();
    if (n === 0) return 'Changes you make are saved here';
    return n === 1 ? '1 change is saved here' : `${n} changes are saved here`;
  });

  private readonly onPageHide = () => this.commitDelete();

  constructor() {
    afterNextRender(() => {
      if (!this.settings.hasSaved()) this.settingsDialog().open();
    });
  }

  ngOnInit(): void {
    void this.store.load();
    this.sync.start();
    window.addEventListener('pagehide', this.onPageHide);
  }

  ngOnDestroy(): void {
    this.commitDelete();
    window.removeEventListener('pagehide', this.onPageHide);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected addTask(event: Event): void {
    event.preventDefault();
    const input = this.newTaskInput().nativeElement;
    if (this.store.add(this.newTitle())) {
      this.newTitle.set('');
      input.value = '';
    }
    input.focus();
  }

  protected deleteTask(task: Task): void {
    this.commitDelete();
    this.pendingDelete.set(task);
    this.undoTimer = setTimeout(() => this.commitDelete(), UNDO_MS);
    this.newTaskInput().nativeElement.focus();
  }

  protected undoDelete(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.pendingDelete.set(null);
  }

  private commitDelete(): void {
    const task = this.pendingDelete();
    if (!task) return;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.pendingDelete.set(null);
    this.store.remove(task.id);
  }

  protected openSettings(): void {
    this.settingsDialog().open();
  }

  protected onSettingsSaved(urlChanged: boolean): void {
    if (urlChanged) this.store.resetSince();
    void this.sync.syncNow();
  }

  protected retry(): void {
    void this.sync.syncNow();
  }
}
