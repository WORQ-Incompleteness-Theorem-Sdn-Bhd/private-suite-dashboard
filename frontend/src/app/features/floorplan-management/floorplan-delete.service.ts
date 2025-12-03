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
   * Delete a floorplan by officeId and floorId
   * @param officeId - The office/outlet ID
   * @param floorId - The floor ID
   * @returns Observable with deletion response
   */
  deleteFloorplan(officeId: string, floorId: string): Observable<DeleteFloorplanResponse> {
    const url = `${this.baseUrl}/${officeId}/${floorId}`;
    console.log('🗑️ Deleting floorplan:', { officeId, floorId, url });
    return this.http.delete<DeleteFloorplanResponse>(url);
  }
}
