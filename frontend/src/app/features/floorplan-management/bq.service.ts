import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpEventType
} from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment.prod';

export interface UploadResponse {
  ok: boolean;
  bucket: string;
  path: string;
  gsUri: string;
  signedUrl?: string;
  signedUrlExpiresInMinutes?: number;
}

@Injectable({
  providedIn: 'root',
})
export class BQService {
  private bqUrl = environment.bqUrl;
  private floorplanUrl = environment.floorplanUrl;

  constructor(private http: HttpClient) {}
  // remove if not in use
  getLocation(): Observable<{ label: string; value: string }[]> {
    return this.http.get<any>(`${this.bqUrl}/locations`).pipe(
      map((res) => {
        const arr = Array.isArray(res) ? res : res.data ?? res.rows ?? [];
        return arr.map((loc: any) => ({
          label: loc.location_name,
          value: loc.location_id,
        }));
      })
    );
  }

  // remove if not in use
  getFloor(): Observable<{ label: string; value: string }[]> {
    return this.http.get<any>(`${this.bqUrl}/floors`).pipe(
      map((res) => {
        const arr = Array.isArray(res) ? res : res.data ?? res.rows ?? [];
        return arr.map((loc: any) => ({
          label: loc.floor_name,
          value: loc.floor_id,
        }));
      })
    );
  }

  uploadFloorplan(opts: {
    officeId: string;
    floorId: string;
    file: File;
    fileName?: string;
  }): Observable<{ progress: number; done: boolean; data?: UploadResponse }> {
    const { officeId, floorId, file, fileName } = opts;

    const form = new FormData();
    form.append('file', file, file.name);
    form.append('officeId', officeId);
    form.append('floorId', floorId);
    if (fileName) form.append('fileName', fileName);

    return this.http
      .post<UploadResponse>(`${this.floorplanUrl}`, form, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event: HttpEvent<UploadResponse>) => {
          switch (event.type) {
            case HttpEventType.Sent:
              return { progress: 0, done: false };
            case HttpEventType.UploadProgress: {
              const total = event.total ?? Math.max(file.size, 1);
              const progress = Math.round((100 * event.loaded) / total);
              return { progress, done: false };
            }
            case HttpEventType.Response:
              return {
                progress: 100,
                done: true,
                data: event.body as UploadResponse,
              };
            default:
              return { progress: 0, done: false };
          }
        })
      );
  }
}

//temp by dayang for upload svg testing