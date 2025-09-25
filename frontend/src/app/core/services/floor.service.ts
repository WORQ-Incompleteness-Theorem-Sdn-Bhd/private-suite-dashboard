import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, of, switchMap } from 'rxjs';
import { Floor, FloorResponse } from '../models/floor.model';
import { FirebaseSvgService } from './firebase-svg.service';
import { environment } from '../../environments/environment.prod';

@Injectable({
  providedIn: 'root'
})
export class FloorService {
  private url = environment.bqUrl;

  // TEMPORARY: Local assets mapping (using local SVGs while SVG cloud is being fixed)
  // TODO: Switch back to Firebase cloud storage once SVG cloud issues are resolved
  private fallbackSvgMap: Record<string, Record<string, string[]>> = {
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
    },
    // Add STO office mapping (you'll need to get the correct office ID)
    'STO_OFFICE_ID': { // STO - Replace with actual office ID
      'floor_11': ['assets/STO-Level11.svg'],
      'floor_12': ['assets/STO-Level12.svg'],
      'floor_14': ['assets/STO-Level14.svg']
    }
  };

  // TEMPORARY: Flag to control whether to use local assets or Firebase cloud
  // Set to false when SVG cloud is ready
  private useLocalAssets = true;

  constructor(private http: HttpClient, private firebaseSvgService: FirebaseSvgService) {}

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
    
    if (this.useLocalAssets) {
      // Use local assets (temporary solution while SVG cloud is being fixed)
      console.log('📁 Using local assets (SVG cloud temporarily disabled)');
      return this.getLocalSvgFilesForFloor(officeId, floorId, floors);
    } else {
      // Use Firebase cloud storage (when ready)
      return this.firebaseSvgService.getFloorSvgUrls(officeId, floorId).pipe(
        tap(firebaseUrls => console.log('🔥 Firebase URLs received:', firebaseUrls)),
        switchMap(firebaseUrls => {
          if (firebaseUrls.length > 0) {
            console.log('✅ Using Firebase SVGs:', firebaseUrls);
            return of(firebaseUrls);
          }
          
          console.log('⚠️ No Firebase SVGs found, falling back to local assets');
          return this.getLocalSvgFilesForFloor(officeId, floorId, floors);
        })
      );
    }
  }

  // Helper method to get local SVG files
  private getLocalSvgFilesForFloor(officeId: string, floorId: string, floors?: Floor[]): Observable<string[]> {
    const outletFloors = this.fallbackSvgMap[officeId];
    if (!outletFloors) {
      console.log('❌ No local SVGs found for office:', officeId);
      return of([]);
    }

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
  }

  // Get all SVG files for an outlet
  getAllSvgFilesForOutlet(officeId: string): Observable<string[]> {
    if (this.useLocalAssets) {
      // Use local assets (temporary solution while SVG cloud is being fixed)
      console.log('📁 Using local assets for outlet (SVG cloud temporarily disabled)');
      return this.getLocalSvgFilesForOutlet(officeId);
    } else {
      // Use Firebase cloud storage (when ready)
      return this.firebaseSvgService.getOfficeSvgUrls(officeId).pipe(
        switchMap(firebaseUrls => {
          if (firebaseUrls.length > 0) {
            return of(firebaseUrls);
          }
          
          console.log('⚠️ No Firebase SVGs found, falling back to local assets');
          return this.getLocalSvgFilesForOutlet(officeId);
        })
      );
    }
  }

  // Helper method to get all local SVG files for an outlet
  private getLocalSvgFilesForOutlet(officeId: string): Observable<string[]> {
    const outletFloors = this.fallbackSvgMap[officeId];
    if (!outletFloors) {
      console.log('❌ No local SVGs found for office:', officeId);
      return of([]);
    }

    const allSvgs: string[] = [];
    Object.values(outletFloors).forEach(svgFiles => {
      allSvgs.push(...svgFiles);
    });
    
    console.log('📁 Using local SVGs for outlet:', allSvgs);
    return of(allSvgs);
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

  // TEMPORARY: Method to switch back to Firebase cloud storage when ready
  // Call this method when SVG cloud issues are resolved
  // Example: this.floorService.enableFirebaseCloudStorage();
  enableFirebaseCloudStorage(): void {
    this.useLocalAssets = false;
    console.log('🔥 Switched to Firebase cloud storage for SVGs');
  }

  // TEMPORARY: Method to switch back to local assets if needed
  enableLocalAssets(): void {
    this.useLocalAssets = true;
    console.log('📁 Switched to local assets for SVGs');
  }
}
