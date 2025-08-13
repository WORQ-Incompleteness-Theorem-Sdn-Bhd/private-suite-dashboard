import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';
import { Room } from '../models/room.model';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private roomsSubject = new BehaviorSubject<Room[]>([]);
  rooms$ = this.roomsSubject.asObservable();

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
      svg: ['assets/TTDI-Level1.svg', 'assets/TTDIlevel3A.svg'],
    },
    '5db8fb9798549f0010df15f3': {
      name: 'STO',
      svg: [
        'assets/STO-Level11.svg',
        'assets/STO-Level12.svg',
        'assets/STO-Level14.svg',
      ],
    },
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

  fetchRooms() {
    const url =
      'https://script.google.com/macros/s/AKfycbxKhih7njEt3fiRMvbJnHOTYUCeHlENVMK7i5EosmE65lZE_K7esXdNJ7tAjIHRNwEg/exec';
    this.http
      .get<any[]>(url)
      .pipe(
        tap((data) => {
          console.log('Fetched rooms:', data);
          const mapped = data.map((item) => {
            const outletInfo = this.outletMap[item.outlet_id];
            const svgPath = outletInfo?.svg || []; // Get the svg from outletMap

            //grouping status
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

            return {
              id: item.id,
              name: item.name,
              status: normalizedStatus,
              outlet: outletInfo?.name || '',
              svg: Array.isArray(svgPath) ? svgPath : [svgPath], // Always an array
              capacity: item.capacity,
              type: item.type,
              area: item.area,
              price: item.price,
              deposit: item.deposit,
            };
          });
          console.log('Mapped rooms:', mapped);
          this.roomsSubject.next(mapped);
        })
      )
      .subscribe();
  }
}
