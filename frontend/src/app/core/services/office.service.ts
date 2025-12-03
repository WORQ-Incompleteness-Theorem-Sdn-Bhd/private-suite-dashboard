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

  // Static office data based on the existing outletMap
  private readonly staticOffices: Office[] = [
    {
      id: '67ad665a9aa9ef620e693aa0',
      name: '8FA',
      displayName: '8FA',
      svg: 'assets/8FA.svg',
    },
    {
      id: '65e56bd7a24b74cef513834f',
      name: 'ITG',
      displayName: 'ITG',
      svg: 'assets/ITG.svg',
    },
    {
      id: '565748274a955c790d808c77',
      name: 'UBP',
      displayName: 'UBP',
      svg: 'assets/UBP.svg',
    },
    {
      id: '5dac63c998e930010a595016',
      name: 'KLG',
      displayName: 'KLG',
      svg: 'assets/KLG.svg',
    },
    {
      id: '5db8fb7e35798d0010950a77',
      name: 'TTDI',
      displayName: 'TTDI',
      svg: ['assets/TTDI-Level1.svg', 'assets/TTDIlevel3A.svg', 'assets/Sibelco Office - L1.svg'],
    },
    /*{
      id: '5db8fb9798549f0010df15f3',
      name: 'STO-WIP',
      displayName: 'STO-WIP',
      svg: [
        'assets/STO-Level11.svg',
        'assets/STO-Level12.svg',
        'assets/STO-Level14.svg',
      ],
    },*/
    {
      id: '62a9832b43c9f437e373e9dd',
      name: 'KLS',
      displayName: 'KLS',
      svg: [
        'assets/KLS- L20.svg',
        'assets/KLS-ByteDance.svg',
        'assets/KLS-L21.svg',
        'assets/KLS-L28.svg',
      ],
    },
    {
      id: '63f5de531f29f60007ca8209',
      name: 'MUB',
      displayName: 'MUB',
      svg: [
        'assets/MUB-level9.svg',
        'assets/MUB-level12.svg',
        'assets/MUB-level17.svg',
      ],
    },
    {
      id: '6537957cc3653d2412ab4d7e',
      name: 'SPM',
      displayName: 'SPM',
      svg: 'assets/SPM.svg',
    },
    {
      id: '66dfd21d5ec307e20a9b761c',
      name: 'UBP3A',
      displayName: 'UBP3A',
      svg: ['assets/UBP-L13A.svg', 'assets/UBP-L13AAIRIT.svg'],
    },
    {
      id: '671f3dbf0951c4dfbaaadd5d',
      name: 'SV2',
      displayName: 'SV2',
      svg: 'assets/SV2.svg',
    },
  ];

  constructor(private http: HttpClient) {}

  loadOffices(): Observable<OfficeResponse> {
    this.loadingSubject.next(true);    
    // Get offices from BigQuery only
    return this.http.get<any>(`${environment.apiBaseUrl}/api/bigquery/locations`).pipe(
      map(bqResponse => {
       // console.log('BigQuery response:', bqResponse);
        const bqOffices = bqResponse.data || [];
      //  console.log('BigQuery offices:', bqOffices);
        
        // Map BigQuery office data to Office interface
        const officesFromBq = bqOffices
          .filter((office: any) => {
            // Only include offices with valid location_id and location_name
            const hasValidId = office.location_id && office.location_id.trim() !== ''; 
            const hasValidName = office.location_name && office.location_name.trim() !== '';
            /*console.log('BigQuery office validation:', { 
              office, 
              hasValidId, 
              hasValidName 
            });*/
            return hasValidId && hasValidName;
          })
          .map((office: any) => {
            //console.log('Mapping valid BigQuery office:', office);
            
            // Find matching static office for SVG fallback
            const staticOffice = this.staticOffices.find(so => so.id === office.location_id);
            
            return {
              id: office.location_id,
              name: office.location_name,
              displayName: office.location_name,
              svg: staticOffice?.svg || []
            } as Office;
          });

        //console.log('Mapped offices:', officesFromBq); this to check the outlet's data available in bigquery

        return {
          data: officesFromBq,
          success: true,
          message: 'Offices loaded successfully from BigQuery'
        };
      }),
      tap((response: OfficeResponse) => {
        console.log('Final office response:', response);
        if (response.success && response.data) {
          this.officesSubject.next(response.data);
        }
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        console.error('Error loading offices from BigQuery, falling back to static:', error);
        // Fallback to static data if BigQuery fails
        const fallbackResponse = {
          data: this.staticOffices,
          success: true,
          message: 'Offices loaded with static data (BigQuery unavailable)'
        };
        this.officesSubject.next(fallbackResponse.data);
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
    console.log('🏢 [OFFICE SERVICE] Setting filtered offices:', offices.length);
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
            const staticOffice = this.staticOffices.find(so => so.id === office.location_id);

            return {
              id: office.location_id,
              name: office.location_name,
              displayName: office.location_name,
              svg: staticOffice?.svg || []
            } as Office;
          });

        return officesFromBq;
      }),
      switchMap((allOffices: Office[]) => {
        // Now get floorplans to filter
        return this.http.get<any[]>(`${environment.apiBaseUrl}/api/floorplans`).pipe(
          map(floorplans => {
            if (!floorplans || floorplans.length === 0) {
              console.log('⚠️ No floorplans found in backend');
              return [];
            }

            // Extract unique office IDs that have floorplans
            const officeIdsWithFloorplans = new Set<string>();
            floorplans.forEach((fp: any) => {
              if (fp.officeId) {
                officeIdsWithFloorplans.add(fp.officeId);
              }
            });

            console.log('📊 Offices with floorplans:', Array.from(officeIdsWithFloorplans));

            // Filter offices to only those with floorplans
            const filteredOffices = allOffices.filter(office =>
              officeIdsWithFloorplans.has(office.id)
            );

            console.log('✅ Filtered offices count:', filteredOffices.length);
            return filteredOffices;
          }),
          catchError(error => {
            console.error('❌ Error loading floorplans:', error);
            return of<Office[]>([]);
          })
        );
      }),
      tap((filteredOffices: Office[]) => {
        // Update the BehaviorSubject with filtered offices only
        this.officesSubject.next(filteredOffices);
        this.loadingSubject.next(false);
        console.log('🏢 [OFFICE SERVICE] Updated subject with filtered offices:', filteredOffices.length);
      }),
      map((filteredOffices: Office[]) => ({
        success: true,
        count: filteredOffices.length
      })),
      catchError(error => {
        console.error('❌ Error loading offices with floorplans:', error);
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
          console.log('⚠️ No floorplans found in backend');
          return [];
        }

        // Extract unique office IDs that have floorplans
        const officeIdsWithFloorplans = new Set<string>();
        floorplans.forEach((fp: any) => {
          if (fp.officeId) {
            officeIdsWithFloorplans.add(fp.officeId);
          }
        });

        console.log('📊 Offices with floorplans:', Array.from(officeIdsWithFloorplans));

        // Filter offices to only those with floorplans
        const filteredOffices = allOffices.filter(office =>
          officeIdsWithFloorplans.has(office.id)
        );

        console.log('✅ Filtered offices count:', filteredOffices.length);
        return filteredOffices;
      }),
      catchError(error => {
        console.error('❌ Error loading offices with floorplans:', error);
        // On error, return empty array (will show "No floorplans available")
        return of<Office[]>([]);
      })
    );
  }
}
