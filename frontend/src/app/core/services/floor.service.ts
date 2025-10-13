import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, catchError, of, switchMap } from 'rxjs';
import { Floor, FloorResponse } from '../models/floor.model';
import { environment } from '../../environments/environment.prod';
import { FirebaseSvgItem, FirebaseSvgResponse, FirebaseSvgService } from './firebase.service';


@Injectable({
  providedIn: 'root'
})
export class FloorService {
  private url = environment.floorplanUrl;
  private bqUrl = environment.bqUrl;
  private fallbackSvgMap: Record<string, Record<string, string[]>> = {}
  constructor(private http: HttpClient, private firebaseSvgService: FirebaseSvgService) { }

  getFloors(): Observable<Floor[]> {
    return this.http.get<FloorResponse>(`${this.bqUrl}/floors`).pipe(
      map(response => response.data || [])
    );
  }

  // Extract floor number from floor_name (e.g., "Level 1" -> "1", "Level 3A" -> "3A")
  extractFloorNumber(floorName: string): string {
    if (!floorName) return '';

    // Special case for Sibelco Office
    if (floorName.toLowerCase().includes('sibelco')) {
      return 'Sibelco Office';
    }

    // Match patterns like "Level 1", "Level 3A", "Floor 2", etc.
    const match = floorName.match(/(?:level|lvl|floor|f)[\s\-_]?(\d+[A-Za-z]?)/i);
    if (match) {
      return match[1].toUpperCase();
    }

    // Fallback: extract any number with optional letter
    const numberMatch = floorName.match(/(\d+[A-Za-z]?)/);
    if (numberMatch) {
      return numberMatch[1].toUpperCase();
    }

    return floorName;
  }


  // Get SVG files for a specific floor and outlet
  getSvgFilesForFloor(officeId: string, floorId: string, floors?: Floor[]): Observable<any> {
    console.log('🏢 Floor Service - Getting SVGs for floor:', { officeId, floorId });

    // First try to get from Firebase Cloud Storage
    return this.firebaseSvgService.getFloorSvgUrls(officeId, floorId).pipe(
      tap(firebaseUrls => console.log('🔥 Firebase URLs received:', firebaseUrls)),
      map(firebaseUrls => {
        if (firebaseUrls.length > 0) {
          console.log('✅ Using Firebase SVGs:', firebaseUrls);
          return firebaseUrls;
        }

        console.log('⚠️ No Firebase SVGs found, using fallback');
        // Fallback to static mapping
        const outletFloors = this.fallbackSvgMap[officeId];
        if (!outletFloors) return [];

        // Try to find matching floor mapping
        for (const [floorKey, svgFiles] of Object.entries(outletFloors)) {
          if (floorKey === floorId || floorKey.includes(floorId)) {
            console.log('📁 Using local SVGs:', svgFiles);
            return of(svgFiles);
          }
        }

        // If no direct match, try to match by floor number
        if (floors) {
          const floor = floors.find(f => f.floor_id === floorId);
          if (floor) {
            const floorNumber = this.extractFloorNumber(floor.floor_name);
            for (const [floorKey, svgFiles] of Object.entries(outletFloors)) {
              if (floorKey.includes(floorNumber.toLowerCase())) {
                console.log('📁 Using local SVGs by floor number:', svgFiles);
                return of(svgFiles);
              }
            }
          }
        }

        console.log('❌ No local SVGs found for floor');
        return of([]);
      })
    );
  }

  // Get all SVG files for an outlet
  getAllSvgFilesForOutlet(officeId: string): Observable<string[]> {
    // First try to get from Firebase Cloud Storage
    return this.firebaseSvgService.getOfficeSvgUrls(officeId).pipe(
      map(firebaseUrls => {
        if (firebaseUrls.length > 0) {
          return firebaseUrls;
        }

        // Fallback to static mapping
        const outletFloors = this.fallbackSvgMap[officeId];
        if (!outletFloors) return [];

        const allSvgs: string[] = [];
        Object.values(outletFloors).forEach(svgFiles => {
          allSvgs.push(...svgFiles);
        });
        
        console.log('📁 Using local SVGs for outlet:', allSvgs);
        return allSvgs;
      })
    );
  }

  // Helper method to get floor by ID (you'll need to implement this based on your data structure)
  private getFloorById(floorId: string): Floor | null {
    // This would need to be implemented based on how you store floors
    // For now, return null - you might want to pass floors array to this method
    return null;
  }

  // Create a mapping key for floor based on floor name
  createFloorMappingKey(floorName: string): string {
    const floorNumber = this.extractFloorNumber(floorName);
    return `floor_${floorNumber.toLowerCase().replace(/\s+/g, '_')}`;
  }

  // Get display label for a specific floor ID
  getFloorDisplayLabel(floorId: string, floors: Floor[]): string {
    const floor = floors.find(f => f.floor_id === floorId);
    if (floor) {
      // Special case for Sibelco Office floor ID
      if (floorId === '6348ba804d92f2ab589dc7e3') {
        return 'Sibelco Office';
      }
      return this.extractFloorNumber(floor.floor_name);
    }
    return floorId;
  }


  getFloorplanUrls(officeId: string, floorId?: string): Observable<string[]> {
    const url = floorId
      ? `${this.url}/${officeId}/${floorId}`
      : `${this.url}/${officeId}`;

    console.log("getFloorplan url", url);
    console.log("🔥 Firebase SVG Service - Fetching floorplan:", { officeId, floorId, url });

    return this.http.get<FirebaseSvgResponse>(url).pipe(
      tap(resp => console.log('✅ Firebase SVG Response:', resp)),
      map((resp) => {
        if (!resp?.ok) return [];
        if (resp.scope === "single") {
          const item: FirebaseSvgItem = {
            path: resp.path,
            signedUrl: resp.signedUrl,
            contentType: resp.contentType,
            size: resp.size,
            updated: resp.updated,
            metadata: resp.metadata ?? null,
          };
          return [this.buildSvgUrl((resp as any).bucket, item)];
        }
        // list
        return resp.items.map(it => this.buildSvgUrl((resp as any).bucket, it));
      }),
      catchError(error => {
        console.error('❌ Firebase SVG Error:', error);
        return of<string[]>([]);
      })
    );
  }
 
  // --- helper to build a usable URL 
  private buildSvgUrl(bucket: string, item: FirebaseSvgItem): string {
    // Prefer server-provided signed URL if present
    if (item.signedUrl && item.signedUrl.trim()) return item.signedUrl; 
    // For the Firebase REST (v0) API, the object path must be fully URI-encoded (slashes included)
    const encodedPath = encodeURIComponent(item.path);

    // firebaseStorageDownloadTokens can be a comma-separated list; use the first token
    const rawToken = item.metadata?.firebaseStorageDownloadTokens ?? "";
    const token = rawToken.split(",")[0]?.trim();

    if (token) {
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodedPath}?alt=media&token=${encodeURIComponent(token)}`;
    }

    // Public GCS path style URL — keep slashes, so use encodeURI on the path
    return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${encodeURI(item.path)}`;
  }

}
