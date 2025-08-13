import { Component, OnInit, AfterViewInit, ElementRef,ViewChildren } from '@angular/core';
import { Room } from '../../core/models/room.model';
import { RoomService } from '../../core/services/room.service';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';


type FilterKey = 'outlet' | 'status' | 'pax' | 'suite';

interface FilterConfig {
  key: FilterKey;
  label: string;
  options: string[];
}

@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'app-floorplan',
  templateUrl: './floorplan.component.html',
  styleUrls: ['./floorplan.component.scss'],
})
export class FloorplanComponent implements OnInit, AfterViewInit {
  rooms$: Observable<Room[]> | undefined;
  rooms: Room[] = [];
  filteredRooms: Room[] = [];
  svgPath: SafeResourceUrl | undefined;
  selectedOutletSvgs: string[] = [];

  isArray(value: unknown): boolean {
    return Array.isArray(value);
  }

  filtersConfig: FilterConfig[] = [
    { key: 'outlet', label: 'Outlet', options: [] },
    { key: 'status', label: 'Status', options: [] },
    { key: 'pax', label: 'Pax', options: [] },
    { key: 'suite', label: 'Suite', options: [] },
  ];

  filters = {
    outlet: 'Select Outlet',
    status: 'Select Status',
    pax: 'Select Pax',
    suite: 'Select Suite',
    svg: 'all',
  };
  outletOptions: string[] = [];
  statusOptions: string[] = [];
  paxOptions: string[] = [];
  suiteOptions: string[] = [];
  leftPanelCollapsed = false;

  selectedRoom: any;
  showPopup = false;
  popupX = 0;
  popupY = 0;

  Occupied = 0;
  Available = 0;

  safeSvgUrl!: SafeResourceUrl;

  // 👉 for collapse toggle
  rightPanelCollapsed: boolean = false;

  constructor(
    private roomService: RoomService,
    public sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.roomService.rooms$.subscribe((rooms) => {
      this.rooms = rooms;

      if (rooms.length > 0 && rooms[0]?.svg) {
        const svgPath = Array.isArray(rooms[0].svg)
          ? rooms[0].svg[0]
          : rooms[0].svg;
        this.safeSvgUrl =
          this.sanitizer.bypassSecurityTrustResourceUrl(svgPath);
      }
      this.updateSelectedOutletSvgs();
      this.buildOptions();
      this.applyFilters();
    });
    this.roomService.fetchRooms();
  }
  
    private attachSvgListeners() {
      const objectEl = document.getElementById('floorplanSvg') as HTMLObjectElement;
      if (!objectEl) return;

      const svgDoc = objectEl.contentDocument;
      if (!svgDoc) return;

      this.attachRoomListeners(svgDoc);
      this.updateSvgColors();
    }

  ngAfterViewInit() {
    const objectEl = document.getElementById(
      'floorplanSvg'
    ) as HTMLObjectElement;
    if (!objectEl) return;

    objectEl.addEventListener('load', () => {
      const svgDoc = objectEl.contentDocument;
      if (!svgDoc) {
        console.error('SVG not loaded or invalid');
        return;
      }

      this.rooms.forEach((room) => {
        const el = svgDoc.getElementById(room.id);
        if (el) {
          el.style.cursor = 'pointer';

          // Make sure Angular change detection runs when clicking
          el.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();

            // Run inside Angular zone so popup updates UI
            setTimeout(() => {
              this.openPopup(event, room);
            });
          });
        }
      });
    });
  }
  //#region function to get svg
  private updateSelectedOutletSvgs() {
    const outlet = this.filters.outlet;
    if (outlet === 'all') {
      this.selectedOutletSvgs = [];
      return;
    }
    const set = new Set<string>();
    this.rooms
      .filter((r) => r.outlet === outlet)
      .forEach((r) => r.svg.forEach((p) => set.add(p)));

    this.selectedOutletSvgs = Array.from(set);
  }
  //#endregion
  
  private attachRoomListeners(svgDoc: Document) {
    this.rooms.forEach((room) => {
      const el = svgDoc.getElementById(room.id);
      if (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (event: MouseEvent) => {
          this.openPopup(event, room);
        });
      }
    });
  }

// Add a search term for suite
suiteSearchTerm: string = '';

buildOptions() {
  console.log("=== Building Options ===");
  console.log("Current filters:", this.filters);

  let filteredForOutlet = this.rooms;
  let filteredForStatus = filteredForOutlet.filter(r =>
    this.filters.outlet === 'Select Outlet' || r.outlet === this.filters.outlet
  );
  console.log("After outlet filter:", filteredForStatus);

  let filteredForPax = filteredForStatus.filter(r =>
    this.filters.status === 'Select Status' || r.status === this.filters.status
  );
  console.log("After status filter:", filteredForPax);

  let filteredForSuite = filteredForPax.filter(r =>
    this.filters.pax === 'Select Pax' || r.capacity.toString() === this.filters.pax
  );
  console.log("After pax filter:", filteredForSuite);

  // Outlet options: all unique outlets
  this.outletOptions = Array.from(new Set(this.rooms.map(r => r.outlet))).sort();
  console.log("Outlet options:", this.outletOptions);

  // Status options: based on selected outlet
  this.statusOptions = Array.from(new Set(filteredForOutlet.map(r => r.status))).sort();
  console.log("Status options:", this.statusOptions);

// Pax options: based on selected outlet & status, removing 0 or ''
this.paxOptions = Array.from(
  new Set(
    this.rooms
      .filter(r => {
        const outletMatch = this.filters.outlet === 'Select Outlet' || r.outlet === this.filters.outlet;
        const statusMatch = this.filters.status === 'Select Status' || r.status === this.filters.status;
        return outletMatch && statusMatch;
      })
      .map(r => r.capacity?.toString().trim())
      .filter(cap => cap && cap !== "0") // remove empty or zero
  )
).sort((a, b) => Number(a) - Number(b));

console.log("Pax options:", this.paxOptions);

// Suite options: based on outlet, status & pax + search term
let allSuites = Array.from(
  new Set(filteredForSuite.map(r => r.name.trim()))
).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (this.suiteSearchTerm.trim()) {
  allSuites = allSuites.filter(name =>
    name.toLowerCase().includes(this.suiteSearchTerm.trim().toLowerCase())
  );
}

this.suiteOptions = allSuites;
console.log("Suite options:", this.suiteOptions);


  // Keep filtersConfig in sync
  this.filtersConfig.find(f => f.key === 'outlet')!.options = this.outletOptions;
  this.filtersConfig.find(f => f.key === 'status')!.options = this.statusOptions;
  this.filtersConfig.find(f => f.key === 'pax')!.options = this.paxOptions;
  this.filtersConfig.find(f => f.key === 'suite')!.options = this.suiteOptions;
}

  updateFilter(type: string, event: Event) {
    const key = type as keyof typeof this.filters;
    const select = event.target as HTMLSelectElement | null;
    if (select) {
      this.filters[key] = select.value;
      this.updateSelectedOutletSvgs();
      this.buildOptions(); 
      this.applyFilters();
    }
  }

  applyFilters() {
    this.filteredRooms = this.rooms.filter(
      (r) =>
        (this.filters.outlet === 'Select Outlet' || r.outlet === this.filters.outlet) &&
        (this.filters.status === 'Select Status' || r.status === this.filters.status) &&
        (this.filters.pax === 'Select Pax' ||
          r.capacity.toString() === this.filters.pax) &&
        (this.filters.suite === 'Select Suite' || r.name === this.filters.suite)
    )

    .sort((a, b) => {
    // Sort by Pax (capacity) if Pax filter is active
    if (this.filters.pax !== 'Select Pax') {
        return a.capacity - b.capacity;
    }
    // Sort by Suite name if Suite filter is active
    if (this.filters.suite !== 'Select Suite') {
        return a.name.localeCompare(b.name);
    }
    return 0; // No sorting if no filter
  });
    
    this.Occupied = this.filteredRooms.filter(
      (r) => r.status === 'Occupied'
    ).length;
    this.Available = this.filteredRooms.filter(
      (r) => r.status === 'Available'
    ).length;
    console.log('Occupied:', this.Occupied);
    console.log('Available:', this.Available);
    this.updateSvgColors();
  }

  updateSvgColors() {
    const objectEl = document.getElementById(
      'floorplanSvg'
    ) as HTMLObjectElement;
    const svgDoc = objectEl?.contentDocument;
    if (!svgDoc) return;

    this.rooms.forEach((room) => {
      const el = svgDoc.getElementById(room.id);
      if (el) {
        el.setAttribute(
          'fill',
          room.status === 'Occupied' ? '#ef4444' : '#22c55e'
        );
        el.setAttribute(
          'opacity',
          this.filteredRooms.includes(room) ? '1' : '0.3'
        );
      }
    });
  }

  openPopup(event: MouseEvent, room: Room) {
    this.selectedRoom = room;
    this.showPopup = true;

    // Position relative to viewport
    const clickX = event.clientX;
    const clickY = event.clientY;

    // Offset so popup doesn’t cover cursor
    this.popupX = clickX + 20;
    this.popupY = clickY - 20;
  }

  closePopup() {
    this.showPopup = false;
    this.selectedRoom = null;
  }

// Download current outlet's SVG
downloadFloorplan() {
  if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
    console.warn('No floorplan to download.');
    return;
  }

  // For now, download the first SVG
  const svgUrl = this.selectedOutletSvgs[0];
  const sanitizedUrl = this.sanitizer.sanitize(4, this.sanitizer.bypassSecurityTrustResourceUrl(svgUrl)); // 4 = SecurityContext.RESOURCE_URL

  if (!sanitizedUrl) {
    console.error('SVG URL could not be sanitized.');
    return;
  }

  const link = document.createElement('a');
  link.href = sanitizedUrl;
  link.download = 'floorplan.svg';
  link.click();
}

// Refresh rooms and reapply filters
refreshFloorplan() {
  window.location.reload();
}

}