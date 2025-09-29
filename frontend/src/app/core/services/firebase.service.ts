// firebase-svg.service.ts handle firebase cloud storage svg urls from backend
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { environment } from '../../environments/environment.prod';

export interface FirebaseSvgResponse {
  ok: boolean;
  bucket: string;
  path: string;
  signedUrl: string | null;
  contentType: string;
  size: number;
  updated: string;
  metadata: any;
}

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
  private baseUrl = environment.floorplanUrl; // Floorplan API URL

  constructor(private http: HttpClient) {}

  // Get all floorplans for all offices
  getAllFloorplans(): Observable<OfficeFloorplans[]> {
    console.log('🌐 Firebase Service - Fetching all floorplans from cloud API:', `${this.baseUrl}/floorplans`);
    // 🖼️ SVG CLOUD RETRIEVAL: Get all floorplans from Firebase Cloud Storage
    return this.http.get<OfficeFloorplans[]>(`${this.baseUrl}/floorplans`).pipe( // 🔍 LINE 45: SVG CLOUD - Firebase Cloud Storage
      tap(response => console.log('✅ Cloud floorplans response:', response)),
      catchError(error => {
        console.error('❌ Error fetching floorplans from cloud:', error);
        return of([]);
      })
    );
  }

  // Get floorplan for specific office and floor
  getFloorplan(officeId: string, floorId?: string): Observable<FirebaseSvgResponse> {
    const url = floorId 
      ? `${this.baseUrl}/floorplans/${officeId}/${floorId}`
      : `${this.baseUrl}/floorplans/${officeId}`;
    
    console.log('🔥 Firebase SVG Service - Fetching floorplan from cloud:', { officeId, floorId, url });
    console.log('🌐 Full API URL:', url);
    
    // Debug: Check if this is MUB or ITG
    if (officeId.includes('mub') || officeId.toLowerCase().includes('mub')) {
      console.log('🏢 [FIREBASE DEBUG] Loading floorplan for MUB:', { officeId, floorId, url });
    }
    if (officeId.includes('itg') || officeId.toLowerCase().includes('itg')) {
      console.log('🏢 [FIREBASE DEBUG] Loading floorplan for ITG:', { officeId, floorId, url });
    }
    
    // 🖼️ SVG CLOUD RETRIEVAL: Get specific floorplan from Firebase Cloud Storage
    return this.http.get<FirebaseSvgResponse>(url).pipe( // 🔍 LINE 64: SVG CLOUD - Firebase Cloud Storage
      tap(response => {
        console.log('✅ Firebase Cloud Response:', response);
        if (response.signedUrl) {
          console.log('🔥 Signed URL source:', response.signedUrl.includes('firebasestorage.googleapis.com') ? 'Firebase Cloud Storage' : 'Other');
        } else {
          console.log('⚠️ [FIREBASE DEBUG] No signedUrl in response for officeId:', officeId);
        }
      }),
      catchError(error => {
        console.error('❌ Firebase Cloud Error for officeId:', officeId, error);
        // Debug: Check if this is MUB or ITG that failed
        if (officeId.includes('mub') || officeId.toLowerCase().includes('mub')) {
          console.log('❌ [FIREBASE DEBUG] MUB SVG loading failed:', { officeId, error: error.message });
        }
        if (officeId.includes('itg') || officeId.toLowerCase().includes('itg')) {
          console.log('❌ [FIREBASE DEBUG] ITG SVG loading failed:', { officeId, error: error.message });
        }
        throw error;
      })
    );
  }

  // Get SVG URL for a specific office and floor
  getSvgUrl(officeId: string, floorId?: string): Observable<string | null> {
    return this.getFloorplan(officeId, floorId).pipe(
      map(response => response.signedUrl),
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
      map(response => response.signedUrl ? [response.signedUrl] : []),
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
