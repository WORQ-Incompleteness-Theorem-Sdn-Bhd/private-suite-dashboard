//SVG service
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';
import { Office, OfficeResponse } from '../models/office.model';
import { environment } from '../../environments/environment.prod';

@Injectable({ providedIn: 'root' })
export class OfficeService {
  private officesSubject = new BehaviorSubject<Office[]>([]);
  offices$ = this.officesSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();

  // REMOVED: All hardcoded office data - now using CLOUD ONLY mode
  // All office data must come from the cloud API

  constructor(private http: HttpClient) {}

  loadOffices(): Observable<OfficeResponse> {
    this.loadingSubject.next(true);

    // 📊 SQL DATA RETRIEVAL: Fetch outlet/offices from BigQuery locations API
    console.log('☁️ [OFFICE SERVICE] Loading offices from BigQuery:', `${environment.bqUrl}/locations`);

    return this.http.get<any>(`${environment.bqUrl}/locations`).pipe( // 🔍 LINE 28: SQL QUERY - GET /api/bigquery/locations
      map((res) => {
        const arr: any[] = res?.data || [];

        // Map BigQuery locations to Office objects
        const offices = arr.map((loc) => ({
          id: loc.location_id,
          name: loc.location_name,
          displayName: loc.location_name,
          // SVGs for office/floors are loaded via floorplan service when needed
          svg: [],
        })) as Office[];

        // Debug: Check if MUB and ITG are in the BigQuery data
        console.log('📊 [OFFICE SERVICE] BigQuery locations data:', arr);
        const mubOffice = offices.find(o => o.name?.toLowerCase().includes('mub'));
        const itgOffice = offices.find(o => o.name?.toLowerCase().includes('itg'));
        console.log('📊 [OFFICE SERVICE] MUB office found:', mubOffice);
        console.log('📊 [OFFICE SERVICE] ITG office found:', itgOffice);

        return {
          data: offices,
          success: true,
          message: 'Offices loaded from BigQuery locations',
        } as OfficeResponse;
      }),
      tap((response: OfficeResponse) => {
        console.log('✅ [OFFICE SERVICE] Successfully loaded offices from BigQuery:', response);
        if (response.success && response.data) {
          console.log('✅ [OFFICE SERVICE] Storing offices in BehaviorSubject:', response.data);
          this.officesSubject.next(response.data);
        } else {
          console.warn('⚠️ [OFFICE SERVICE] No office data received from cloud');
        }
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        console.error('❌ [OFFICE SERVICE] Error loading offices from BigQuery - NO FALLBACK:', error);
        // NO FALLBACK
        const errorResponse = {
          data: [],
          success: false,
          message: 'Failed to load offices from BigQuery API - no fallback available'
        };
        this.officesSubject.next(errorResponse.data);
        this.loadingSubject.next(false);
        return of(errorResponse);
      })
    );
  }

  getOffices(): Office[] {
    return this.officesSubject.value;
  }

  getOfficeById(id: string): Office | undefined {
    return this.officesSubject.value.find(office => office.id === id);
  }
}
