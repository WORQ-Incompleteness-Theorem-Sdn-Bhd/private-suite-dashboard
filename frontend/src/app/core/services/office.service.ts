import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, map, catchError, switchMap, combineLatest } from 'rxjs/operators';
import { Office, OfficeResponse } from '../models/office.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OfficeService {
  private officesSubject = new BehaviorSubject<Office[]>([]);
  offices$ = this.officesSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();

  constructor(private http: HttpClient) {}

  loadOffices(): Observable<OfficeResponse> {
    this.loadingSubject.next(true);    
    // Get offices from BigQuery only
    return this.http.get<any>(`${environment.apiBaseUrl}/api/bigquery/locations`).pipe(
      map(bqResponse => {
        const bqOffices = bqResponse.data || [];
        
        // Map BigQuery office data to Office interface
        const officesFromBq = bqOffices
          .filter((office: any) => {
            // Only include offices with valid location_id and location_name
            const hasValidId = office.location_id && office.location_id.trim() !== '';
            const hasValidName = office.location_name && office.location_name.trim() !== '';
            return hasValidId && hasValidName;
          })
          .map((office: any) => {
            return {
              id: office.location_id,
              name: office.location_name,
              displayName: office.location_name, // Use BigQuery location_name directly
              svg: [] // SVGs loaded dynamically from Firebase Storage
            } as Office;
          });


        return {
          data: officesFromBq,
          success: true,
          message: 'Offices loaded successfully from BigQuery'
        };
      }),
      tap((response: OfficeResponse) => {
        if (response.success && response.data) {
          this.officesSubject.next(response.data);
        }
        this.loadingSubject.next(false);
      }),
      catchError(error => {

        // Return empty array if BigQuery fails
        const fallbackResponse = {
          data: [],
          success: false,
          message: 'Failed to load offices from BigQuery'
        };
        this.officesSubject.next([]);
        this.loadingSubject.next(false);
        return of(fallbackResponse);
      })
    );
  }

  getOffices(): Office[] {
    return this.officesSubject.value;
  }

  getOfficeById(id: string): Office | undefined {
    return this.officesSubject.value.find(office => office.id === id);
  }

  /**
   * Temporarily set filtered offices in the subject
   * Used by dashboard to show only offices with floorplans
   * @param offices Filtered office array
   */
  setFilteredOffices(offices: Office[]): void {
    this.officesSubject.next(offices);
  }

  /**
   * Load offices and filter by floorplans availability
   * This method loads all offices, filters them by floorplan availability, and updates the BehaviorSubject
   * Use this for dashboard to ensure only offices with floorplans are shown
   * @returns Observable with success status and count
   */
  loadOfficesWithFloorplans(): Observable<{ success: boolean; count: number }> {
    this.loadingSubject.next(true);

    // First load all offices, but DON'T update the subject yet
    return this.http.get<any>(`${environment.apiBaseUrl}/api/bigquery/locations`).pipe(
      map(bqResponse => {
        const bqOffices = bqResponse.data || [];

        // Map BigQuery office data to Office interface
        const officesFromBq = bqOffices
          .filter((office: any) => {
            const hasValidId = office.location_id && office.location_id.trim() !== '';
            const hasValidName = office.location_name && office.location_name.trim() !== '';
            return hasValidId && hasValidName;
          })
          .map((office: any) => {
            return {
              id: office.location_id,
              name: office.location_name,
              displayName: office.location_name, // Use BigQuery location_name directly
              svg: [] // SVGs loaded dynamically from Firebase Storage
            } as Office;
          });

        return officesFromBq;
      }),
      switchMap((allOffices: Office[]) => {
        // Now get floorplans to filter
        return this.http.get<any[]>(`${environment.apiBaseUrl}/api/floorplans`).pipe(
          map(floorplans => {
            if (!floorplans || floorplans.length === 0) {
              return [];
            }

            // Extract unique office IDs that have floorplans
            const officeIdsWithFloorplans = new Set<string>();
            floorplans.forEach((fp: any) => {
              if (fp.officeId) {
                officeIdsWithFloorplans.add(fp.officeId);
              }
            });


            // Filter offices to only those with floorplans
            const filteredOffices = allOffices.filter(office =>
              officeIdsWithFloorplans.has(office.id)
            );

            return filteredOffices;
          }),
          catchError(error => {

            return of<Office[]>([]);
          })
        );
      }),
      tap((filteredOffices: Office[]) => {
        // Update the BehaviorSubject with filtered offices only
        this.officesSubject.next(filteredOffices);
        this.loadingSubject.next(false);
      }),
      map((filteredOffices: Office[]) => ({
        success: true,
        count: filteredOffices.length
      })),
      catchError(error => {

        this.officesSubject.next([]);
        this.loadingSubject.next(false);
        return of({ success: false, count: 0 });
      })
    );
  }

  /**
   * Get offices that have at least one floorplan uploaded
   * @param filterByFloorplans If true, only return offices with floorplans; if false, return all offices
   * @returns Observable of offices (filtered or all)
   */
  getOfficesWithFloorplans(filterByFloorplans: boolean = true): Observable<Office[]> {
    if (!filterByFloorplans) {
      // Return all offices without filtering
      return this.offices$;
    }

    // Get all floorplans from backend
    return this.http.get<any[]>(`${environment.apiBaseUrl}/api/floorplans`).pipe(
      combineLatest(this.offices$),
      map(([floorplans, allOffices]) => {
        if (!floorplans || floorplans.length === 0) {
          return [];
        }

        // Extract unique office IDs that have floorplans
        const officeIdsWithFloorplans = new Set<string>();
        floorplans.forEach((fp: any) => {
          if (fp.officeId) {
            officeIdsWithFloorplans.add(fp.officeId);
          }
        });


        // Filter offices to only those with floorplans
        const filteredOffices = allOffices.filter(office =>
          officeIdsWithFloorplans.has(office.id)
        );

        return filteredOffices;
      }),
      catchError(error => {

        // On error, return empty array (will show "No floorplans available")
        return of<Office[]>([]);
      })
    );
  }
}
