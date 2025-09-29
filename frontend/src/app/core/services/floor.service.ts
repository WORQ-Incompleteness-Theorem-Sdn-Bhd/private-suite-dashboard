import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, of, switchMap } from 'rxjs';
import { Floor, FloorResponse } from '../models/floor.model';
import { FirebaseSvgService } from './firebase.service';
import { environment } from '../../environments/environment.prod';

@Injectable({
  providedIn: 'root'
})
export class FloorService {
  private url = environment.bqUrl;

  // REMOVED: Local assets mapping - now using CLOUD ONLY mode
  // All SVG files must come from Firebase Cloud Storage

  // CLOUD ONLY MODE: All SVG files must come from Firebase Cloud Storage

  constructor(private http: HttpClient, private firebaseSvgService: FirebaseSvgService) {}

  getFloors(): Observable<Floor[]> {
    console.log('🌐 Floor Service - Fetching floors from cloud API:', `${this.url}/floors`);
    return this.http.get<FloorResponse>(`${this.url}/floors`).pipe( // 🔍 LINE 23: SQL QUERY - GET /api/bigquery/floors
      tap(response => console.log('✅ Cloud floors response:', response)),
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

  // Get floors grouped by office (if needed for filtering)
  getFloorsByOffice(officeId: string): Observable<Floor[]> {
    return this.getFloors().pipe(
      map(floors => floors.filter(floor => 
        // You might need to add office_id filtering here if the backend supports it
        // For now, return all floors
        true
      ))
    );
  }

  // Get SVG files for a specific floor and outlet - CLOUD ONLY MODE
  getSvgFilesForFloor(officeId: string, floorId: string, floors?: Floor[]): Observable<string[]> {
    console.log('🏢 Floor Service - Getting SVGs for floor:', { officeId, floorId });
    console.log('☁️ FORCED CLOUD MODE - No local fallback');
    console.log('☁️ API endpoint:', `${environment.floorplanUrl}/${officeId}/${floorId}`);
    
    // 🖼️ SVG CLOUD RETRIEVAL: ONLY use Firebase cloud storage - no local fallback
    return this.firebaseSvgService.getFloorSvgUrls(officeId, floorId).pipe( // 🔍 LINE 71: SVG CLOUD - Firebase Cloud Storage
      tap((firebaseUrls: string[]) => {
        console.log('🔥 Firebase Cloud URLs received:', firebaseUrls);
        firebaseUrls.forEach((url, index) => {
          console.log(`🔥 SVG ${index + 1}: ${url}`);
          console.log(`🔥 Source: ${url.includes('firebasestorage.googleapis.com') ? 'Firebase Cloud Storage' : 'Other'}`);
        });
      }),
      switchMap((firebaseUrls: string[]) => {
        if (firebaseUrls.length > 0) {
          console.log('✅ SUCCESS: Using Firebase Cloud SVGs:', firebaseUrls);
          return of(firebaseUrls);
        }
        
        console.log('❌ ERROR: No Firebase SVGs found - NO FALLBACK TO LOCAL ASSETS');
        console.log('❌ This will result in empty SVG array - check cloud storage');
        return of([]); // Return empty array instead of falling back to local
      })
    );
  }

  // REMOVED: Local SVG helper methods - now using CLOUD ONLY mode

  // Get all SVG files for an outlet - CLOUD ONLY MODE
  getAllSvgFilesForOutlet(officeId: string): Observable<string[]> {
    console.log('☁️ FORCED CLOUD MODE - Getting all SVGs for outlet:', officeId);
    console.log('☁️ API endpoint:', `${environment.floorplanUrl}/${officeId}`);
    
    // Debug: Check if this is MUB or ITG
    if (officeId.includes('mub') || officeId.toLowerCase().includes('mub')) {
      console.log('🏢 [SVG DEBUG] Loading SVGs for MUB outlet:', officeId);
    }
    if (officeId.includes('itg') || officeId.toLowerCase().includes('itg')) {
      console.log('🏢 [SVG DEBUG] Loading SVGs for ITG outlet:', officeId);
    }
    
    // 🖼️ SVG CLOUD RETRIEVAL: ONLY use Firebase cloud storage - no local fallback
    return this.firebaseSvgService.getOfficeSvgUrls(officeId).pipe( // 🔍 LINE 100: SVG CLOUD - Firebase Cloud Storage
      tap((firebaseUrls: string[]) => {
        console.log('🔥 Firebase Cloud URLs for outlet:', firebaseUrls);
        firebaseUrls.forEach((url, index) => {
          console.log(`🔥 Outlet SVG ${index + 1}: ${url}`);
          console.log(`🔥 Source: ${url.includes('firebasestorage.googleapis.com') ? 'Firebase Cloud Storage' : 'Other'}`);
        });
      }),
      switchMap((firebaseUrls: string[]) => {
        if (firebaseUrls.length > 0) {
          console.log('✅ SUCCESS: Using Firebase Cloud SVGs for outlet:', firebaseUrls);
          return of(firebaseUrls);
        }
        
        console.log('❌ ERROR: No Firebase SVGs found for outlet - NO FALLBACK TO LOCAL ASSETS');
        console.log('❌ This will result in empty SVG array - check cloud storage');
        return of([]); // Return empty array instead of falling back to local
      })
    );
  }

  // REMOVED: Local SVG helper methods - now using CLOUD ONLY mode

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

  // TEMPORARY: Method to switch back to Firebase cloud storage when ready
  // CLOUD ONLY MODE: No switching methods needed - always uses Firebase Cloud Storage
}
