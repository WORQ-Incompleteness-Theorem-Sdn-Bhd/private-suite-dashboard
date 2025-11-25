// firebase-svg.service.ts handle firebase cloud storage svg urls from backend
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { environment } from '../../environments/environment.dev';

// export interface FirebaseSvgResponse {
//   ok: boolean;
//   bucket: string;
//   path: string;
//   signedUrl: string | null;
//   contentType: string;
//   size: number;
//   updated: string;
//   metadata: any;
// }
// export type FirebaseSvgItem = {
//   path: string;
//   signedUrl?: string | null;
//   contentType?: string;
//   size?: number;
//   updated?: string;
//   metadata?: {
//     officeId: string;
//     originalName: string;
//     firebaseStorageDownloadTokens?: string;
//   };
//   bucket?: any;
// };

// --- Core item type coming from backend
export type FirebaseSvgItem = {
  path: string;
  signedUrl?: string | null;
  contentType?: string | null;
  size?: number | null;
  updated?: string | null;
  metadata?: {
    officeId?: string;
    originalName?: string;
    firebaseStorageDownloadTokens?: string;
    [key: string]: unknown;
  } | null;
};


// Optional: If you want to pass bucket along with items
export type BucketScopedItem = FirebaseSvgItem & {
  bucket?: string | null;
};

// --- Response shape (discriminated union)
export type FirebaseSvgResponseSingle = {
  ok: boolean;
  scope: "single";
  bucket: string;
  path: string;
  signedUrl?: string | null;
  contentType?: string | null;
  size?: number | null;
  updated?: string | null;
  metadata?: FirebaseSvgItem["metadata"];
};

export type FirebaseSvgResponseList = {
  ok: boolean;
  scope: "list";
  bucket: string;
  items: FirebaseSvgItem[];
};

export type FirebaseSvgResponse =
  | FirebaseSvgResponseSingle
  | FirebaseSvgResponseList;



// export type FirebaseSvgResponse =
//   | {
//     ok: boolean;
//     scope: "single";
//     bucket: string;
//     path: string;
//     signedUrl?: string | null;
//     contentType?: string;
//     size?: number;
//     updated?: string;
//     metadata?: Record<string, any> | null;
//   }
//   | {
//     ok: boolean;
//     scope: "list";
//     bucket: string;
//     count: number;
//     items: FirebaseSvgItem[];
//   };
export interface FloorplanEntry {
  officeId: string;
  floorId?: string;
  path: string;
  size: number;
  updated: string;
  metadata: any;
  signedUrl?: string;
}

export interface OfficeFloorplans {
  officeId: string;
  officeSvg?: FloorplanEntry;
  floors: FloorplanEntry[];
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseSvgService {
  private baseUrl = `${environment.apiBaseUrl}/api/floorplans`; // Floorplan API URL
  private bqUrl = `${environment.apiBaseUrl}/api/bigquery`;

  constructor(private http: HttpClient) {}

  // Get all floorplans for all offices
  getAllFloorplans(): Observable<OfficeFloorplans[]> {
    return this.http.get<OfficeFloorplans[]>(`${this.baseUrl}`).pipe(
      catchError(error => {
        console.error('Error fetching floorplans:', error);
        return of([]);
      })
    );
  }

  // Get floorplan for specific office and floor
  getFloorplan(officeId: string, floorId?: string): Observable<FirebaseSvgResponse> {
    const url = floorId
      ? `${this.baseUrl}/${officeId}/${floorId}`
      : `${this.baseUrl}/${officeId}`;

    console.log("getFloorplan url", url)
    console.log('🔥 Firebase SVG Service - Fetching floorplan:', { officeId, floorId, url });

    return this.http.get<FirebaseSvgResponse>(url).pipe(
      tap(response => console.log('✅ Firebase SVG Response:', response)),
      catchError(error => {
        console.error('❌ Firebase SVG Error:', error);
        throw error;
      })
    );
  }

  // Get SVG URL for a specific office and floor
  getSvgUrl(officeId: string, floorId?: string): Observable<string | null> {
    return this.getFloorplan(officeId, floorId).pipe(
      map((response: any) => response.signedUrl),
      catchError(error => {
        console.error('Error getting SVG URL:', error);
        return of(null);
      })
    );
  }

  // Get all SVG URLs for an office (all floors)
  getOfficeSvgUrls(officeId: string): Observable<string[]> {
    return this.getAllFloorplans().pipe(
      map(offices => {
        const office = offices.find(o => o.officeId === officeId);
        if (!office) return [];

        const urls: string[] = [];

        // Add office-level SVG if exists
        if (office.officeSvg?.signedUrl) {
          urls.push(office.officeSvg.signedUrl);
        }

        // Add floor-level SVGs
        office.floors.forEach(floor => {
          if (floor.signedUrl) {
            urls.push(floor.signedUrl);
          }
        });

        return urls;
      }),
      catchError(error => {
        console.error('Error getting office SVG URLs:', error);
        return of([]);
      })
    );
  }

  // Get SVG URLs for specific floor
  getFloorSvgUrls(officeId: string, floorId: string): Observable<string[]> {
    return this.getFloorplan(officeId, floorId).pipe(
      map((response: any) => response.signedUrl ? [response.signedUrl] : []),
      catchError(error => {
        console.error('Error getting floor SVG URLs:', error);
        return of([]);
      })
    );
  }

  // Build mapping of office floors to SVG URLs
  buildOfficeFloorMapping(): Observable<Map<string, Map<string, string[]>>> {
    return this.getAllFloorplans().pipe(
      map(offices => {
        const mapping = new Map<string, Map<string, string[]>>();

        offices.forEach(office => {
          const officeMap = new Map<string, string[]>();

          // Add office-level SVG
          if (office.officeSvg?.signedUrl) {
            officeMap.set('office', [office.officeSvg.signedUrl]);
          }

          // Add floor-level SVGs
          office.floors.forEach(floor => {
            if (floor.floorId && floor.signedUrl) {
              const existing = officeMap.get(floor.floorId) || [];
              officeMap.set(floor.floorId, [...existing, floor.signedUrl]);
            }
          });

          mapping.set(office.officeId, officeMap);
        });

        return mapping;
      }),
      catchError(error => {
        console.error('Error building office floor mapping:', error);
        return of(new Map());
      })
    );
  }

}