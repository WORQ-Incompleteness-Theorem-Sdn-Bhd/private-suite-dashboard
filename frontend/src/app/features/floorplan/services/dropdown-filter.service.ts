import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { RoomService } from '../../../core/services/room.service';
import { OfficeService } from '../../../core/services/office.service';
import { AvailabilityService } from './availability.service';

type FilterKey = 'outlet' | 'status' | 'pax';

export interface FilterConfig {
  key: FilterKey;
  label: string;
  options: string[];
}

export interface Filters {
  outlet: string;
  status: string;
  pax: string;
  svg: string;
}

@Injectable({
  providedIn: 'root'
})
export class DropdownFilterService {
  constructor(
    private roomService: RoomService,
    private officeService: OfficeService,
    private availabilityService: AvailabilityService
  ) {}

  getOptionValue(opt: any): string {
    return typeof opt === 'string' ? opt : opt.value;
  }

  getOptionLabel(opt: any): string {
    return typeof opt === 'string' ? opt : opt.label;
  }

  buildOptions(
    rooms: Room[],
    filters: Filters,
    selectedSuites: string[],
    suiteSearchTerm: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    selectedStartDate: string,
    useFloorplanFilter: boolean = true // New parameter to control filtering
  ): {
    outletOptions: { label: string; value: string }[];
    statusOptions: string[];
    paxOptions: string[];
    suiteOptions: string[];
  } {
    let filteredForOutlet = rooms;
    let filteredForStatus = filteredForOutlet.filter(
      (r) => {
        if (filters.outlet === 'Select Outlet') return true;
        const selectedOffice = this.officeService.getOffices().find(office => office.id === filters.outlet);
        return selectedOffice && r.outlet === selectedOffice.displayName;
      }
    );

    let filteredForPax = filteredForStatus.filter(
      (r) => {
        const effectiveStatus = this.availabilityService.getEffectiveStatus(r, selectedStartDate, availabilityByRoomId);
        return filters.status === 'Select Status' || effectiveStatus === filters.status;
      }
    );

    let filteredForSuite = filteredForPax.filter(
      (r) =>
        filters.pax === 'Select Pax' ||
        r.capacity.toString() === filters.pax
    );

    // Outlet options: from office service
    // Get current offices from the service (which may be filtered for dashboard)
    const outletOptions = this.officeService.getOffices().map(office => ({
      label: office.displayName,
      value: office.id
    }));

    // Status options: Always show both Available and Occupied options
    // This ensures users can always filter by either status regardless of current data
    const statusOptions = ['Available', 'Occupied'];

    // Pax options: based on selected outlet & status
    const paxOptions = Array.from(
      new Set(
        rooms
          .filter((r) => {
            const outletMatch = (() => {
              if (filters.outlet === 'Select Outlet') return true;
              const selectedOffice = this.officeService.getOffices().find(office => office.id === filters.outlet);
              return selectedOffice && r.outlet === selectedOffice.displayName;
            })();
            const effectiveStatus = this.availabilityService.getEffectiveStatus(r, selectedStartDate, availabilityByRoomId);
            const statusMatch =
              filters.status === 'Select Status' ||
              effectiveStatus === filters.status;
            return outletMatch && statusMatch;
          })
          .map((r) => r.capacity?.toString().trim())
          .filter((cap) => cap && cap !== '0')
      )
    ).sort((a, b) => Number(a) - Number(b));

    // Suite options: based on outlet, status & pax + search term
    let allSuites = Array.from(
      new Set(filteredForSuite.map((r) => r.name.trim()))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (suiteSearchTerm.trim()) {
      allSuites = allSuites.filter((name) =>
        name.toLowerCase().includes(suiteSearchTerm.trim().toLowerCase())
      );
    }

    const suiteOptions = allSuites;

    return {
      outletOptions,
      statusOptions,
      paxOptions,
      suiteOptions
    };
  }

  applyFilters(
    rooms: Room[],
    filters: Filters,
    selectedSuites: string[],
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    selectedStartDate: string
  ): Room[] {
    console.log('🔍 [FILTER] applyFilters called:', {
      totalRooms: rooms.length,
      filters,
      selectedSuites,
      selectedStartDate
    });

    const filtered = rooms
      .filter((r, index) => {
        const outletMatch = (() => {
          if (filters.outlet === 'Select Outlet') return true;
          const selectedOffice = this.officeService.getOffices().find(o => o.id === filters.outlet);
          return selectedOffice && r.outlet === selectedOffice.displayName;
        })();

        const effectiveStatus = this.availabilityService.getEffectiveStatus(r, selectedStartDate, availabilityByRoomId);
        const statusOk =
          filters.status === 'Select Status' || effectiveStatus === filters.status;

        const paxOk =
          filters.pax === 'Select Pax' || String(r.capacity) === filters.pax;

        const suiteOk = selectedSuites.length === 0 || selectedSuites.includes(r.name);

        const passes = outletMatch && statusOk && paxOk && suiteOk;

        // 🔍 DEBUG: Log first 5 rooms or failed rooms
        if (index < 5 || !passes) {
          console.log(`🔍 [FILTER] Room ${r.name} (${r.id}):`, {
            outletMatch,
            effectiveStatus,
            statusOk,
            paxOk,
            suiteOk,
            passes: passes ? '✅ PASS' : '❌ FAIL',
            roomOutlet: r.outlet,
            roomCapacity: r.capacity,
            availInMap: availabilityByRoomId.has(r.id)
          });
        }

        return passes;
      })
      .sort((a, b) => {
        if (filters.pax !== 'Select Pax') return a.capacity - b.capacity;
        if (selectedSuites.length > 0) return a.name.localeCompare(b.name, undefined, { numeric: true });
        return 0;
      });

    console.log(`🔍 [FILTER] Result: ${filtered.length} rooms passed filters (out of ${rooms.length})`);

    return filtered;
  }

  getOfficeIdFromOutletName(outletName: string): string | undefined {
    const offices = this.officeService.getOffices();
    const normalized = (outletName || '').trim().toLowerCase();
    const byDisplay = offices.find(o => (o.displayName || '').trim().toLowerCase() === normalized);
    const byId = offices.find(o => (o.id || '').trim().toLowerCase() === normalized);
    const chosen = byDisplay ?? byId;
    return chosen?.id;
  }
}

