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
    "67ad665a9aa9ef620e693aa0": { 
      name: "8FA", 
      svg: "assets/SVG-file/8FA.svg" 
    },
    "65e56bd7a24b74cef513834f": { 
      name: "ITG", 
      svg: "assets/SVG-file/ITG.svg" 
    },
    "565748274a955c790d808c77": { 
      name: "UBP", 
      svg: "assets/SVG-file/UBP.svg" 
    },
    "5dac63c998e930010a595016": { 
      name: "KLG", 
      svg: "assets/SVG-file/KLG.svg" 
    },
    "5db8fb7e35798d0010950a77": { 
      name: "TTDI", 
      svg: [
        "assets/SVG-file/TTDI-Level1.svg", 
        "assets/SVG-file/TTDI-Level3A.svg"
      ] 
    },
    "5db8fb9798549f0010df15f3": { 
      name: "STO", 
      svg: [
        "assets/SVG-file/STO-Level11.svg", 
        "assets/SVG-file/STO-Level12.svg", 
        "assets/SVG-file/STO-Level14.svg"
      ] 
    },
    "62a9832b43c9f437e373e9dd": { 
      name: "KLS", 
      svg: [
        "assets/SVG-file/KLS-L20.svg", 
        "assets/SVG-file/KLS-ByteDance.svg", 
        "assets/SVG-file/KLS-L21.svg", 
        "assets/SVG-file/KLS-L28.svg"
      ] 
    },
    "63f5de531f29f60007ca8209": { 
      name: "MUB", 
      svg: [
        "assets/SVG-file/MUB-level9.svg", 
        "assets/SVG-file/MUB-level12.svg", 
        "assets/SVG-file/MUB-level17.svg"
      ] 
    },
    "6537957cc3653d2412ab4d7e": { 
      name: "SPM", 
      svg: "assets/SVG-file/SPM.svg" 
    },
    "66dfd21d5ec307e20a9b761c": { 
      name: "UBP3A", 
      svg: [
        "assets/SVG-file/UBP-L13A.svg", 
        "assets/SVG-file/UBP-L13AAIRIT.svg"
      ] 
    },
    "671f3dbf0951c4dfbaaadd5d": { 
      name: "SV2", 
      svg: "assets/SVG-file/SV2.svg" 
    }
  };

  constructor(private http: HttpClient) {}

fetchRooms() {
  const url = 'https://script.google.com/macros/s/AKfycbxKhih7njEt3fiRMvbJnHOTYUCeHlENVMK7i5EosmE65lZE_K7esXdNJ7tAjIHRNwEg/exec';
  this.http.get<any[]>(url).pipe(
    tap(data => {
      const mapped = data.map(item => {
        const outletInfo = this.outletMap[item.outlet_id];
        const svgPath = outletInfo?.svg || []; // Get the svg from outletMap

        //grouping status
        let normalizedStatus: 'Available' | 'Occupied';
        if (['available', 'available_soon'].includes(item.status.toLowerCase())) {
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
          deposit: item.deposit
        };
      });
      this.roomsSubject.next(mapped);
    })
  ).subscribe();
}

}
