import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'plus'
  | 'check'
  | 'clock'
  | 'wifi-off'
  | 'settings'
  | 'pencil'
  | 'trash'
  | 'refresh'
  | 'alert'
  | 'list'
  | 'cloud';

/** Inline stroke icons (24px grid, 1.75 stroke) matching the Smart Desktop design. Decorative only. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon' },
  styles: ':host { display: inline-flex; flex: none; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('plus') { <path d="M12 5v14" /><path d="M5 12h14" /> }
        @case ('check') { <path d="M20 6 9 17l-5-5" /> }
        @case ('clock') { <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /> }
        @case ('wifi-off') {
          <path d="M2 8.8a15 15 0 0 1 4.2-2.7" /><path d="M10.7 5.1A15 15 0 0 1 22 8.8" />
          <path d="M5 13a10 10 0 0 1 5.2-2.8" /><path d="M8.5 16.5a5 5 0 0 1 7 0" />
          <path d="M12 20h.01" /><path d="m2 2 20 20" />
        }
        @case ('settings') {
          <path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" />
          <path d="M4 12h2" /><path d="M10 12h10" /><circle cx="8" cy="12" r="2" />
          <path d="M4 18h10" /><path d="M18 18h2" /><circle cx="16" cy="18" r="2" />
        }
        @case ('pencil') { <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /> }
        @case ('trash') {
          <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" />
          <path d="M10 11v6" /><path d="M14 11v6" />
        }
        @case ('refresh') { <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /> }
        @case ('alert') { <circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /> }
        @case ('list') {
          <path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" />
        }
        @case ('cloud') { <path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.5 11a4 4 0 0 1-2 8Z" /><path d="m9.5 14 2 2 3.5-3.5" /> }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly stroke = input(1.75);
}
