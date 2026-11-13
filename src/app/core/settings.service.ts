import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const URL_KEY = 'smartDesktopTasks.apiBaseUrl';
const API_KEY_KEY = 'smartDesktopTasks.apiKey';
const PLACEHOLDER_HOST = 'YOUR-API-HOST';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode etc.): settings then last for this visit only.
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** API URL and key, entered once by the user and kept in localStorage. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly _apiBaseUrl = signal(normalizeBaseUrl(read(URL_KEY) ?? environment.apiBaseUrl));
  private readonly _apiKey = signal(read(API_KEY_KEY) ?? '');
  private readonly _saved = signal(read(API_KEY_KEY) !== null);

  readonly apiBaseUrl = this._apiBaseUrl.asReadonly();
  readonly apiKey = this._apiKey.asReadonly();
  /** False until the user has saved settings once (first run). */
  readonly hasSaved = this._saved.asReadonly();
  readonly isConfigured = computed(() => {
    const url = this._apiBaseUrl();
    return /^https?:\/\/\S+$/i.test(url) && !url.includes(PLACEHOLDER_HOST) && this._apiKey().length > 0;
  });

  /** Saves the settings. Returns true when the API URL changed. */
  save(apiBaseUrl: string, apiKey: string): boolean {
    const url = normalizeBaseUrl(apiBaseUrl);
    const changed = url !== this._apiBaseUrl();
    this._apiBaseUrl.set(url);
    this._apiKey.set(apiKey.trim());
    this._saved.set(true);
    write(URL_KEY, url);
    write(API_KEY_KEY, apiKey.trim());
    return changed;
  }
}
