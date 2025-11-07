import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UploadResponse {
  ok: boolean;
  bucket: string;
  path: string;
  signedUrl?: string;
  signedUrlError?: string;
  metadata: {
    originalName: string;
    size: number;
    uploadId: string;
    overwrote?: boolean;
  };
}

@Injectable({
  providedIn: 'root',
})
export class BQService {
  private bqUrl = `${environment.apiBaseUrl}/api/bigquery`;
  private floorplanUrl = `${environment.apiBaseUrl}/api/floorplans`;

  constructor(private http: HttpClient) {}

  uploadFloorplan(opts: {
    officeId: string;
    floorId?: string; // Made optional
    file: File;
    fileName?: string;
    overwrite?: boolean;
  }): Observable<{ progress: number; done: boolean; data?: UploadResponse }> {
    const { officeId, floorId, file, fileName, overwrite } = opts;

    const form = new FormData();
    form.append('file', file, file.name);
    form.append('officeId', officeId);
    if (floorId) form.append('floorId', floorId); // Only append if exists
    if (fileName) form.append('fileName', fileName);
    if (overwrite) form.append('overwrite', 'true');

    console.log('📤 BQService: Upload request details:', {
      url: `${this.floorplanUrl}`,
      formData: {
        officeId,
        floorId,
        fileName,
        overwrite,
        fileSize: file.size,
        fileType: file.type
      }
    });

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

  getFloorplan(officeId: string, floorId?: string): Observable<any> {
    const url = floorId
      ? `${this.floorplanUrl}/${officeId}/${floorId}`
      : `${this.floorplanUrl}/${officeId}`;
    return this.http.get<any>(url);
  }

  getAllFloorplans(): Observable<any[]> {
    return this.http.get<any[]>(this.floorplanUrl);
  }
}

//temp by dayang for upload svg testing