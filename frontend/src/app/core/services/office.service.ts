import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Office, OfficeResponse } from '../models/office.model';

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

  constructor() {}

  loadOffices(): Observable<OfficeResponse> {
    this.loadingSubject.next(true);
    
    // Simulate async loading
    return of({
      data: this.staticOffices,
      success: true,
      message: 'Offices loaded successfully'
    }).pipe(
      tap((response: OfficeResponse) => {
        console.log('Loaded static offices:', response);
        if (response.success && response.data) {
          this.officesSubject.next(response.data);
        }
        this.loadingSubject.next(false);
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
