import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Room } from '../models/room.model';
import { environment } from '../../environments/environment.prod';

export interface ResourceParams {
  officeId: string;           // location → office.id
  status?: string;            // optional
  pax?: number;               // optional
  suites?: string[];          // optional (multi-select)
  floor?: string;             // optional (if backend supports)
}

const MM2_PER_SQFT = 92903.04;

@Injectable({ providedIn: 'root' })
export class RoomService {
  private roomsSubject = new BehaviorSubject<Room[]>([]);
  rooms$ = this.roomsSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();

  private readonly outletMap: Record<
    string,
    { name: string; svg: string | string[] }
  > = {
    '67ad665a9aa9ef620e693aa0': {
      name: '8FA',
      svg: 'assets/8FA.svg',
    },
    '65e56bd7a24b74cef513834f': {
      name: 'ITG',
      svg: 'assets/ITG.svg',
    },
    '565748274a955c790d808c77': {
      name: 'UBP',
      svg: 'assets/UBP.svg',
    },
    '5dac63c998e930010a595016': {
      name: 'KLG',
      svg: 'assets/KLG.svg',
    },
    '5db8fb7e35798d0010950a77': {  
      name: 'TTDI',
      svg: ['assets/TTDI-Level1.svg', 'assets/TTDIlevel3A.svg' , 'assets/Sibelco Office - L1.svg'],
    },
    /*'5db8fb9798549f0010df15f3': {
      name: 'STO-WIP',
      svg: [
        'assets/STO-Level11.svg',
        'assets/STO-Level12.svg',
        'assets/STO-Level14.svg',
      ],
    },*/
    '62a9832b43c9f437e373e9dd': {
      name: 'KLS',
      svg: [
        'assets/KLS- L20.svg',
        'assets/KLS-ByteDance.svg',
        'assets/KLS-L21.svg',
        'assets/KLS-L28.svg',
      ],
    },
    '63f5de531f29f60007ca8209': {
      name: 'MUB',
      svg: [
        'assets/MUB-level9.svg',
        'assets/MUB-level12.svg',
        'assets/MUB-level17.svg',
      ],
    },
    '6537957cc3653d2412ab4d7e': {
      name: 'SPM',
      svg: 'assets/SPM.svg',
    },
    '66dfd21d5ec307e20a9b761c': {
      name: 'UBP3A',
      svg: ['assets/UBP-L13A.svg', 'assets/UBP-L13AAIRIT.svg'],
    },
    '671f3dbf0951c4dfbaaadd5d': {
      name: 'SV2',
      svg: 'assets/SV2.svg',
    },
  };

  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = sessionStorage.getItem('userAccessToken');
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
  }

  private toYoutubeEmbed(url: string): string | null {
    if (!url) return null;
    try {
      // watch?v=
      const watch = url.match(/[?&]v=([^&]+)/);
      if (watch && watch[1]) return `https://www.youtube.com/embed/${watch[1]}?rel=0`;
  
      // youtu.be/
      const short = url.match(/youtu\.be\/([^?&#]+)/);
      if (short && short[1]) return `https://www.youtube.com/embed/${short[1]}?rel=0`;
  
      // already embed
      if (/youtube\.com\/embed\//.test(url)) return url;
  
      return url;
    } catch {
      return null;
    }
  }


//Populate filters from backend data
  getResources(params: ResourceParams): Observable<any> {
    this.loadingSubject.next(true);
    const url = environment.baseUrl + '/api/resources';   //use resourceUrl instead
    
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
    
    return this.http.get<any>(url, { 
      params: httpParams,
      headers: this.getAuthHeaders() //remove this
    }).pipe(
      tap((response) => {
        console.log('Fetched resources from backend:', response);
        const data = response.data || [];
        
        const mapped = data.map((item: any) => {
          const outletInfo = this.outletMap[item.office_id];
          const svgPath = outletInfo?.svg || [];

          // Normalize status from backend data
          let normalizedStatus: 'Available' | 'Occupied';
          if (
            ['available', 'available_soon'].includes(
              item.status.toLowerCase()
            )
          ) {
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
            outlet: outletInfo?.name || '',
            svg: Array.isArray(svgPath) ? svgPath : [svgPath],
            capacity: item.pax_size,
            type: item.resource_type,
            area: Math.round(areaSqft),
            price: item.price,
            deposit: item.deposit,
            video: item.youtube_link || undefined,
            videoEmbed: this.toYoutubeEmbed(item.youtube_link) || undefined
          } as Room;
        });
        
        console.log('Mapped resources:', mapped);
        this.roomsSubject.next(mapped);
        this.loadingSubject.next(false);
      })
    );
  }
}
