import { Component, OnInit, AfterViewInit, ElementRef,ViewChildren,QueryList, ViewChild, NgZone } from '@angular/core';
import { Room } from '../../core/models/room.model';
import { RoomService } from '../../core/services/room.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';


type FilterKey = 'outlet' | 'status' | 'pax' | 'suite';

interface FilterConfig {
  key: FilterKey;
  label: string;
  options: string[];
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  // New properties for multiple suite selection
  selectedSuites: string[] = [];
  showSuiteDropdown: boolean = false;
  suiteSearchTerm: string = '';

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

  /** Does this SVG document contain any of the selected suites (for the chosen outlet)? */
private docHasSelectedSuites(doc: Document): boolean {
  if (!this.selectedSuites?.length) return true; // nothing selected → include
  const wanted = new Set(this.selectedSuites);
  return this.rooms.some(r =>
    r.outlet === this.filters.outlet &&
    wanted.has(r.name) &&
    !!this.findRoomElementInDoc(doc, r)
  );
}


  // PDF export loading states
  isExportingFloorplan = false;

  // User feedback for PDF export
  pdfExportMessage = '';
  showPdfMessage = false;
  
  // PDF quality settings - medium quality only
  pdfQualitySettings = {
    medium: { 
      scale: 3, 
      quality: 0.95, 
      dimensions: { width: 1200, height: 900 }, 
      deviceOptimized: true,
      description: 'High quality optimized for all devices'
    }
  };
  
  selectedPdfQuality: 'medium' = 'medium';

  Occupied = 0;
  Available = 0;

  safeSvgUrl!: SafeResourceUrl;

  // 👉 for collapse toggle
  rightPanel: boolean = false;
  @ViewChildren('svgObject') svgObjects!: QueryList<ElementRef<HTMLObjectElement>>;
  @ViewChild('panelContainer', { static: false }) panelContainer!: ElementRef<HTMLDivElement>;
  private processedSvgObjects = new WeakSet<HTMLObjectElement>();
  private safeUrlCache = new Map<string, SafeResourceUrl>();
  private roomIdIndex: Map<string, Room> = new Map();
  private objectToOriginalViewBox = new WeakMap<HTMLObjectElement, string>();
  // Friendly labels for specific outlets/files
  private floorLabelOverrides: Record<string, Record<string, string>> = {
  TTDI: {
    'TTDI-Level1.svg': 'Level 1',
    'TTDI-Level3A.svg': 'Level 3A',
    'Sibelco Office - L1.svg' : 'Sibelco Office',
  },
  KLS :{
    'KLS- L20.svg': 'Level 20',
    'KLS-ByteDance.svg' : 'Level 21 ByteDance',
    'KLS-L21.svg' : 'Level 21',
    'KLS-L28.svg' : 'Level 28',
  },
  MUB: {
    'MUB-level9.svg' : 'Level 9',
    'MUB-level12.svg' : 'Level 12',
    'MUB-level17.svg' : 'Level 17',
  },
  UBP3A: {
    'UBP-L13A.svg' : 'Level 13A',
    'UBP-L13AAIRIT.svg' : 'Level 13A AIRIT'
  },
};

private basename(path: string): string {
  return (path || '').split(/[\\/]/).pop() || path;
}
  constructor(
    private roomService: RoomService,
    public sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private http: HttpClient
  ) {}

  getSafeUrl(url: string): SafeResourceUrl {
    const cached = this.safeUrlCache.get(url);
    if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.safeUrlCache.set(url, safe);
    return safe;
  }

  // Check if room has a valid video
  hasVideo(room: Room): boolean {
    return !!(room.video || room.videoEmbed);
  }

  // Get video display type
  getVideoDisplayType(room: Room): 'embed' | 'link' | 'none' {
    if (room.videoEmbed) return 'embed';
    if (room.video) return 'link';
    return 'none';
  }

  // Get safe video URL for iframe embedding
  getSafeVideoUrl(videoUrl: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(videoUrl);
  }

  trackBySvgUrl = (_: number, url: string) => url;

  ngOnInit() {
    // Auto-optimize PDF quality for current device
    this.autoOptimizeQuality();
    
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
      const pageX = (event as MouseEvent).pageX ?? (event.clientX + window.scrollX);
      const pageY = (event as MouseEvent).pageY ?? (event.clientY + window.scrollY);
      console.log('[Floorplan] SVG click', { pageX, pageY });

      let target = event.target as Element | null;
      const root = svgDoc.documentElement as Element | null;
      let matched = false;
      while (target && target !== root) {
        const el = target as HTMLElement;
        let candidate = el.id || el.getAttribute?.('data-id') || el.getAttribute?.('data-room') || '';
        // Support <use href="#id"> patterns
        if (!candidate) {
          const href = el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
          if (href && href.startsWith('#')) candidate = href.slice(1);
        }
        if (candidate) {
          const normalized = this.normalizeId(candidate);
          console.log('[Floorplan] candidate', { candidate, normalized, tag: el.tagName });
          const room = this.roomIdIndex.get(normalized);
          if (room) {
            console.log('[Floorplan] matched room', { id: room.id, name: room.name });
            // Sync selection to filters so metrics reflect the picked room
            this.filters.suite = room.name;
            this.buildOptions();
            this.applyFilters()
            this.openPopupFromRoom(room);
            matched = true;
            return;
          }
        }
        target = (target.parentNode as Element | null);
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
      svgDoc.addEventListener('click', (ev: Event) => this.ngZone.run(() => handleClick(ev as MouseEvent)));
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
        el.addEventListener('click', (ev: MouseEvent) => this.ngZone.run(() => {
          ev.preventDefault();
          ev.stopPropagation();
          console.log('[Floorplan] direct room click', { id: room.id, name: room.name });
          this.openPopupFromRoom(room);
        }));
        (el as any)[roomMarker] = true;
      }
    });
  }

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
      if (key === 'outlet') {
      this.updateSelectedOutletSvgs();
      this.updateDisplayedSvgs();
      }
      this.buildOptions();
      this.applyFilters();
      if (key === 'suite') {
        // Zoom to the selected suite when explicitly chosen
        if (this.filters.suite === 'Select Suite') {
          this.closePopup();
        } else {
          const outletNow = this.filters.outlet;
          const candidates = this.rooms.filter((r) => r.name === this.filters.suite);
          const room = candidates.find((r) => outletNow === 'Select Outlet' || r.outlet === outletNow) || candidates[0];
          if (room) {
            console.log('[Floorplan] zoom due to suite selection', { id: room.id, name: room.name });
            setTimeout(() => this.openPopupFromRoom(room), 60);
          }
        }
      } else if (key === 'status' || key === 'pax' || key === 'outlet') {
        // Only auto-zoom if filtering yields exactly one room
        if (this.filteredRooms.length === 1) {
          const onlyRoom = this.filteredRooms[0];
          console.log('[Floorplan] zoom due to filters yielding one room', { id: onlyRoom.id, name: onlyRoom.name, key, value: this.filters[key] });
          this.filters.suite = onlyRoom.name; // sync suite for consistency
          setTimeout(() => this.openPopupFromRoom(onlyRoom), 60);
        } else if (this.filters.suite !== 'Select Suite') {
          // If suite remains selected after other filters, keep zooming to it
          const target = this.rooms.find(r => r.name === this.filters.suite);
          if (target) {
          }
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
      this.displayedSvgs = this.selectedOutletSvgs.filter(p => p === this.selectedFloorSvg);
    }
  }

  applyFilters() {
    this.filteredRooms = this.rooms.filter(
      (r) =>
        (this.filters.outlet === 'Select Outlet' || r.outlet === this.filters.outlet) &&
        (this.filters.status === 'Select Status' || r.status === this.filters.status) &&
        (this.filters.pax === 'Select Pax' ||
          r.capacity.toString() === this.filters.pax) &&
        (this.filters.suite === 'Select Suite' || this.selectedSuites.length === 0 || this.selectedSuites.includes(r.name))
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

  updateSvgColors(svgDoc?: Document) {
    const applyColors = (doc: Document) => {
    this.rooms.forEach((room) => {
        const el = doc.getElementById(room.id);
      if (el) {
          if (this.filteredRooms.includes(room)) {
            // Selected → colored
            el.setAttribute('fill', room.status === 'Occupied' ? '#ef4444' : '#22c55e');
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
      const objectEls = document.querySelectorAll<HTMLObjectElement>('object[type="image/svg+xml"]');
      objectEls.forEach((objectEl) => {
        const doc = objectEl.contentDocument;
        if (doc) applyColors(doc);
      });
    }
  }
  

  private normalizeId(value: string | undefined | null): string {
    if (!value) return '';
    return value.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
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

  private getSvgViewBox(rootSvg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
    const vb = rootSvg.getAttribute('viewBox');
    if (!vb) return null;
    const [x, y, w, h] = vb.split(/\s+/).map(Number);
    if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
    return { x, y, w, h };
  }

  // Convert a DOM client rect to SVG viewBox units
  private clientRectToSvgBBox(objectEl: HTMLObjectElement, rootSvg: SVGSVGElement, rect: DOMRect): { x: number; y: number; width: number; height: number } | null {
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

  private openPopupFromRoom(room: Room) {
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
        const bbox = el.getBBox();
        const objectRect = objectEl.getBoundingClientRect();
        const scaleX = objectRect.width / viewBox.w;
        const scaleY = objectRect.height / viewBox.h;
        const centerX = (bbox.x + bbox.width / 2 - viewBox.x) * scaleX;
        const centerY = (bbox.y + bbox.height / 2 - viewBox.y) * scaleY;
        let pageX = objectRect.left + centerX + 16;
        let pageY = objectRect.top + centerY + 16;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const popupWidth = 260;
        const popupHeight = 200;
        if (pageX + popupWidth > vw) pageX = vw - popupWidth - 8;
        if (pageY + popupHeight > vh) pageY = vh - popupHeight - 8;
        this.selectedRoom = room;
        this.showPopup = true;
        const containerRect = this.panelContainer?.nativeElement?.getBoundingClientRect?.();
        if (containerRect) {
          this.popupX = pageX - containerRect.left;
          this.popupY = pageY - containerRect.top;
        } else {
          this.popupX = pageX;
          this.popupY = pageY;
        }
        console.log('[Floorplan] popup positioned', { OutletID:room.outlet,ID:room.id, room: room.name, x: this.popupX, y: this.popupY });
        positioned = true;
      });
    }
    if (!positioned) {
      this.selectedRoom = room;
      this.showPopup = true;
      this.popupX = Math.max(16, window.innerWidth / 2 - 130);
      this.popupY = Math.max(16, window.innerHeight / 2 - 100);
      console.log('[Floorplan] popup fallback center', { room: room.name, x: this.popupX, y: this.popupY });
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
    const first = this.svgObjects?.first?.nativeElement as HTMLObjectElement | undefined;
    const doc = first?.contentDocument as Document | null;
    const rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;
    if (!doc || !rootSvg) return;

    // Clone SVG
    const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;

    // Ensure the download uses the original full viewBox, not the current zoomed one
    const originalViewBox = first ? this.objectToOriginalViewBox.get(first) : null;
    if (originalViewBox) {
      svgClone.setAttribute('viewBox', originalViewBox);
    }

    // If popup has selected room, embed details into the cloned SVG
    if (this.selectedRoom) {
      const el = this.findRoomElementInDoc(doc, this.selectedRoom);
      if (el && (el as any).getBBox) {
        const bbox = (el as any).getBBox();
        const overlayGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
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
          const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
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
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
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
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
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
      const pngBlob: Blob | null = await new Promise((res) => canvas.toBlob(res as any, 'image/png'));
      if (pngBlob) this.downloadBlob('floorplan-with-details.png', pngBlob);
      return;
    }
  }
  openPopup(event: MouseEvent, room: Room) {
    this.selectedRoom = room;
    this.showPopup = true;

    // Position relative to page mouse coordinates (like vanilla example)
    const pageX = (event as MouseEvent).pageX ?? (event.clientX + window.scrollX);
    const pageY = (event as MouseEvent).pageY ?? (event.clientY + window.scrollY);
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
    // Reset all filter selections to default values
    this.filters = {
      outlet: 'Select Outlet',
      status: 'Select Status',
      pax: 'Select Pax',
      suite: 'Select Suite',
      svg: 'all',
    };
    
    // Reset suite search term and multiple selection
    this.suiteSearchTerm = '';
    this.selectedSuites = [];
    this.showSuiteDropdown = false;
    
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
        creator: 'Private Suite Dashboard'
      });
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const objects = this.svgObjects?.toArray?.() ?? [];
      let wroteAnyPage = false;

      for (let idx = 0; idx < objects.length; idx++) {
        const objectRef = objects[idx];
        const objectEl = objectRef.nativeElement as HTMLObjectElement;

        // Skip floors that don't contain selected suites
        const doc = objectEl.contentDocument as Document | null;
        if (this.selectedSuites.length && (!doc || !this.docHasSelectedSuites(doc))) continue;

        // Load SVG (from <object> or via HTTP fallback for Safari)
        let rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) {
          const url = this.displayedSvgs[idx];
          rootSvg = url ? await this.fetchSvgElement(url) : null;
          if (!rootSvg) continue;
        }

        // New page handling
        if (wroteAnyPage) pdf.addPage('landscape');
        wroteAnyPage = true;

        // --- header (keep yours; shortened here) ---
        pdf.setFontSize(20); 
        pdf.setTextColor(255,102,0);
        pdf.text('Private Suite Dashboard - Floorplan', 20, 20);
        pdf.setFontSize(12); 
        pdf.setTextColor(0,0,0);
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
        // Suites (print count + names; wraps nicely)
        const left = 20; 
        const usableWidth = pageWidth - 40;
        if (this.selectedSuites?.length) {
          const text = `Suites (${this.selectedSuites.length}): ${this.selectedSuites.join(', ')}`;
          const lines = pdf.splitTextToSize(text, usableWidth);
          lines.forEach((line: string) => { 
            pdf.text(line, left, yPos); 
            yPos += 6; 
          });
        } else if (this.filters.suite !== 'Select Suite') {
          pdf.text(`Suite: ${this.filters.suite}`, left, yPos); 
          yPos += 8; 
        }

        // --- image/vector area ---
        const originalViewBox = this.objectToOriginalViewBox.get(objectEl);
        const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;
        if (originalViewBox) svgClone.setAttribute('viewBox', originalViewBox);

        // Compute target rect
        const margin = 5;
        const imgY = Math.max(yPos + 4, 24);
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - imgY - margin;

        // Try vector export first (best on all devices)
        const vb = svgClone.getAttribute('viewBox') || '0 0 1000 1000';
        const [, , vwStr, vhStr] = vb.split(/\s+/);
        const aspect = (Number(vwStr) || 1000) / (Number(vhStr) || 1000);
        let imgW = maxW, imgH = imgW / aspect;
        if (imgH > maxH) { 
          imgH = maxH; 
          imgW = imgH * aspect; 
        }
        const imgX = (pageWidth - imgW) / 2;

        const drewVector = await this.tryAddSvgVector(pdf, svgClone, imgX, imgY, imgW, imgH);
        if (drewVector) continue; // vector success → next page

        // Raster fallback (uses reduced dimensions on mobile/tablet)
        try {
          const dims = this.getDeviceRenderDims();
          // temporarily override your quality settings for this pass
          this.pdfQualitySettings.medium = {
            scale: dims.scale, 
            quality: dims.quality,
            dimensions: { width: dims.width, height: dims.height }, 
            deviceOptimized: true, 
            description: ''
          } as any;

          let canvas: HTMLCanvasElement;
          try {
            canvas = await this.svgToCanvasDirect(svgClone);  // draw via <img src=blob>
          } catch {
            canvas = await this.svgToCanvas(svgClone);        // html2canvas fallback
          }

          const imgData = canvas.toDataURL('image/png');      // PNG works best on iOS
          pdf.addImage(imgData, 'PNG', imgX, imgY, imgW, imgH);  // avoid compression arg for Safari
        } catch (e) {
          pdf.setFontSize(14); 
          pdf.setTextColor(0,0,0);
          pdf.text('Floorplan SVG (could not render image)', 20, 20);
        }
      }

      if (!wroteAnyPage) {
        this.showMessage('No floors matched the selected suites. Try selecting "All floors" and pick suites again.', true);
        this.isExportingFloorplan = false;
        return;
      }

      // ✅ iOS-friendly save
      const fileName = `floorplan-${this.filters.outlet !== 'Select Outlet' ? this.filters.outlet : 'all'}-${new Date().toISOString().split('T')[0]}.pdf`;
      if (this.isIOS()) {
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank'); // iOS: opens Share/Save dialog
      } else {
        pdf.save(fileName);
      }
      
      // Show success message with device-specific info
      const estimatedSize = this.getEstimatedFileSize();
      const currentDeviceType = this.detectDeviceType();
      let deviceInfo = '';
      
      if (currentDeviceType === 'ipad' || currentDeviceType === 'tablet') {
        deviceInfo = ' (Optimized for tablet/iPad viewing)';
      } else if (currentDeviceType === 'mobile') {
        deviceInfo = ' (Optimized for mobile viewing)';
      }
      
      this.showMessage(`Floorplan PDF exported successfully! 🎉 (Estimated size: ${estimatedSize})${deviceInfo}`);
      
    } catch (error) {
      console.error('Error exporting floorplan as PDF:', error);
      this.showMessage('Failed to export floorplan PDF. Please try again.', true);
    } finally {
      this.isExportingFloorplan = false;
    }
  }

  // Helper method to add room table to PDF
  private addRoomTableToPdf(pdf: jsPDF, startY: number) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const tableWidth = pageWidth - (margin * 2);
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
        `Deposit: RM ${room.deposit}`
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

  // Helper method to convert SVG to canvas with device-optimized quality
  private async svgToCanvas(svgElement: SVGSVGElement): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        const dims = this.getDeviceRenderDims();
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        tempDiv.style.width = `${dims.width}px`;
        tempDiv.style.height = `${dims.height}px`;
        tempDiv.style.backgroundColor = '#ffffff';
        tempDiv.style.overflow = 'hidden';

        const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
        svgClone.style.width = '100%';
        svgClone.style.height = '100%';
        svgClone.style.display = 'block';
        if (!svgClone.getAttribute('width') || !svgClone.getAttribute('height')) {
          svgClone.setAttribute('width', String(dims.width));
          svgClone.setAttribute('height', String(dims.height));
        }

        tempDiv.appendChild(svgClone);
        document.body.appendChild(tempDiv);

        html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: dims.scale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: dims.width,
          height: dims.height,
          removeContainer: true,
          foreignObjectRendering: false,
          imageTimeout: 30000
        }).then(canvas => {
          document.body.removeChild(tempDiv);
          resolve(canvas);
        }).catch(err => {
          document.body.removeChild(tempDiv);
          reject(err);
        });
      } catch (error) { 
        reject(error); 
      }
    });
  }

  // Alternative method: Direct SVG to canvas conversion for better shape preservation
  private async svgToCanvasDirect(svgElement: SVGSVGElement): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        const quality = this.pdfQualitySettings[this.selectedPdfQuality];
        
        // Create canvas with proper dimensions
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        const width = quality.dimensions.width;
        const height = quality.dimensions.height;
        canvas.width = width;
        canvas.height = height;
        
        // Set white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        
        // Convert SVG to data URL
        const svgString = new XMLSerializer().serializeToString(svgElement);
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        
        // Create image from SVG
        const img = new Image();
        img.onload = () => {
          // Draw the SVG image to canvas
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(canvas);
        };
        
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to load SVG as image'));
        };
        
        img.src = url;
        
      } catch (error) {
        reject(error);
      }
    });
  }

  // Fallback method for SVG to canvas conversion with minimal settings for iPad compatibility
  private async svgToCanvasFallback(svgElement: SVGSVGElement): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        // Use minimal dimensions for better compatibility
        const width = 800;
        const height = 600;
        
        // Create a simple temporary container
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        tempDiv.style.width = `${width}px`;
        tempDiv.style.height = `${height}px`;
        tempDiv.style.backgroundColor = '#ffffff';
        tempDiv.style.overflow = 'hidden';
        
        // Simple SVG clone
        const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
        svgClone.style.width = '100%';
        svgClone.style.height = '100%';
        svgClone.style.display = 'block';
        
        tempDiv.appendChild(svgClone);
        document.body.appendChild(tempDiv);
        
        // Minimal html2canvas options for maximum compatibility
        html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: 1, // Use scale 1 for compatibility
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: width,
          height: height,
          removeContainer: true,
          foreignObjectRendering: false,
          imageTimeout: 60000, // Very long timeout for iPads
        }).then(canvas => {
          document.body.removeChild(tempDiv);
          resolve(canvas);
        }).catch(error => {
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
  
  // Get estimated file size for medium quality
  getEstimatedFileSize(): string {
    return '~1-2 MB';
  }
  
  // Get quality description
  getQualityDescription(): string {
    return 'High quality optimized for all devices';
  }
  


  // Detect device type and suggest optimal quality setting
  detectDeviceType(): string {
    const userAgent = navigator.userAgent.toLowerCase();
    const isIPad = /ipad/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isTablet = /android(?!.*mobile)|tablet|ipad/.test(userAgent) || isIPad;
    const isMobile = /mobile|android|iphone|ipod/.test(userAgent);
    const isHighDPI = window.devicePixelRatio > 1;
    const isRetina = window.devicePixelRatio >= 2;
    
    // Specific iPad detection
    if (isIPad) {
      return 'ipad';
    } else if (isTablet || (navigator.maxTouchPoints > 1 && window.innerWidth > 768)) {
      return 'tablet';
    } else if (isMobile) {
      return 'mobile';
    } else if (isRetina) {
      return 'retina-laptop';
    } else if (isHighDPI) {
      return 'high-dpi-laptop';
    } else {
      return 'standard-laptop';
    }
  }

    // Auto-optimize quality for current device
  autoOptimizeQuality() {
    // Always use medium quality
    this.selectedPdfQuality = 'medium';
  }


  // Methods for multiple suite selection
  toggleSuiteSelection(suite: string) {
    const index = this.selectedSuites.indexOf(suite);
    if (index > -1) {
      this.selectedSuites.splice(index, 1);
    } else {
      this.selectedSuites.push(suite);
    }
    this.updateSuiteFilter();
  }

  isSuiteSelected(suite: string): boolean {
    return this.selectedSuites.includes(suite);
  }

  updateSuiteFilter() {
    if (this.selectedSuites.length === 0) {
      this.filters.suite = 'Select Suite';
    } else if (this.selectedSuites.length === 1) {
      this.filters.suite = this.selectedSuites[0];
    } else {
      this.filters.suite = `${this.selectedSuites.length} suites selected`;
    }
    this.applyFilters();
  }

  resetSuiteSelection() {
    this.selectedSuites = [];
    this.suiteSearchTerm = '';
    this.filters.suite = 'Select Suite';
    this.showSuiteDropdown = false;
    this.applyFilters();
  }

  onSuiteSearchChange() {
    this.buildOptions();
  }

  toggleSuiteDropdown() {
    this.showSuiteDropdown = !this.showSuiteDropdown;
  }

  getFilteredSuiteOptions(): string[] {
    if (!this.suiteSearchTerm.trim()) {
      return this.suiteOptions;
    }
    return this.suiteOptions.filter(suite =>
      suite.toLowerCase().includes(this.suiteSearchTerm.toLowerCase())
    );
  }

  // Close dropdown when clicking outside
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.suite-dropdown-container')) {
      this.showSuiteDropdown = false;
    }
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



  // Get current device type for display
  getCurrentDeviceType(): string {
    const deviceType = this.detectDeviceType();
    
    switch (deviceType) {
      case 'ipad':
        return 'iPad';
      case 'tablet':
        return 'Tablet';
      case 'mobile':
        return 'Mobile Device';
      case 'retina-laptop':
        return 'Retina Display Laptop';
      case 'high-dpi-laptop':
        return 'High-DPI Laptop';
      default:
        return 'Standard Laptop/Desktop';
    }
  }

  // Detect iOS/iPadOS
  private isIOS(): boolean {
    const ua = navigator.userAgent.toLowerCase();
    return /ipad|iphone|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // Try vector-first export using svg2pdf
  private async tryAddSvgVector(
    pdf: jsPDF,
    svg: SVGSVGElement,
    x: number,
    y: number,
    w: number,
    h: number
  ): Promise<boolean> {
    try {
      const mod = await import('svg2pdf.js');
      const svg2pdf = (mod as any).svg2pdf ?? (mod as any).default ?? (mod as any);
      svg2pdf(svg, pdf, { x, y, width: w, height: h, preserveAspectRatio: 'xMidYMid meet' });
      return true;
    } catch {
      return false;
    }
  }

  // Fallback when <object>.contentDocument is null (Safari): fetch SVG text
  private async fetchSvgElement(url: string): Promise<SVGSVGElement | null> {
    try {
      const text = await firstValueFrom(this.http.get(url, { responseType: 'text' }));
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return doc.documentElement as unknown as SVGSVGElement;
    } catch {
      return null;
    }
  }

  // Smaller render targets on mobile/tablet to avoid OOM
  private getDeviceRenderDims() {
    const t = this.detectDeviceType();
    if (t === 'mobile')   return { width: 900,  height: 675, scale: 2, quality: 0.92 };
    if (t === 'ipad' || t === 'tablet')
                          return { width: 1100, height: 825, scale: 2, quality: 0.93 };
    return {               width: 1200, height: 900, scale: 3, quality: 0.95 };
  }

}