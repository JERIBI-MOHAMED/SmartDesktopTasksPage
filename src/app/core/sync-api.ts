import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SyncRequest, SyncResponse } from './models';
import { SettingsService } from './settings.service';

/** Thin HTTP wrapper around POST /api/sync. */
@Injectable({ providedIn: 'root' })
export class SyncApi {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);

  sync(request: SyncRequest): Promise<SyncResponse> {
    const headers = new HttpHeaders({ 'X-Api-Key': this.settings.apiKey() });
    return firstValueFrom(
      this.http.post<SyncResponse>(`${this.settings.apiBaseUrl()}/api/sync`, request, { headers }),
    );
  }
}
