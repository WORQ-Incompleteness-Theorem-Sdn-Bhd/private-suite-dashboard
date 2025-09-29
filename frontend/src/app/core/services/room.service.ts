import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, range, tap, catchError, of } from 'rxjs';
import { Room } from '../models/room.model';
import { environment } from '../../environments/environment.prod';
import { OfficeService } from './office.service';

export interface ResourceParams {
  officeId: string; // location → office.id
  status?: string; // optional
  pax?: number; // optional
  suites?: string[]; // optional (multi-select)
  floor?: string; // optional (if backend supports)
}

const MM2_PER_SQFT = 92903.04;

@Injectable({ providedIn: 'root' })
export class RoomService {
  private roomsSubject = new BehaviorSubject<Room[]>([]);
  rooms$ = this.roomsSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();

  // Removed hardcoded outletMap in favor of OfficeService data

  constructor(private http: HttpClient, private officeService: OfficeService) {}


  private toYoutubeEmbed(url: string): string | null {
    if (!url) return null;
    try {
      // watch?v=
      const watch = url.match(/[?&]v=([^&]+)/);
      if (watch && watch[1])
        return `https://www.youtube.com/embed/${watch[1]}?rel=0`;

      // youtu.be/
      const short = url.match(/youtu\.be\/([^?&#]+)/);
      if (short && short[1])
        return `https://www.youtube.com/embed/${short[1]}?rel=0`;

      // already embed
      if (/youtube\.com\/embed\//.test(url)) return url;

      return url;
    } catch {
      return null;
    }
  }

  
  private url = environment.bqUrl ;  
//Populate filters from backend data
  getResources(params: ResourceParams): Observable<any> {
    this.loadingSubject.next(true);
    
    // Build query parameters
    let httpParams = new HttpParams();
    httpParams = httpParams.set('office_id', params.officeId);

    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.pax) {
      httpParams = httpParams.set('pax_size', params.pax.toString());
    }
    if (params.suites && params.suites.length > 0) {
      // For multiple suites, we'll send them as comma-separated values
      httpParams = httpParams.set('resource_name', params.suites.join(',')); // use resources_id instead
    }
    if (params.floor) {
      httpParams = httpParams.set('floor_id', params.floor);
    }
    
    return this.http.get<any>(`${this.url}/resources` , { 
      params: httpParams
    }).pipe(
      tap((response) => {
        console.log('Fetched resources from backend:', response);
        const data = response.data || [];
        
        const mapped = data.map((item: any) => {
          const office = this.officeService.getOfficeById(item.office_id);
          const svgPath = office?.svg || [];

          // Normalize status from backend data // update tht group 
          let normalizedStatus: 'Available' | 'Occupied';
          if (item.status.toLowerCase() === 'available') {
            normalizedStatus = 'Available';
          } else {
            normalizedStatus = 'Occupied';
          }

            // Convert mm² → ft²
            const areaMm2 = Number(item.area_in_sqmm) || 0;
            const areaSqft = areaMm2 / MM2_PER_SQFT;

          return {
            id: item.resource_id,
            name: item.resource_name,
            status: normalizedStatus,
            outlet: (office?.name || office?.displayName || ''),
            svg: Array.isArray(svgPath) ? svgPath : (svgPath ? [svgPath] : []),
            capacity: item.pax_size,
            type: item.resource_type,
            area: Math.round(areaSqft),
            price: item.price,
            deposit: item.deposit,
            video: item.youtube_link || undefined,
            videoEmbed: this.toYoutubeEmbed(item.youtube_link) || undefined,
            floor_id: item.floor_id
          } as Room;
        });
        
        console.log('Mapped resources:', mapped);
        this.roomsSubject.next(mapped);
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        console.error('Error fetching resources from backend:', error);
        this.loadingSubject.next(false);
        // Return empty array on error
        this.roomsSubject.next([]);
        return of({ data: [] });
      })
    );
  }
//New function 
  // Fetch availability for a date or date range (YYYY-MM-DD)
  getAvailability(params: { start: string; end: string; officeId?: string; }): Observable<any> {
    let httpParams = new HttpParams()
      .set('start', params.start)
      .set('end', params.end || params.start);
    if (params.officeId) {
      httpParams = httpParams.set('office_id', params.officeId);
    }
    return this.http.get<any>(`${this.url}/availability`, { params: httpParams });
  }
}
