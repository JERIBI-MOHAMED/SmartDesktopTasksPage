import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { SettingsService } from '../core/settings.service';

/** Native <dialog> for the API URL and key. Values are kept in localStorage only. */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
})
export class SettingsDialog {
  protected readonly settings = inject(SettingsService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Emits after saving; `true` when the API URL changed. */
  readonly saved = output<boolean>();

  protected readonly url = signal('');
  protected readonly key = signal('');
  protected readonly showKey = signal(false);
  protected readonly urlError = signal<string | null>(null);
  protected readonly keyError = signal<string | null>(null);

  open(): void {
    this.url.set(this.settings.apiBaseUrl().includes('YOUR-API-HOST') ? '' : this.settings.apiBaseUrl());
    this.key.set(this.settings.apiKey());
    this.showKey.set(false);
    this.urlError.set(null);
    this.keyError.set(null);
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal?.();
  }

  close(): void {
    this.dialog().nativeElement.close?.();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const url = this.url().trim();
    const key = this.key().trim();
    this.urlError.set(/^https?:\/\/[^\s/]+/i.test(url) ? null : 'Enter a full address starting with https:// or http://');
    this.keyError.set(key ? null : 'Enter the API key configured on the server');
    if (this.urlError() || this.keyError()) {
      const firstInvalid = this.urlError() ? '#api-url' : '#api-key';
      this.dialog().nativeElement.querySelector<HTMLInputElement>(firstInvalid)?.focus();
      return;
    }
    const changed = this.settings.save(url, key);
    this.close();
    this.saved.emit(changed);
  }
}
