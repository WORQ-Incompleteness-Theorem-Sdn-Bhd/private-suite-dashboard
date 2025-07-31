import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';
import { Room } from '../models/room.model';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private roomsSubject = new BehaviorSubject<Room[]>([]);
  rooms$ = this.roomsSubject.asObservable();

  private readonly outletMap: Record<string, string> = {
    "65e56bd7a24b74cef513834f": "ITG",
    "67ad665a9aa9ef620e693aa0": "8FA",
    "565748274a955c790d808c77": "UBP",
    "5dac63c998e930010a595016": "KLG",
    "5db8fb7e35798d0010950a77": "TTDI",
    "5db8fb9798549f0010df15f3": "STO",
    "62a9832b43c9f437e373e9dd": "KLS",
    "63f5de531f29f60007ca8209": "MUB",
    "6537957cc3653d2412ab4d7e": "SPM",
    "66dfd21d5ec307e20a9b761c": "UBP3A",
    "671f3dbf0951c4dfbaaadd5d": "SV2",
  };

  constructor(private http: HttpClient) {}

  fetchRooms() {
    const url = 'https://script.google.com/macros/s/AKfycbxKhih7njEt3fiRMvbJnHOTYUCeHlENVMK7i5EosmE65lZE_K7esXdNJ7tAjIHRNwEg/exec';
    this.http.get<any[]>(url).pipe(
      tap(data => {
        const mapped = data.map(item => ({
          id: item.id,
          name: item.name,
          status: item.status.toLowerCase(),
          outlet: this.outletMap[item.outlet_id],
          capacity: item.capacity,
          type: item.type,
          area: item.area,
          price: item.price,
          deposit: item.deposit
        }));
        this.roomsSubject.next(mapped);
      })
    ).subscribe();
  }
}
