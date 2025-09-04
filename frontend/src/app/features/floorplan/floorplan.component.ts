import {
  Component,
  OnInit,
  AfterViewInit,
  ElementRef,
  ViewChildren,
  QueryList,
  ViewChild,
  NgZone,
} from '@angular/core';
import { Room } from '../../core/models/room.model';
import { RoomService, ResourceParams } from '../../core/services/room.service';
import { OfficeService } from '../../core/services/office.service';
import { ToastService } from '../../shared/services/toast.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, of } from 'rxjs'; 
import { catchError, finalize } from 'rxjs/operators';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ToastComponent } from '../../shared/components/toast.component';

type FilterKey = 'outlet' | 'status' | 'pax';

interface FilterConfig {
  key: FilterKey;
  label: string;
  options: string[];
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ToastComponent],
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
  displayedSvgs: string[] = [];
  selectedFloorSvg: string = 'all';
  floorOptions: string[] = [];

  // Loading states
  isLoadingOffices = false;
  isLoadingResources = false;
  isLoading = false;

  // Pax-based color palette
  paxPalette = ['rgb(61, 168, 218)','rgb(20, 50, 218)','rgb(215, 66, 218)','rgb(173, 4, 63)','rgb(240, 70, 40)','rgb(255, 166, 0)'] as const;
  paxBuckets = [
    { max: 4,        label: '≤4'   }, // ->rgb(61, 168, 218)
    { max: 6,        label: '5–6'  }, // ->rgb(20, 50, 218)
    { max: 8,        label: '7–8'  }, // ->rgb(215, 66, 218)
    { max: 12,       label: '9–12' }, // ->rgb(173, 4, 63)
    { max: 20,       label: '13–20'}, // ->rgb(240, 70, 40)
    { max: Infinity, label: '21+'  }, // ->rgb(255, 166, 0)
  ];

  // Multi-select suite functionality
  selectedSuites: string[] = [];
  suiteSearchTerm: string = '';

  isArray(value: unknown): boolean {
    return Array.isArray(value);
  }

  filtersConfig: FilterConfig[] = [
    { key: 'outlet', label: 'Outlet', options: [] },
    { key: 'status', label: 'Status', options: [] },
    { key: 'pax', label: 'Pax', options: [] },
  ];

  filters = {
    outlet: 'Select Outlet',
    status: 'Select Status',
    pax: 'Select Pax',
    svg: 'all',
  };
  outletOptions: string[] = [];
  statusOptions: string[] = [];
  paxOptions: string[] = [];
  suiteOptions: string[] = [];
  leftPanelCollapsed = false;

  selectedRoom: any;
  showPopup = false;
  showDownloadMenu = false;
  popupX = 0;
  popupY = 0;

  // PDF export loading states
  isExportingFloorplan = false;

  // User feedback for PDF export
  pdfExportMessage = '';
  showPdfMessage = false;

  // PDF quality settings for file size optimization
  pdfQualitySettings = {
    high: { scale: 2, quality: 0.9, dimensions: { width: 800, height: 600 } },
    medium: {
      scale: 1.5,
      quality: 0.7,
      dimensions: { width: 600, height: 450 },
    },
    low: { scale: 1, quality: 0.5, dimensions: { width: 400, height: 300 } },
  };

  selectedPdfQuality: 'high' | 'medium' | 'low' = 'medium';

  Occupied = 0;
  Available = 0;

  safeSvgUrl!: SafeResourceUrl;

  // 👉 for collapse toggle
  rightPanel: boolean = false;
  @ViewChildren('svgObject') svgObjects!: QueryList<
    ElementRef<HTMLObjectElement>
  >;
  @ViewChild('panelContainer', { static: false })
  panelContainer!: ElementRef<HTMLDivElement>;
  private processedSvgObjects = new WeakSet<HTMLObjectElement>();
  private safeUrlCache = new Map<string, SafeResourceUrl>();
  private roomIdIndex: Map<string, Room> = new Map();
  private objectToOriginalViewBox = new WeakMap<HTMLObjectElement, string>();
  // Friendly labels for specific outlets/files
  private floorLabelOverrides: Record<string, Record<string, string>> = {
    TTDI: {
      'TTDI-Level1.svg': 'Level 1',
      'TTDI-Level3A.svg': 'Level 3A',
      'Sibelco Office - L1.svg': 'Sibelco Office',
    },
    KLS: {
      'KLS- L20.svg': 'Level 20',
      'KLS-ByteDance.svg': 'Level 21 ByteDance',
      'KLS-L21.svg': 'Level 21',
      'KLS-L28.svg': 'Level 28',
    },
    MUB: {
      'MUB-level9.svg': 'Level 9',
      'MUB-level12.svg': 'Level 12',
      'MUB-level17.svg': 'Level 17',
    },
    UBP3A: {
      'UBP-L13A.svg': 'Level 13A',
      'UBP-L13AAIRIT.svg': 'Level 13A AIRIT',
    },
    '8FA': {
      '8FA.svg': 'Floor 15',
    },
    ITG: {
      'ITG.svg': 'Floor 9',
    },
    UBP: {
      'UBP.svg': 'Floor 2',
    },
    KLG: {
      'KLG.svg': 'Floor 3',
    },
    SV2: {
      'SV2.svg': 'Floor 12',
    },
    SPM: {
      'SPM.svg': 'Floor 4',
    },
  };

  private basename(path: string): string {
    return (path || '').split(/[\\/]/).pop() || path;
  }
  constructor(
    private roomService: RoomService,
    private officeService: OfficeService,
    private toastService: ToastService,
    public sanitizer: DomSanitizer,
    private ngZone: NgZone
  ) {}

  getSafeUrl(url: string): SafeResourceUrl {
    const cached = this.safeUrlCache.get(url);
    if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.safeUrlCache.set(url, safe);
    return safe;
  }

  trackBySvgUrl = (_: number, url: string) => url;

  ngOnInit() {
    // 1) Load outlets first
    this.loadOffices();

    // 2) Subscribe to rooms changes
    this.roomService.rooms$.subscribe((rooms) => {
      this.rooms = rooms;
      this.roomIdIndex = this.buildRoomIdIndex();

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
  }

  // Load offices on app start
  loadOffices() {
    this.isLoadingOffices = true;
    this.officeService.loadOffices().pipe(
      catchError((error) => {
        console.error('Error loading outlet:', error);
        this.toastService.error('Failed to load outlet. Please try again.');
        return of(null);
      }),
      finalize(() => {
        this.isLoadingOffices = false;
      })
    ).subscribe((response) => {
      if (response && response.success) {
        this.toastService.success('Offices loaded successfully');
        this.buildOptions();
      }
    });
  }

  // When user selects an outlet
  onOutletChange(outletDisplayName: string) {
    if (!outletDisplayName || outletDisplayName === 'Select Outlet') {
      this.rooms = [];
      this.filteredRooms = [];
      this.selectedOutletSvgs = [];
      this.displayedSvgs = [];
      this.buildOptions();
      this.applyFilters();
      return;
    }

    // Get the office ID from the display name
    const officeId = this.getOfficeIdFromOutletName(outletDisplayName);
    if (!officeId) {
      console.error('Office ID not found for outlet:', outletDisplayName);
      this.toastService.error('Invalid outlet selected');
      return;
    }

    // 3) Fetch resources for this outlet using office.id
    this.loadResources({ officeId });
  }

  // Fetch resources for selected outlet
  loadResources(params: ResourceParams) {
    this.isLoadingResources = true;
    this.roomService.getResources(params).pipe(
      catchError((error) => {
        console.error('Error loading resources:', error);
        this.toastService.error('Failed to load resources. Please try again.');
        return of(null);
      }),
      finalize(() => {
        this.isLoadingResources = false;
      })
    ).subscribe((response) => {
      if (response) {
        this.toastService.success('Resources loaded successfully');
        // Update selected outlet SVGs and build filters from backend data
        this.updateSelectedOutletSvgs();
        this.buildFiltersFromBackend();
        // Force SVG color updates after data is loaded
        setTimeout(() => this.updateSvgColors(), 100);
      }
    });
  }

  // Build filters from backend data
  buildFiltersFromBackend() {
    this.buildOptions();
    this.applyFilters();
  }

  private attachSvgListeners() {
    const objectEl = document.getElementById(
      'floorplanSvg'
    ) as HTMLObjectElement;
    if (!objectEl) return;

    const svgDoc = objectEl.contentDocument;
    if (!svgDoc) return;

    this.attachRoomListeners(svgDoc);
    this.updateSvgColors();
  }

  ngAfterViewInit() {
    const attach = () => {
      if (!this.svgObjects) return;
      this.svgObjects.forEach((ref) => {
        const objectEl = ref.nativeElement as HTMLObjectElement;
        const onLoad = () => {
          const svgDoc = objectEl.contentDocument as Document | null;
          if (!svgDoc) return;
          // Capture original viewBox once
          const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement | null;
          if (rootSvg && !this.objectToOriginalViewBox.has(objectEl)) {
            let vb = rootSvg.getAttribute('viewBox');
            if (!vb) {
              const width = Number(rootSvg.getAttribute('width')) || 1000;
              const height = Number(rootSvg.getAttribute('height')) || 1000;
              vb = `0 0 ${width} ${height}`;
              rootSvg.setAttribute('viewBox', vb);
            }
            this.objectToOriginalViewBox.set(objectEl, vb!);
          }
          this.attachRoomListeners(svgDoc);
          this.updateSvgColors(svgDoc);
        };
        if (!this.processedSvgObjects.has(objectEl)) {
          objectEl.addEventListener('load', onLoad);
          this.processedSvgObjects.add(objectEl);
        }
        if (objectEl.contentDocument) {
          onLoad();
        }
      });
    };
    attach();
    this.svgObjects.changes.subscribe(() => setTimeout(attach));
  }
  //#region function to get svg
  private updateSelectedOutletSvgs() {
    const outlet = this.filters.outlet;
    if (!outlet || outlet === 'Select Outlet') {
      this.selectedOutletSvgs = [];
      this.displayedSvgs = [];
      this.selectedFloorSvg = 'all';
      this.floorOptions = [];
      return;
    }
    const set = new Set<string>();
    this.rooms
      .filter((r) => r.outlet === outlet)
      .forEach((r) => r.svg.forEach((p) => set.add(p)));

    this.selectedOutletSvgs = Array.from(set);
    this.floorOptions = this.selectedOutletSvgs.slice();
    // default to all floors when outlet changes
    this.selectedFloorSvg = 'all';
    this.updateDisplayedSvgs();
  }
  //#endregion

  private attachRoomListeners(svgDoc: Document) {
    // Delegate a single click handler per SVG document
    const handleClick = (event: MouseEvent) => {
      const pageX =
        (event as MouseEvent).pageX ?? event.clientX + window.scrollX;
      const pageY =
        (event as MouseEvent).pageY ?? event.clientY + window.scrollY;
      console.log('[Floorplan] SVG click', { pageX, pageY });

      let target = event.target as Element | null;
      const root = svgDoc.documentElement as Element | null;
      let matched = false;
      while (target && target !== root) {
        const el = target as HTMLElement;
        let candidate =
          el.id ||
          el.getAttribute?.('data-id') ||
          el.getAttribute?.('data-room') ||
          '';
        // Support <use href="#id"> patterns
        if (!candidate) {
          const href =
            el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
          if (href && href.startsWith('#')) candidate = href.slice(1);
        }
        if (candidate) {
          const normalized = this.normalizeId(candidate);
          console.log('[Floorplan] candidate', {
            candidate,
            normalized,
            tag: el.tagName,
          });
          const room = this.roomIdIndex.get(normalized);
          if (room) {
            console.log('[Floorplan] matched room', {
              id: room.id,
              name: room.name,
            });
            this.openPopupFromRoom(room, event);
            matched = true;
            return;
          }
        }
        target = target.parentNode as Element | null;
      }
      if (!matched) {
        console.log('[Floorplan] click had no matching room element');
        // Background click → reset view and close popup for better UX
        this.closePopup();
      }
    };

    // Ensure we do not attach multiple listeners to the same document
    const marker = '__ps_click_bound__';
    if (!(svgDoc as any)[marker]) {
      // Bind inside Angular zone so change detection runs after click
      svgDoc.addEventListener('click', (ev: Event) =>
        this.ngZone.run(() => handleClick(ev as MouseEvent))
      );
      (svgDoc as any)[marker] = true;
    }

    // Strong per-room binding: make each detected room element directly clickable
    this.rooms.forEach((room) => {
      const el = this.findRoomElementInDoc(svgDoc, room) as HTMLElement | null;
      if (!el) return;
      (el as any).style.cursor = 'pointer';
      (el as any).style.pointerEvents = 'auto';
      const roomMarker = '__ps_room_bound__';
      if (!(el as any)[roomMarker]) {
        el.addEventListener('click', (ev: MouseEvent) =>
          this.ngZone.run(() => {
            ev.preventDefault();
            ev.stopPropagation();
            console.log('[Floorplan] direct room click', {
              id: room.id,
              name: room.name,
            });
            this.openPopupFromRoom(room, ev);
          })
        );
        (el as any)[roomMarker] = true;
      }
    });
  }

  buildOptions() {
    console.log('=== Building Options ===');
    console.log('Current filters:', this.filters);

    let filteredForOutlet = this.rooms;
    let filteredForStatus = filteredForOutlet.filter(
      (r) =>
        this.filters.outlet === 'Select Outlet' ||
        r.outlet === this.filters.outlet
    );
    console.log('After outlet filter:', filteredForStatus);

    let filteredForPax = filteredForStatus.filter(
      (r) =>
        this.filters.status === 'Select Status' ||
        r.status === this.filters.status
    );
    console.log('After status filter:', filteredForPax);

    let filteredForSuite = filteredForPax.filter(
      (r) =>
        this.filters.pax === 'Select Pax' ||
        r.capacity.toString() === this.filters.pax
    );
    console.log('After pax filter:', filteredForSuite);

    // Outlet options: from office service
    this.outletOptions = this.officeService.getOffices().map(office => office.displayName).sort();
    console.log('Outlet options:', this.outletOptions);

    // Status options: based on selected outlet
    this.statusOptions = Array.from(
      new Set(filteredForOutlet.map((r) => r.status))
    ).sort();
    console.log('Status options:', this.statusOptions);

    // Pax options: based on selected outlet & status, removing 0 or ''
    this.paxOptions = Array.from(
      new Set(
        this.rooms
          .filter((r) => {
            const outletMatch =
              this.filters.outlet === 'Select Outlet' ||
              r.outlet === this.filters.outlet;
            const statusMatch =
              this.filters.status === 'Select Status' ||
              r.status === this.filters.status;
            return outletMatch && statusMatch;
          })
          .map((r) => r.capacity?.toString().trim())
          .filter((cap) => cap && cap !== '0') // remove empty or zero
      )
    ).sort((a, b) => Number(a) - Number(b));

    console.log('Pax options:', this.paxOptions);

    // Suite options: based on outlet, status & pax + search term
    let allSuites = Array.from(
      new Set(filteredForSuite.map((r) => r.name.trim()))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (this.suiteSearchTerm.trim()) {
      allSuites = allSuites.filter((name) =>
        name.toLowerCase().includes(this.suiteSearchTerm.trim().toLowerCase())
      );
    }

    this.suiteOptions = allSuites;
    console.log('Suite options:', this.suiteOptions);

    // Keep filtersConfig in sync
    this.filtersConfig.find((f) => f.key === 'outlet')!.options =
      this.outletOptions;
    this.filtersConfig.find((f) => f.key === 'status')!.options =
      this.statusOptions;
    this.filtersConfig.find((f) => f.key === 'pax')!.options = this.paxOptions;
  }

  updateFilter(type: string, event: Event) {
    const key = type as keyof typeof this.filters;
    const select = event.target as HTMLSelectElement | null;
    if (select) {
      this.filters[key] = select.value;
      if (key === 'outlet') {
        // When outlet changes, load resources for that outlet
        this.onOutletChange(select.value);
        this.updateSelectedOutletSvgs();
        this.updateDisplayedSvgs();
      } else {
        // For other filters, apply client-side filtering
        this.buildOptions();
        this.applyFilters();
        // Update SVG colors after filter changes
        setTimeout(() => this.updateSvgColors(), 50);
      }
      
      if (key === 'status' || key === 'pax' || key === 'outlet') {
        // Only auto-zoom if filtering yields exactly one room
        if (this.filteredRooms.length === 1) {
          const onlyRoom = this.filteredRooms[0];
          console.log('[Floorplan] zoom due to filters yielding one room', {
            id: onlyRoom.id,
            name: onlyRoom.name,
            key,
            value: this.filters[key],
          });
          setTimeout(() => this.openPopupFromRoom(onlyRoom), 60);
        } else {
          this.closePopup();
        }
      }
    }
  }

  // Floor selection handler
  onFloorChange(event: Event) {
    const select = event.target as HTMLSelectElement | null;
    if (select) {
      this.selectedFloorSvg = select.value;
      this.updateDisplayedSvgs();
      // colors/handlers will reattach on next load event automatically
    }
  }

  private updateDisplayedSvgs() {
    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      this.displayedSvgs = [];
      return;
    }
    if (this.selectedFloorSvg === 'all') {
      this.displayedSvgs = this.selectedOutletSvgs.slice();
    } else {
      this.displayedSvgs = this.selectedOutletSvgs.filter(
        (p) => p === this.selectedFloorSvg
      );
    }
  }

  applyFilters() {
    this.filteredRooms = this.rooms
      .filter(
        (r) =>
          (this.filters.outlet === 'Select Outlet' ||
            r.outlet === this.filters.outlet) &&
          (this.filters.status === 'Select Status' ||
            r.status === this.filters.status) &&
          (this.filters.pax === 'Select Pax' ||
            r.capacity.toString() === this.filters.pax) &&

          (this.selectedSuites.length === 0 ||
            this.selectedSuites.includes(r.name))
      )

      .sort((a, b) => {
        // Sort by Pax (capacity) if Pax filter is active
        if (this.filters.pax !== 'Select Pax') {
          return a.capacity - b.capacity;
        }
        // Sort by Suite name if Suite filter is active
        if (this.selectedSuites.length > 0) {
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
    console.log('Filtered rooms:', this.filteredRooms.length);
    console.log('Occupied:', this.Occupied);
    console.log('Available:', this.Available);
    
    // Update SVG colors after filtering
    this.updateSvgColors();
  }

  updateSvgColors(svgDoc?: Document) {
    const applyColors = (doc: Document) => {
      this.rooms.forEach((room) => {
        const el = doc.getElementById(room.id);
        if (el) {
          if (this.filteredRooms.includes(room)) {
            // Selected → colored with pax-based palette for available rooms
            let color: string;
            if (room.status === 'Occupied') {
              color = '#ef4444'; // Red for occupied
            } else if (this.filters.status === 'Available') {
              // Use pax-based palette for available rooms
              color = this.getPaxColor(room.capacity);
            } else {
              color = '#22c55e'; // Green for available (default)
            }
            
            el.setAttribute('fill', color);
            el.setAttribute('opacity', '0.7');
            (el as any).style.pointerEvents = 'auto';
          } else {
            // Not selected → transparent fill but remain clickable
            el.setAttribute('fill', 'none');
            el.setAttribute('opacity', '0.35');
            (el as any).style.pointerEvents = 'auto';
          }
          (el as any).style.cursor = 'pointer';
        }
      });
    };

    if (svgDoc) {
      applyColors(svgDoc);
    } else {
      const objectEls = document.querySelectorAll<HTMLObjectElement>(
        'object[type="image/svg+xml"]'
      );
      objectEls.forEach((objectEl) => {
        const doc = objectEl.contentDocument;
        if (doc) applyColors(doc);
      });
    }
  }

  // Get color based on pax capacity
  getPaxColor(capacity: number): string {
    for (let i = 0; i < this.paxBuckets.length; i++) {
      if (capacity <= this.paxBuckets[i].max) {
        return this.paxPalette[i];
      }
    }
    return this.paxPalette[this.paxPalette.length - 1]; // Fallback to last color
  }

  // Multi-select suite functionality
  toggleSuiteSelection(suiteName: string) {
    const index = this.selectedSuites.indexOf(suiteName);
    if (index > -1) {
      this.selectedSuites.splice(index, 1);
    } else {
      this.selectedSuites.push(suiteName);
    }
    this.applyFilters();
  }

  isSuiteSelected(suiteName: string): boolean {
    return this.selectedSuites.includes(suiteName);
  }

  clearSuiteSelection() {
    this.selectedSuites = [];
    this.applyFilters();
  }

  // Handle suite search input changes
  onSuiteSearchChange() {
    // Rebuild options to apply the search filter
    // Use setTimeout to debounce the search for better performance
    setTimeout(() => {
      this.buildOptions();
    }, 100);
  }

  // Get office ID from outlet name
  getOfficeIdFromOutletName(outletName: string): string | undefined {
    const office = this.officeService.getOffices().find(o => o.displayName === outletName);
    return office?.id;
  }

  private normalizeId(value: string | undefined | null): string {
    if (!value) return '';
    return value
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private buildRoomIdIndex(): Map<string, Room> {
    const index = new Map<string, Room>();
    this.rooms.forEach((room) => {
      const candidates = [
        room.id,
        room.name,
        room.name?.replace(/\s+/g, ''),
        room.name?.replace(/\s+/g, '-'),
        room.name?.replace(/\s+/g, '_'),
      ];
      candidates.forEach((c) => {
        const key = this.normalizeId(c);
        if (key) index.set(key, room);
      });
    });
    return index;
  }

  private findRoomElementInDoc(doc: Document, room: Room): Element | null {
    const byId = doc.getElementById(room.id);
    if (byId) return byId;
    // Try alternative id variants based on name
    const variants = [
      room.name,
      room.name.replace(/\s+/g, ''),
      room.name.replace(/\s+/g, '-'),
      room.name.replace(/\s+/g, '_'),
    ];
    for (const v of variants) {
      const el = doc.getElementById(v);
      if (el) return el;
    }
    return null;
  }

  private getSvgViewBox(
    rootSvg: SVGSVGElement
  ): { x: number; y: number; w: number; h: number } | null {
    const vb = rootSvg.getAttribute('viewBox');
    if (!vb) return null;
    const [x, y, w, h] = vb.split(/\s+/).map(Number);
    if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
    return { x, y, w, h };
  }

  // Convert a DOM client rect to SVG viewBox units
  private clientRectToSvgBBox(
    objectEl: HTMLObjectElement,
    rootSvg: SVGSVGElement,
    rect: DOMRect
  ): { x: number; y: number; width: number; height: number } | null {
    const objectRect = objectEl.getBoundingClientRect();
    const vb = this.getSvgViewBox(rootSvg);
    if (!vb || objectRect.width === 0 || objectRect.height === 0) return null;
    const unitsPerPxX = vb.w / objectRect.width;
    const unitsPerPxY = vb.h / objectRect.height;
    const x = vb.x + (rect.left - objectRect.left) * unitsPerPxX;
    const y = vb.y + (rect.top - objectRect.top) * unitsPerPxY;
    const width = rect.width * unitsPerPxX;
    const height = rect.height * unitsPerPxY;
    return { x, y, width, height };
  }

  private openPopupFromRoom(room: Room, clickEvent?: MouseEvent) {
    let positioned = false;
    if (this.svgObjects) {
      this.svgObjects.forEach((ref) => {
        if (positioned) return;
        const objectEl = ref.nativeElement as HTMLObjectElement;
        const doc = objectEl.contentDocument as Document | null;
        if (!doc) return;
        const rootSvg = doc.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) return;
        const viewBox = this.getSvgViewBox(rootSvg);
        if (!viewBox) return;
        const el = this.findRoomElementInDoc(doc, room) as any;
        if (!el || !el.getBBox) return;
        
        // Get the room's bounding box in SVG coordinates
        const bbox = el.getBBox();
        
        // Get the SVG object's position and size on the page
        const objectRect = objectEl.getBoundingClientRect();
        
        // Calculate the scale factors from SVG viewBox to actual display size
        const scaleX = objectRect.width / viewBox.w;
        const scaleY = objectRect.height / viewBox.h;
        
        let popupX: number;
        let popupY: number;
        
                 if (clickEvent) {
           // Position popup adjacent to the room's bounding box
           const roomCenterX = bbox.x + bbox.width / 2;
           const roomCenterY = bbox.y + bbox.height / 2;
           
           // Convert SVG coordinates to screen coordinates
           const screenX = objectRect.left + (roomCenterX - viewBox.x) * scaleX;
           const screenY = objectRect.top + (roomCenterY - viewBox.y) * scaleY;
           
           // Position popup to the right of the room
           popupX = screenX + bbox.width * scaleX / 2 + 10; // 10px offset from room edge
           popupY = screenY - 10; // 10px offset above room center
           
           // Convert to container-relative coordinates
           const containerRect = this.panelContainer?.nativeElement?.getBoundingClientRect();
           if (containerRect) {
             popupX = popupX - containerRect.left;
             popupY = popupY - containerRect.top;
           }
         } else {
           // Fallback: position popup adjacent to the room's bounding box
           const roomCenterX = bbox.x + bbox.width / 2;
           const roomCenterY = bbox.y + bbox.height / 2;
           
           // Convert SVG coordinates to screen coordinates
           const screenX = objectRect.left + (roomCenterX - viewBox.x) * scaleX;
           const screenY = objectRect.top + (roomCenterY - viewBox.y) * scaleY;
           
           // Position popup to the right of the room
           popupX = screenX + bbox.width * scaleX / 2 + 10; // 10px offset from room edge
           popupY = screenY - 10; // 10px offset above room center
           
           // Convert to container-relative coordinates
           const containerRect = this.panelContainer?.nativeElement?.getBoundingClientRect();
           if (containerRect) {
             popupX = popupX - containerRect.left;
             popupY = popupY - containerRect.top;
           }
         }
        
        // Ensure popup stays within container bounds
        const popupWidth = 192; // w-48 = 12rem = 192px
        const popupHeight = 120; // estimated height for compact popup
        const containerRect = this.panelContainer?.nativeElement?.getBoundingClientRect();
        
        if (containerRect) {
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          
          // Adjust if popup would go outside container
          if (popupX + popupWidth > containerWidth) {
            popupX = containerWidth - popupWidth - 10;
          }
          if (popupX < 0) {
            popupX = 10;
          }
          if (popupY < 0) {
            popupY = 10;
          }
          if (popupY + popupHeight > containerHeight) {
            popupY = containerHeight - popupHeight - 10;
          }
        }
        
        this.selectedRoom = room;
        this.showPopup = true;
        this.popupX = Math.max(0, popupX);
        this.popupY = Math.max(0, popupY);

        positioned = true;
      });
    }
    if (!positioned) {
      this.selectedRoom = room;
      this.showPopup = true;
      this.popupX = Math.max(16, window.innerWidth / 2 - 130);
      this.popupY = Math.max(16, window.innerHeight / 2 - 100);
      console.log('[Floorplan] popup fallback center', {
        room: room.name,
        x: this.popupX,
        y: this.popupY,
      });
    }
  }

  private downloadBlob(fileName: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async downloadFloorplanWithDetails(format: 'svg' | 'png' = 'svg') {
    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to download.');
      return;
    }
    const first = this.svgObjects?.first?.nativeElement as
      | HTMLObjectElement
      | undefined;
    const doc = first?.contentDocument as Document | null;
    const rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;
    if (!doc || !rootSvg) return;

    // Clone SVG
    const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;

    // Ensure the download uses the original full viewBox, not the current zoomed one
    const originalViewBox = first
      ? this.objectToOriginalViewBox.get(first)
      : null;
    if (originalViewBox) {
      svgClone.setAttribute('viewBox', originalViewBox);
    }

    // If popup has selected room, embed details into the cloned SVG
    if (this.selectedRoom) {
      const el = this.findRoomElementInDoc(doc, this.selectedRoom);
      if (el && (el as any).getBBox) {
        const bbox = (el as any).getBBox();
        const overlayGroup = doc.createElementNS(
          'http://www.w3.org/2000/svg',
          'g'
        );
        const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
        const lines = [
          `${this.selectedRoom.name}`,
          `Status: ${this.selectedRoom.status}`,
          `Capacity: ${this.selectedRoom.capacity}`,
          `Type: ${this.selectedRoom.type}`,
          `Area: ${this.selectedRoom.area} sqft`,
          `Price: RM ${this.selectedRoom.price}`,
          `Deposit: RM ${this.selectedRoom.deposit}`,
        ];

        // Add YouTube link if available
        if (this.selectedRoom.video) {
          lines.push(`Video: ${this.selectedRoom.video}`);
        }

        const pad = 10;
        const lineHeight = 18;
        const boxWidth = 320;
        const boxHeight = lineHeight * (lines.length + 1) + pad * 2;
        let boxX = bbox.x + bbox.width + 10;
        let boxY = Math.max(0, bbox.y - 10);

        // Keep overlay box within the clone's viewBox bounds
        const vbAttr = svgClone.getAttribute('viewBox');
        if (vbAttr) {
          const [vx, vy, vw, vh] = vbAttr.split(/\s+/).map(Number);
          if (!Number.isNaN(vw) && !Number.isNaN(vh)) {
            if (boxX + boxWidth > vx + vw) boxX = vx + vw - boxWidth - 5;
            if (boxX < vx) boxX = vx + 5;
            if (boxY + boxHeight > vy + vh) boxY = vy + vh - boxHeight - 5;
            if (boxY < vy) boxY = vy + 5;
          }
        }

        rect.setAttribute('x', String(boxX));
        rect.setAttribute('y', String(boxY));
        rect.setAttribute('rx', '6');
        rect.setAttribute('ry', '6');
        rect.setAttribute('width', String(boxWidth));
        rect.setAttribute('height', String(boxHeight));
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#e5e7eb');
        rect.setAttribute('stroke-width', '1');

        text.setAttribute('x', String(boxX + pad));
        text.setAttribute('y', String(boxY + pad + lineHeight));
        text.setAttribute('fill', '#111827');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');

        lines.forEach((line, idx) => {
          const tspan = doc.createElementNS(
            'http://www.w3.org/2000/svg',
            'tspan'
          );
          tspan.setAttribute('x', String(boxX + pad));
          tspan.setAttribute('dy', idx === 0 ? '0' : String(lineHeight));
          tspan.textContent = line;
          text.appendChild(tspan);
        });

        overlayGroup.appendChild(rect);
        overlayGroup.appendChild(text);
        svgClone.appendChild(overlayGroup);
      }
    }

    if (format === 'svg') {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);
      const blob = new Blob([svgString], {
        type: 'image/svg+xml;charset=utf-8',
      });
      this.downloadBlob('floorplan-with-details.svg', blob);
      return;
    }

    // Convert SVG to image via canvas for PNG exports
    const vb = svgClone.getAttribute('viewBox') || '0 0 1000 1000';
    const [, , vwStr, vhStr] = vb.split(/\s+/);
    const vw = Number(vwStr) || 1000;
    const vh = Number(vhStr) || 1000;
    const scale = 2; // sharper output
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vw * scale));
    canvas.height = Math.max(1, Math.floor(vh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const img = new Image();
    const svgBlob = new Blob([svgData], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const svgUrl = URL.createObjectURL(svgBlob);
    await new Promise<void>((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);
        resolve();
      };
      img.src = svgUrl;
    });

    if (format === 'png') {
      const pngBlob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res as any, 'image/png')
      );
      if (pngBlob) this.downloadBlob('floorplan-with-details.png', pngBlob);
      return;
    }
  }
  openPopup(event: MouseEvent, room: Room) {
    this.selectedRoom = room;
    this.showPopup = true;

    // Position relative to page mouse coordinates (like vanilla example)
    const pageX = (event as MouseEvent).pageX ?? event.clientX + window.scrollX;
    const pageY = (event as MouseEvent).pageY ?? event.clientY + window.scrollY;
    this.popupX = pageX + 15;
    this.popupY = pageY - 30;

    // Keep within viewport if possible
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupWidth = 260;
    const popupHeight = 200;
    if (this.popupX + popupWidth > vw) this.popupX = vw - popupWidth - 8;
    if (this.popupY + popupHeight > vh) this.popupY = vh - popupHeight - 8;

    console.log('[Floorplan] popup opened (click)', {
      OutletID: room.outlet,
      ID: room.id,
      room: room.name,
      x: this.popupX,
      y: this.popupY,
    });
  }

  closePopup() {
    this.showPopup = false;
    this.selectedRoom = null;
    // Briefly yield to allow DOM to update, then ensure new clicks re-open popup
    setTimeout(() => {
      console.log('[Floorplan] popup closed');
    });
  }

  // Download current outlet's SVG
  downloadFloorplan() {
    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to download.');
      return;
    }

    // For now, download the first SVG
    const svgUrl = this.selectedOutletSvgs[0];
    const sanitizedUrl = this.sanitizer.sanitize(
      4,
      this.sanitizer.bypassSecurityTrustResourceUrl(svgUrl)
    ); // 4 = SecurityContext.RESOURCE_URL

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
    // Reset all filter selections to default values
    this.filters = {
      outlet: 'Select Outlet',
      status: 'Select Status',
      pax: 'Select Pax',
      svg: 'all',
    };

    // Reset suite search term
    this.suiteSearchTerm = '';

    // Close any open popup
    this.closePopup();

    // Update selected outlet SVGs
    this.updateSelectedOutletSvgs();

    // Rebuild options and apply filters
    this.buildOptions();
    this.applyFilters();
  }

  toggleDownloadMenu(event?: Event) {
    event?.stopPropagation();
    this.showDownloadMenu = !this.showDownloadMenu;
  }

  downloadOption(fmt: 'svg' | 'png') {
    this.showDownloadMenu = false;
    this.downloadFloorplanWithDetails(fmt);
  }

  // Export floorplan as PDF
  async exportFloorplanAsPdf() {
    // Close download menu
    this.showDownloadMenu = false;

    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to export.');
      return;
    }

    this.isExportingFloorplan = true;

    try {
      // Create PDF document with compression settings for smaller file size
      const pdf = new jsPDF('landscape', 'mm', 'a4');

      // Enable PDF compression and optimization
      pdf.setProperties({
        title: 'Private Suite Dashboard - Floorplan',
        subject: 'Floorplan Export',
        author: 'Private Suite Dashboard',
        creator: 'Private Suite Dashboard',
      });

      // Set compression level for smaller file size
      // Note: jsPDF automatically applies compression, but we can optimize the content

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // We will iterate through rendered SVG objects (single floor or all floors)
      const objects = this.svgObjects?.toArray?.() ?? [];
      for (let idx = 0; idx < objects.length; idx++) {
        const objectRef = objects[idx];
        const objectEl = objectRef.nativeElement as HTMLObjectElement;
        const doc = objectEl.contentDocument as Document | null;
        const rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;

        if (!rootSvg) continue;

        if (idx > 0) {
          pdf.addPage('landscape');
        }

        // Page title and filters
        pdf.setFontSize(20);
        pdf.setTextColor(255, 102, 0);
        pdf.text('Private Suite Dashboard - Floorplan', 20, 20);
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        let yPos = 35;
        if (this.filters.outlet !== 'Select Outlet') {
          pdf.text(`Outlet: ${this.filters.outlet}`, 20, yPos);
          yPos += 8;
        }
        const floorLabel = this.getFloorLabel(this.displayedSvgs[idx] || '');
        if (floorLabel) {
          pdf.text(`Floor: ${floorLabel}`, 20, yPos);
          yPos += 8;
        }
        if (this.filters.status !== 'Select Status') {
          pdf.text(`Status: ${this.filters.status}`, 20, yPos);
          yPos += 8;
        }
        if (this.filters.pax !== 'Select Pax') {
          pdf.text(`Pax: ${this.filters.pax}`, 20, yPos);
          yPos += 8;
        }
        if (this.selectedSuites.length > 0) {
          pdf.text(`Suites: ${this.selectedSuites.join(', ')}`, 20, yPos);
          yPos += 8;
        }

        // Clone and reset viewBox to original
        const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;
        const originalViewBox = this.objectToOriginalViewBox.get(objectEl);
        if (originalViewBox) {
          svgClone.setAttribute('viewBox', originalViewBox);
        }

        try {
          const canvas = await this.svgToCanvas(svgClone);
          const margin = 5;
          const imgY = Math.max(yPos + 4, 24);
          const maxWidth = pageWidth - margin * 2;
          const maxHeight = pageHeight - imgY - margin;
          const aspect = canvas.width / canvas.height;
          let imgWidth = maxWidth;
          let imgHeight = imgWidth / aspect;
          if (imgHeight > maxHeight) {
            imgHeight = maxHeight;
            imgWidth = imgHeight * aspect;
          }
          const imgX = (pageWidth - imgWidth) / 2;
          const quality =
            this.pdfQualitySettings[this.selectedPdfQuality].quality;
          const imgData = canvas.toDataURL('image/jpeg', quality);
          pdf.addImage(
            imgData,
            'PNG',
            imgX,
            imgY,
            imgWidth,
            imgHeight,
            undefined,
            'FAST'
          );
        } catch (canvasError) {
          console.warn(
            'Failed to convert SVG to canvas on page',
            idx + 1,
            canvasError
          );
          pdf.setFontSize(14);
          pdf.setTextColor(0, 0, 0);
          pdf.text('Floorplan SVG (could not render image)', 20, 20);
        }
      }

      // Save PDF with compression
      const fileName = `floorplan-${
        this.filters.outlet !== 'Select Outlet' ? this.filters.outlet : 'all'
      }-${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);

      // Show success message with file size info
      const estimatedSize = this.getEstimatedFileSize();
      this.showMessage(
        `Floorplan PDF exported successfully! 🎉 (Estimated size: ${estimatedSize})`
      );
    } catch (error) {
      console.error('Error exporting floorplan as PDF:', error);
      this.showMessage(
        'Failed to export floorplan PDF. Please try again.',
        true
      );
    } finally {
      this.isExportingFloorplan = false;
    }
  }

  // Helper method to add room table to PDF
  private addRoomTableToPdf(pdf: jsPDF, startY: number) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const tableWidth = pageWidth - margin * 2;
    const colWidths = [tableWidth * 0.3, tableWidth * 0.7]; // Room name: 30%, Details: 70%

    // Table headers
    pdf.setFillColor(243, 244, 246); // Light gray background
    pdf.rect(margin, startY, tableWidth, 12, 'F');
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');

    pdf.text('Room Name', margin + 5, startY + 8);
    pdf.text('Details', margin + colWidths[0] + 5, startY + 8);

    // Table rows
    let currentY = startY + 12;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);

    for (const room of this.filteredRooms) {
      // Check if we need a new page
      if (currentY > pdf.internal.pageSize.getHeight() - 40) {
        pdf.addPage();
        currentY = 20;
      }

      // Room name
      pdf.setTextColor(0, 0, 0);
      pdf.text(room.name, margin + 5, currentY + 6);

      // Room details
      const details = [
        `Type: ${room.type}`,
        `Status: ${room.status}`,
        `Pax: ${room.capacity}`,
        `Area: ${room.area} sqft`,
        `Price: RM ${room.price}`,
        `Deposit: RM ${room.deposit}`,
      ];

      let detailY = currentY;
      for (const detail of details) {
        pdf.setTextColor(75, 85, 99); // Gray text
        pdf.text(detail, margin + colWidths[0] + 5, detailY + 6);
        detailY += 4;
      }

      // Row separator
      currentY = Math.max(currentY + 12, detailY + 4);
      pdf.setDrawColor(229, 231, 235); // Light gray border
      pdf.line(margin, currentY, margin + tableWidth, currentY);
      currentY += 2;
    }
  }

  // Helper method to convert SVG to canvas more reliably
  private async svgToCanvas(
    svgElement: SVGSVGElement
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        // Method 1: Try using html2canvas first
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        // Use quality settings for optimal file size
        const quality = this.pdfQualitySettings[this.selectedPdfQuality];
        tempDiv.style.width = `${quality.dimensions.width}px`;
        tempDiv.style.height = `${quality.dimensions.height}px`;
        tempDiv.style.backgroundColor = '#ffffff';

        const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
        svgClone.style.width = '100%';
        svgClone.style.height = '100%';
        tempDiv.appendChild(svgClone);
        document.body.appendChild(tempDiv);

        html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: quality.scale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: quality.dimensions.width,
          height: quality.dimensions.height,
          // Additional optimizations for smaller file size
          removeContainer: true,
          foreignObjectRendering: false,
          imageTimeout: 0,
        })
          .then((canvas) => {
            document.body.removeChild(tempDiv);
            resolve(canvas);
          })
          .catch((error) => {
            document.body.removeChild(tempDiv);
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Show user feedback message
  private showMessage(message: string, isError: boolean = false) {
    this.pdfExportMessage = message;
    this.showPdfMessage = true;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.showPdfMessage = false;
      this.pdfExportMessage = '';
    }, 5000);
  }

  // Get estimated file size for each quality level (static)
  getLowQualityFileSize(): string {
    return '~200-500 KB';
  }

  getMediumQualityFileSize(): string {
    return '~500 KB - 1 MB';
  }

  getHighQualityFileSize(): string {
    return '~2-4 MB';
  }

  // Get estimated file size for selected quality (for display in success message)
  getEstimatedFileSize(): string {
    const quality = this.pdfQualitySettings[this.selectedPdfQuality];
    const baseSize =
      quality.dimensions.width *
      quality.dimensions.height *
      quality.scale *
      quality.scale;

    if (this.selectedPdfQuality === 'high') {
      return '~2-4 MB';
    } else if (this.selectedPdfQuality === 'medium') {
      return '~500 KB - 1 MB';
    } else {
      return '~200-500 KB';
    }
  }

  // Get quality description
  getQualityDescription(): string {
    switch (this.selectedPdfQuality) {
      case 'high':
        return 'High quality, larger file size';
      case 'medium':
        return 'Balanced quality and file size (recommended)';
      case 'low':
        return 'Smaller file size, reduced quality';
      default:
        return '';
    }
  }

  // Handle quality change to update UI
  onQualityChange() {
    // Force change detection to update the estimated file size display
    this.ngZone.run(() => {
      // This will trigger template updates
    });
  }

  getFloorLabel(path: string): string {
    if (!path) return '';
    const outlet = this.filters.outlet;
    const baseWithExt = this.basename(path);
    const base = baseWithExt.replace(/\.(svg)$/i, '');

    // 1) explicit overrides per outlet (TTDI template)
    const override = outlet && this.floorLabelOverrides[outlet]?.[baseWithExt];
    if (override) return override; // e.g., "Level 1", "Level 3A"

    // 2) generic parse: TTDI-Level1 / TTDI_Level_3A / Level3A / L3A
    const m = base.match(/(?:^|[_\-\s])(?:level|lvl|l)[_\-\s]?(\d+[A-Za-z]?)/i);
    if (m) return `Level ${m[1].toUpperCase()}`;

    // 3) fallback: any numberish token → Level X
    const token = base.match(/(\d+[A-Za-z]?)/);
    if (token) return `Level ${token[1].toUpperCase()}`;

    // 4) final fallback: humanize filename
    return base.replace(/[_\-]/g, ' ').trim();
  }
}