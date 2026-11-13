import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TITLE_MAX_LENGTH, Task } from '../core/models';
import { Icon } from './icon';

/** One row of the task list: toggle, title (inline rename), "Not sent yet" tag, delete. */
@Component({
  selector: 'app-task-item',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-item.html',
  styleUrl: './task-item.scss',
  host: { role: 'listitem', class: 'task', '[class.is-done]': 'task().isDone' },
})
export class TaskItem {
  private readonly injector = inject(Injector);

  readonly task = input.required<Task>();
  readonly pending = input(false);

  readonly toggle = output<void>();
  readonly rename = output<string>();
  readonly remove = output<void>();

  protected readonly editing = signal(false);
  protected readonly maxLength = TITLE_MAX_LENGTH;
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');
  private readonly renameButton = viewChild<ElementRef<HTMLButtonElement>>('renameButton');
  private finishing = false;

  protected startEdit(): void {
    this.editing.set(true);
    afterNextRender(
      () => {
        const el = this.editInput()?.nativeElement;
        el?.focus();
        el?.select();
      },
      { injector: this.injector },
    );
  }

  /** Enter or blur: save. Empty input keeps the old title. */
  protected save(event?: Event, restoreFocus = false): void {
    event?.preventDefault();
    if (!this.editing() || this.finishing) return;
    const value = this.editInput()?.nativeElement.value.trim() ?? '';
    if (value && value !== this.task().title) this.rename.emit(value);
    this.finish(restoreFocus);
  }

  protected cancel(): void {
    if (!this.editing()) return;
    this.finish(true);
  }

  private finish(restoreFocus: boolean): void {
    this.finishing = true;
    this.editing.set(false);
    this.finishing = false;
    if (restoreFocus) {
      afterNextRender(() => this.renameButton()?.nativeElement.focus(), { injector: this.injector });
    }
  }
}
