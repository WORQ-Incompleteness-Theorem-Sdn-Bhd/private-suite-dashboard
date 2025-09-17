import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, catchError, of } from 'rxjs';
import { Floor, FloorResponse } from '../models/floor.model';
import { environment } from '../../environments/environment.dev';

@Injectable({
  providedIn: 'root'
})
export class FloorService {
  private url = environment.floorplanUrl;

  // Fallback mapping for local assets (only used if Firebase is unavailable)
  /*private fallbackSvgMap: Record<string, Record<string, string[]>> = {
    '5db8fb7e35798d0010950a77': { // TTDI
      'floor_1': ['assets/TTDI-Level1.svg'],
      'floor_3a': ['assets/TTDIlevel3A.svg'],
      'floor_sibelco': ['assets/Sibelco Office - L1.svg']
    },
    '62a9832b43c9f437e373e9dd': { // KLS
      'floor_20': ['assets/KLS- L20.svg'],
      'floor_21_byte': ['assets/KLS-ByteDance.svg'],
      'floor_21': ['assets/KLS-L21.svg'],
      'floor_28': ['assets/KLS-L28.svg']
    },
    '63f5de531f29f60007ca8209': { // MUB
      'floor_9': ['assets/MUB-level9.svg'],
      'floor_12': ['assets/MUB-level12.svg'],
      'floor_17': ['assets/MUB-level17.svg']
    },
    '66dfd21d5ec307e20a9b761c': { // UBP3A
      'floor_13a': ['assets/UBP-L13A.svg'],
      'floor_13a_airit': ['assets/UBP-L13AAIRIT.svg']
    },
    '67ad665a9aa9ef620e693aa0': { // 8FA
      'floor_15': ['assets/8FA.svg']
    },
    '65e56bd7a24b74cef513834f': { // ITG
      'floor_9': ['assets/ITG.svg']
    },
    '565748274a955c790d808c77': { // UBP
      'floor_2': ['assets/UBP.svg']
    },
    '5dac63c998e930010a595016': { // KLG
      'floor_3': ['assets/KLG.svg']
    },
    '671f3dbf0951c4dfbaaadd5d': { // SV2
      'floor_12': ['assets/SV2.svg']
    },
    '6537957cc3653d2412ab4d7e': { // SPM
      'floor_4': ['assets/SPM.svg']
    }
  };*/

  constructor(private http: HttpClient) {}

  getFloors(): Observable<Floor[]> {
    return this.http.get<FloorResponse>(`${this.url}/floors`).pipe(
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

  // Get SVG files for a specific floor and outlet
  getSvgFilesForFloor(officeId: string, floorId: string, floors?: Floor[]): Observable<string[]> {
    console.log('🏢 Floor Service - Getting SVGs for floor:', { officeId, floorId });
    
    // Call backend API which handles Firebase operations
    return this.http.get<any>(`${this.url}/${officeId}/${floorId}`).pipe(
      map(response => response.signedUrl ? [response.signedUrl] : []),
      catchError(error => {
        console.error('Error getting floor SVGs:', error);
        return of([]);
      })
    );
  }

  // Get all SVG files for an outlet
  getAllSvgFilesForOutlet(officeId: string): Observable<string[]> {
    // Call backend API which handles Firebase operations
    return this.http.get<any>(`${this.url}/${officeId}`).pipe(
      map(response => response.signedUrl ? [response.signedUrl] : []),
      catchError(error => {
        console.error('Error getting office SVGs:', error);
        return of([]);
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
}
