import { Component, OnInit, AfterViewInit } from '@angular/core';
import { Room } from '../../core/models/room.model';
import { RoomService } from '../../core/services/room.service';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

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
  rooms: Room[] = [];
  filteredRooms: Room[] = [];

  filtersConfig: FilterConfig[] = [
    { key: 'outlet', label: 'Outlet', options: [] },
    { key: 'status', label: 'Status', options: [] },
    { key: 'pax', label: 'Pax', options: [] },
    { key: 'suite', label: 'Suite', options: [] },
  ];

  filters = { outlet: 'all', status: 'all', pax: 'all', suite: 'all' };
  outletOptions: string[] = [];
  statusOptions: string[] = [];
  paxOptions: string[] = [];
  suiteOptions: string[] = [];
  leftPanelCollapsed = false;

  selectedRoom: any;
  showPopup = false;
  popupX = 0;
  popupY = 0;

  occupied = 0;
  available = 0;

  safeSvgUrl!: SafeResourceUrl;

  // 👉 for collapse toggle
  rightPanelCollapsed: boolean = false;

  constructor(
    private roomService: RoomService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/8FA.svg');
    this.roomService.rooms$.subscribe((rooms) => {
      this.rooms = rooms;
      this.buildOptions();
      this.applyFilters();
    });
    this.roomService.fetchRooms();
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

  buildOptions() {
    this.outletOptions = Array.from(
      new Set(this.rooms.map((r) => r.outlet))
    ).sort();
    this.statusOptions = Array.from(
      new Set(this.rooms.map((r) => r.status))
    ).sort();
    this.paxOptions = Array.from(
      new Set(this.rooms.map((r) => r.capacity.toString()))
    ).sort();
    this.suiteOptions = Array.from(
      new Set(this.rooms.map((r) => r.name))
    ).sort();

    // keep filtersConfig options in sync
    this.filtersConfig.find((f) => f.key === 'outlet')!.options =
      this.outletOptions;
    this.filtersConfig.find((f) => f.key === 'status')!.options =
      this.statusOptions;
    this.filtersConfig.find((f) => f.key === 'pax')!.options = this.paxOptions;
    this.filtersConfig.find((f) => f.key === 'suite')!.options =
      this.suiteOptions;
  }

  updateFilter(type: string, event: Event) {
    const key = type as keyof typeof this.filters;
    const select = event.target as HTMLSelectElement | null;
    if (select) {
      this.filters[key] = select.value;
      this.applyFilters();
    }
  }

  applyFilters() {
    this.filteredRooms = this.rooms.filter(
      (r) =>
        (this.filters.outlet === 'all' || r.outlet === this.filters.outlet) &&
        (this.filters.status === 'all' || r.status === this.filters.status) &&
        (this.filters.pax === 'all' ||
          r.capacity.toString() === this.filters.pax) &&
        (this.filters.suite === 'all' || r.name === this.filters.suite)
    );

    this.occupied = this.filteredRooms.filter(
      (r) => r.status === 'occupied'
    ).length;
    this.available = this.filteredRooms.filter(
      (r) => r.status === 'available'
    ).length;

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
          room.status === 'occupied' ? '#ef4444' : '#22c55e'
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
}
