import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, catchError, of, switchMap } from 'rxjs';
import { Floor, FloorResponse } from '../models/floor.model';
import { environment } from '../../environments/environment';
import { FirebaseSvgItem, FirebaseSvgService } from './firebase.service';


@Injectable({
  providedIn: 'root'
})
export class FloorService {
  private url = `${environment.apiBaseUrl}/api/floorplans`;
  private bqUrl = `${environment.apiBaseUrl}/api/bigquery`;
  private fallbackSvgMap: Record<string, Record<string, string[]>> = {}
  constructor(private http: HttpClient, private firebaseSvgService: FirebaseSvgService) { }

  getFloors(): Observable<Floor[]> {
    return this.http.get<FloorResponse>(`${this.bqUrl}/floors`).pipe(
      map(response => (response.data || []).map((f: any) => ({
        ...f,
        // normalize location id field for downstream consumers
        location_id: f.location_id ?? f.office_id ?? f.locationId ?? f.outlet_id ?? null,
      }) as Floor)),
      tap((floors) => {
        if (floors.length > 0) {
          console.log('Floor service normalized sample:', {
            floor_id: floors[0].floor_id,
            floor_no: (floors as any)[0].floor_no,
            floor_name: (floors as any)[0].floor_name,
            location_id: (floors as any)[0].location_id,
          });
        }
      })
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
  getSvgFilesForFloor(officeId: string, floorId: string, floors?: Floor[]): Observable<string[]> {
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
            return svgFiles;
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
                return svgFiles;
              }
            }
          }
        }

        console.log('❌ No local SVGs found for floor');
        return [];
      })
    );
  }

  // Get all SVG files for an outlet
  getAllSvgFilesForOutlet(officeId: string): Observable<string[]> {
    // Prefer unified API that already resolves signed/public URLs
    return this.getFloorplanUrls(officeId).pipe(
      switchMap(urls => {
        if (urls && urls.length > 0) {
          return of(urls);
        }

        // Fallback: try older office-level aggregation
        return this.firebaseSvgService.getOfficeSvgUrls(officeId).pipe(
          map(firebaseUrls => {
            if (firebaseUrls.length > 0) {
              return firebaseUrls;
            }

            // Final fallback to static mapping (assets)
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
      }),
      catchError(err => {
        console.error('getAllSvgFilesForOutlet error:', err);
        return of<string[]>([]);
      })
    );
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

  /**
   * Get floor label from floor_id using floorIdToFloorMap
   * Returns formatted floor label like "Level 5", "Level G", etc.
   */
  getFloorLabelFromMap(floorId: string, floorIdToFloorMap: Map<string, any>): string {
    // Special case for Sibelco Office
    if (floorId === '6348ba804d92f2ab589dc7e3') {
      return 'Sibelco Office';
    }

    const floor = floorIdToFloorMap.get(floorId);
    if (floor && floor.floor_no) {
      // Remove "L" prefix if present and format as "Level {number}"
      // e.g., "L12" -> "Level 12", "L3A" -> "Level 3A"
      const floorNo = floor.floor_no.trim();
      const floorNumber = floorNo.startsWith('L') || floorNo.startsWith('l')
        ? floorNo.substring(1).trim()
        : floorNo;
      return `Level ${floorNumber}`;
    }

    return 'N/A';
  }

  getFloorplanUrls(officeId: string, floorId?: string): Observable<string[]> {
    // Ask backend for signed URLs when available; fallback to raw
    const base = floorId
      ? `${this.url}/${officeId}/${floorId}`
      : `${this.url}/${officeId}`;
    const url = `${base}?signed=1`;

    console.log("🔗 getFloorplan URL:", url);
    console.log("🔗 Base URL:", this.url);
    console.log("🔥 Fetching floorplan from backend:", { officeId, floorId, fullUrl: url });

    return this.http.get<any>(url).pipe(
      tap({
        next: (resp) => {
          console.log('✅ HTTP Request succeeded');
          console.log('📦 Raw backend response:', JSON.stringify(resp, null, 2));
          console.log('📦 Response type:', typeof resp);
          console.log('📦 Response type check:', {
            ok: resp?.ok,
            scope: resp?.scope,
            bucket: resp?.bucket,
            hasItems: !!resp?.items,
            itemsLength: resp?.items?.length || 0,
            count: resp?.count || 0,
            fullResponse: resp
          });
          
          if (!resp) {
            console.error('❌ Response is null/undefined!');
            return;
          }
          
          if (resp.ok === false || resp.ok === undefined) {
            console.warn('⚠️ Response not OK:', resp);
            return;
          }
          
          if (resp.scope === 'list') {
            console.log(`📋 List response: ${resp.items?.length || resp.count || 0} items`);
            if (resp.items && Array.isArray(resp.items) && resp.items.length > 0) {
              console.log('📋 Items found:', resp.items.map((it: any, idx: number) => ({
                index: idx + 1,
                path: it.path,
                hasSignedUrl: !!it.signedUrl,
                size: it.size,
                contentType: it.contentType,
                fullItem: it
              })));
            } else {
              console.warn(`⚠️ No items in response for officeId: ${officeId}, floorId: ${floorId || 'none'}`);
              console.warn('⚠️ Items array:', resp.items);
            }
          } else if (resp.scope === 'single') {
            console.log('📄 Single response:', { path: resp.path, hasSignedUrl: !!resp.signedUrl });
          } else {
            console.warn('⚠️ Unknown scope:', resp.scope);
          }
        },
        error: (err) => {
          // Only log as error if it's not a 404 (expected for missing floors)
          if (err?.status !== 404) {
            console.error('❌ HTTP Request failed in tap:', err);
          } else {
            console.log('⚠️ Floor SVG not found (404) - this is expected for floors without SVGs');
          }
        }
      }),
      map((resp: any) => {
        if (!resp || !resp.ok) {
          console.warn('⚠️ Invalid response, returning empty array');
          return [];
        }
        
        if (resp.scope === "single") {
          const item: FirebaseSvgItem = {
            path: resp.path,
            signedUrl: resp.signedUrl || null,
            contentType: resp.contentType || null,
            size: resp.size || null,
            updated: resp.updated || null,
            metadata: resp.metadata || null,
          };
          const builtUrl = this.buildSvgUrl(resp.bucket, item);
          console.log('✅ Built single SVG URL:', builtUrl);
          return [builtUrl];
        }
        
        if (resp.scope === "list") {
          if (!resp.items || !Array.isArray(resp.items) || resp.items.length === 0) {
            console.warn('⚠️ List response has no items array or array is empty');
            console.warn('⚠️ Response details:', { 
              ok: resp?.ok, 
              scope: resp?.scope, 
              count: resp?.count,
              items: resp?.items 
            });
            return [];
          }
          
          const bucket = resp.bucket || 'floorplan-dashboard-2a468.firebasestorage.app';
          console.log(`🔨 Building URLs for ${resp.items.length} items using bucket: ${bucket}`);
          console.log(`📋 Backend returned ALL SVGs recursively for office: ${officeId} (total: ${resp.items.length} SVGs)`);
          
          const urls = resp.items.map((it: any, index: number) => {
            const item: FirebaseSvgItem = {
              path: it.path,
              signedUrl: it.signedUrl || null,
              contentType: it.contentType || null,
              size: it.size || null,
              updated: it.updated || null,
              metadata: it.metadata || null,
            };
            const builtUrl = this.buildSvgUrl(bucket, item);
            console.log(`  [${index + 1}/${resp.items.length}] Path: ${it.path} → URL: ${builtUrl}`);
            return builtUrl;
          });
          
          console.log(`✅ Successfully built ${urls.length} SVG URLs (ALL outlet floorplans):`, urls);
          return urls;
        }
        
        console.warn('⚠️ Unknown response scope:', resp.scope);
        return [];
      }),
      catchError(error => {
        // Only log as error if it's not a 404 (expected for missing floors)
        if (error?.status !== 404) {
          console.error('❌ HTTP Error fetching floorplans:', error);
          console.error('❌ Error details:', {
            status: error?.status,
            statusText: error?.statusText,
            url: error?.url || url,
            message: error?.message,
            error: error?.error,
            headers: error?.headers
          });
        } else {
          console.log('⚠️ Floor SVG not found (404) - this is expected for floors without SVGs');
        }
        return of<string[]>([]);
      })
    );
  }
 
  // --- helper to build a usable URL from Firebase Storage
  // Always returns Firebase Storage URLs (either signed URLs or Firebase download URLs)
  private buildSvgUrl(bucket: string, item: FirebaseSvgItem): string {
    // 1. Prefer server-provided signed URL (direct Firebase Storage signed URL)
    if (item.signedUrl && item.signedUrl.trim()) {
      console.log('✅ Using signed URL from backend:', item.signedUrl);
      return item.signedUrl;
    }

    // 2. Build Firebase Storage download URL using token from metadata
    const encodedPath = encodeURIComponent(item.path);
    const rawToken = item.metadata?.firebaseStorageDownloadTokens ?? "";
    const token = rawToken.split(",")[0]?.trim();

    if (token) {
      const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodedPath}?alt=media&token=${encodeURIComponent(token)}`;
      console.log('✅ Built Firebase Storage URL with token:', firebaseUrl);
      return firebaseUrl;
    }

    // 3. Use backend API raw proxy endpoint as fallback (backend will fetch from Firebase)
    // Parse path to extract officeId and floorId
    try {
      const parts = item.path.split("/").filter(p => p.length > 0);
      
      let officeId: string | undefined;
      let floorId: string | undefined;
      
      if (parts.length >= 3) {
        // Has floorId: [officeId, floorId, filename]
        officeId = parts[parts.length - 3];
        floorId = parts[parts.length - 2];
      } else if (parts.length === 2) {
        // Office-level: [officeId, filename]
        officeId = parts[0];
        // Check if first part is a prefix (like "floorplans")
        const firstPart = parts[0];
        const isLikelyOfficeId = /^[0-9a-f]{24}$/i.test(firstPart);
        if (!isLikelyOfficeId && (firstPart === 'floorplans' || firstPart === 'floorplan')) {
          officeId = parts[1];
        }
      }
      
      // Use backend API to proxy Firebase Storage content
      if (officeId && floorId) {
        const backendUrl = `${this.url}/${officeId}/${floorId}?raw=1`;
        console.log('✅ Using backend API proxy URL (with floorId):', backendUrl);
        return backendUrl;
      }
      
      if (officeId && !floorId) {
        const backendUrl = `${this.url}/${officeId}?raw=1`;
        console.log('✅ Using backend API proxy URL (office-level):', backendUrl);
        return backendUrl;
      }
    } catch (err) {
      console.warn('⚠️ Error parsing path for backend proxy:', item.path, err);
    }

    // 4. Final fallback: try to build a public GCS URL (may not work if bucket is private)
    const publicGcs = `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${encodeURI(item.path)}`;
    console.warn('⚠️ Using public GCS URL fallback (may not work):', publicGcs);
    return publicGcs;
  }

}
