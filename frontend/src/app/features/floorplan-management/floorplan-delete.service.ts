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
   * Delete a floorplan by officeId and optional floorId
   * @param officeId - The office/outlet ID
   * @param floorId - The floor ID (optional - omit for office-level floorplans)
   * @returns Observable with deletion response
   */
  deleteFloorplan(officeId: string, floorId?: string | null): Observable<DeleteFloorplanResponse> {
    // Build URL based on whether floorId is provided
    const url = floorId
      ? `${this.baseUrl}/${officeId}/${floorId}`  // Floor-level: /api/floorplans/{officeId}/{floorId}
      : `${this.baseUrl}/${officeId}`;            // Office-level: /api/floorplans/{officeId}

    console.log('🗑️ Deleting floorplan:', {
      officeId,
      floorId: floorId || 'office-level',
      url,
      type: floorId ? 'floor-level' : 'office-level'
    });

    return this.http.delete<DeleteFloorplanResponse>(url);
  }
}
