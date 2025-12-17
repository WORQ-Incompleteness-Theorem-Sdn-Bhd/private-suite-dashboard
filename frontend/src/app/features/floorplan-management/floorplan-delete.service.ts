import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DeleteFloorplanResponse {
  success: boolean;
  message: string;
  deletedFiles: string[];
  officeId: string;
  floorId: string;
}

@Injectable({
  providedIn: 'root'
})
export class FloorplanDeleteService {
  private baseUrl = `${environment.apiBaseUrl}/api/floorplans`;

  constructor(private http: HttpClient) {}

  /**
   * Delete a specific floorplan SVG file by its filename
   * @param officeId - The office/outlet ID
   * @param floorId - The floor ID (optional - omit for office-level floorplans)
   * @param filename - The specific SVG filename to delete (optional - omit to delete all)
   * @returns Observable with deletion response
   */
  deleteFloorplan(officeId: string, floorId?: string | null, filename?: string | null): Observable<DeleteFloorplanResponse> {
    // Build URL based on parameters
    let url: string;

    if (filename) {
      // URL encode the filename to handle special characters like hyphens
      const encodedFilename = encodeURIComponent(filename);
      console.log('[deleteFloorplan] Original filename:', filename);
      console.log('[deleteFloorplan] Encoded filename:', encodedFilename);

      // Delete specific file: /api/floorplans/{officeId}/{floorId}/{filename}
      // or /api/floorplans/{officeId}/{filename} for office-level
      if (floorId) {
        url = `${this.baseUrl}/${officeId}/${floorId}/${encodedFilename}`;
      } else {
        url = `${this.baseUrl}/${officeId}/${encodedFilename}`;
      }
    } else if (floorId) {
      // Delete all floor-level files: /api/floorplans/{officeId}/{floorId}
      url = `${this.baseUrl}/${officeId}/${floorId}`;
    } else {
      // Delete all office-level files: /api/floorplans/{officeId}
      url = `${this.baseUrl}/${officeId}`;
    }

    console.log('[deleteFloorplan] Final DELETE URL:', url);
    return this.http.delete<DeleteFloorplanResponse>(url);
  }
}
