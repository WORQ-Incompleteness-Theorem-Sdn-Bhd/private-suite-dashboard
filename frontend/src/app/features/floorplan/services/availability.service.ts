import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { RoomService } from '../../../core/services/room.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ToastService } from '../../../shared/services/toast.service';

@Injectable({
  providedIn: 'root'
})
export class AvailabilityService {
  constructor(
    private roomService: RoomService,
    private toastService: ToastService
  ) {}

  fetchAvailabilityForCurrentSelection(
    outlet: string,
    selectedStartDate: string,
    selectedEndDate: string,
    rooms: Room[],
    getOfficeIdFromOutletName: (name: string) => string | undefined,
    isRoomUnavailable: (room: Room) => boolean
  ): Promise<Map<string, 'free' | 'occupied'>> {
    return new Promise((resolve, reject) => {
      const officeId = getOfficeIdFromOutletName(outlet);
      if (!officeId || !selectedStartDate) {
        resolve(new Map());
        return;
      }
          
      const start = selectedStartDate;
      const end = selectedEndDate || selectedStartDate;
      
      const startDate = new Date(start);
      const endDate = new Date(end);
      const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;  //86400000 ms in a day

      const MAX_WINDOW = 31;

      // --- SCENARIO 1: LONG DATE RANGE (Chunks) ---
      if (totalDays > MAX_WINDOW) {
        const windows: Array<{ s: string; e: string }> = [];
        let cursor = new Date(startDate);
        while (cursor <= endDate) {
          const winStart = new Date(cursor);
          const winEnd = new Date(Math.min(
            endDate.getTime(),
            new Date(cursor.getTime() + (MAX_WINDOW - 1) * 86400000).getTime()
          ));
          const toISO = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          windows.push({ s: toISO(winStart), e: toISO(winEnd) });
          cursor = new Date(winEnd.getTime() + 86400000);
        }

        const calls = windows.map(w => this.roomService.getAvailability({ start: w.s, end: w.e, officeId }));
        
        forkJoin(calls).subscribe({
          next: (responses: any[]) => {
            console.log(`🔍 Chunked availability: Received ${responses.length} responses`);

            const combined = new Map<string, 'free' | 'occupied'>();

            responses.forEach((resp, respIndex) => {
              const rows = resp?.resources || resp?.rows || resp?.data || [];
              if (respIndex === 0) {
                console.log(`🔍 Chunk ${respIndex} has ${rows.length} rows, sample:`, rows[0]);
              }

              rows.forEach((r: any) => {
                const days = r.days || [];
                if (days.length === 0) return;

                // Is this specific chunk free?
                const chunkIsFree = days.every((d: any) => {
                  const status = (d.status || '').toLowerCase();
                  return status === 'free';
                });

                // ✅ FIX: Normalize IDs before matching (same as single-call scenario)
                const normalizeId = (id: string) => id?.toLowerCase().trim();
                const room = rooms.find(room => normalizeId(room.id) === normalizeId(r.resource_id));

                // 1. Check Permanent Unavailability
                if (room && isRoomUnavailable(room)) {
                  combined.set(r.resource_id, 'occupied');
                  return;
                }

                // 2. CRITICAL FIX: MERGING LOGIC
                // If room is already marked 'occupied' from a previous chunk, KEEP IT OCCUPIED.
                // We only mark it 'free' if it is currently unknown AND this chunk is free.
                if (!combined.has(r.resource_id)) {
                  // First time seeing this room in the loops
                  combined.set(r.resource_id, chunkIsFree ? 'free' : 'occupied');
                } else {
                  // We have seen this room before.
                  const currentStatus = combined.get(r.resource_id);
                  
                  // If it was 'free' before, but this chunk says 'occupied', we switch to 'occupied'.
                  // If it was 'occupied' before, we leave it as 'occupied' (do nothing).
                  if (currentStatus === 'free' && !chunkIsFree) {
                    combined.set(r.resource_id, 'occupied');
                  }
                }
              });
            });
            resolve(combined);
          },
          error: (e) => {
            console.error('Failed to fetch availability', e);
            this.toastService.error('Failed to fetch availability data. Please try again.');
            resolve(new Map());
          }
        });
        return;
      }

      // --- SCENARIO 2: SHORT DATE RANGE (Single Call) ---
      this.roomService.getAvailability({ start, end, officeId }).pipe(
        catchError((e) => {
          console.error('Failed to fetch availability', e);
          if (e.error && e.error.error && e.error.error.includes('Range too large')) {
            this.toastService.error('Date range too large. Please select a range of 366 days or less.');
          } else {
            this.toastService.error('Failed to fetch availability data. Please try again.');
          }
          return of({ resources: [], rows: [], data: [] });
        })
      ).subscribe({
        next: (resp) => {
          // ✅ FIX: Validate response structure
          if (!resp || typeof resp !== 'object') {
            console.error('❌ Invalid API response:', resp);
            this.toastService.error('Invalid availability data received from server');
            resolve(new Map());
            return;
          }

          // 🔍 DEBUG: Log raw API response
          console.log('🔍 Raw availability API response:', {
            responseKeys: Object.keys(resp || {}),
            hasResources: !!resp?.resources,
            hasRows: !!resp?.rows,
            hasData: !!resp?.data,
            fullResponse: resp
          });

          const map = new Map<string, 'free' | 'occupied'>();
          const rows = resp?.resources || resp?.rows || resp?.data || [];

          // ✅ FIX: Warn if API returned empty array
          if (rows.length === 0) {
            console.warn('⚠️ API returned empty resources/rows/data array');
          }

          console.log(`🔍 Extracted ${rows.length} rows from API response`);
          if (rows.length > 0) {
            console.log('🔍 Sample row structure:', rows[0]);
          }

          rows.forEach((r: any, index: number) => {
            const days = r.days || [];
            if (index < 3) {
              console.log(`🔍 Processing row ${index}:`, {
                resource_id: r.resource_id,
                daysLength: days.length,
                sampleDays: days.slice(0, 2)
              });
            }
            if (days.length === 0) return;

            // For a single chunk, if ANY day is not free, the whole range is occupied
            const isAvailable = days.every((d: any) => {
              const status = (d.status || '').toLowerCase();
              return status === 'free';
            });

            // ✅ FIX: Normalize IDs before matching
            const normalizeId = (id: string) => id?.toLowerCase().trim();
            const room = rooms.find(room => normalizeId(room.id) === normalizeId(r.resource_id));

            // 🔍 DEBUG: Log when room isn't found
            if (!room && index < 5) {
              console.warn(`⚠️ No room found for resource_id: ${r.resource_id}`, {
                availableRoomIds: rooms.slice(0, 3).map(r => r.id)
              });
            }

            if (room && isRoomUnavailable(room)) {
              map.set(r.resource_id, 'occupied');
            } else if (isAvailable) {
              map.set(r.resource_id, 'free');
            } else {
              map.set(r.resource_id, 'occupied');
            }
          });
          
          resolve(map);
        }
      });
    });
  }

  getStatusDisplayText(
    room: Room,
    isDateSelected: boolean,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>
  ): string {
    const status = room.status.toLowerCase();

    if (isDateSelected) {
      // ✅ FIX: When date is selected, check availability data FIRST
      // Only respect permanent unavailability from room.status
      const isPermanentlyUnavailable = room.originalStatus?.toLowerCase() === 'unavailable';

      if (isPermanentlyUnavailable) {
        return 'Unavailable';
      }

      // For all other rooms, use the availability data for the selected date
      const avail = availabilityByRoomId.get(room.id);
      if (avail !== undefined) {
        return avail === 'free' ? 'Available' : 'Occupied';
      }

      // If no availability data, default to Occupied (safe fallback)
      return 'Occupied';
    } else {
      // No date selected - use base status
      switch (status) {
        case 'reserved':
          return 'Reserved';
        case 'occupied':
          return 'Occupied';
        case 'unavailable':
          return 'Unavailable';
        case 'available_soon':
          if (room.availableFrom) {
            const availableDate = new Date(room.availableFrom);
            const formattedDate = availableDate.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            });
            return `Available on ${formattedDate}`;
          }
          return 'Available Soon';
        case 'available':
          return 'Available';
        default:
          return 'Occupied';
      }
    }
  }

  toStatusUnion(status: string): 'Available' | 'Occupied' {
    const availableStatuses = ['available'];
    const occupiedStatuses = ['occupied', 'reserved', 'available_soon', 'unavailable'];
    
    const normalizedStatus = status.toLowerCase();
    
    if (availableStatuses.includes(normalizedStatus)) {
      return 'Available';
    } else if (occupiedStatuses.includes(normalizedStatus)) {
      return 'Occupied';
    } else {
      return 'Occupied';
    }
  }

  isRoomUnavailable(room: Room): boolean {
    return room.originalStatus?.toLowerCase() === 'unavailable';
  }

  /**
   * Get effective room status considering date-based availability
   * @param room The room to evaluate
   * @param selectedStartDate Selected date (empty string if no date)
   * @param availabilityByRoomId Availability map from API
   * @returns 'Available' or 'Occupied'
   */
  getEffectiveStatus(
    room: Room,
    selectedStartDate: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>
  ): 'Available' | 'Occupied' {
    if (selectedStartDate) {
      // Date is selected - use availability data from API
      const avail = availabilityByRoomId.get(room.id);

      if (avail !== undefined) {
        // Only respect PERMANENT unavailability
        if (this.isRoomUnavailable(room)) {
          return 'Occupied';
        }
        // For all other rooms, trust the date-based availability
        return avail === 'free' ? 'Available' : 'Occupied';
      }
      // No availability data - default to occupied
      return 'Occupied';
    }

    // No date selected - use room's base status
    return this.toStatusUnion(room.status);
  }
}