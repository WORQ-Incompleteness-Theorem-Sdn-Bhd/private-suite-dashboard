import { Component, OnInit, AfterViewInit, ElementRef,ViewChildren,QueryList, ViewChild, NgZone } from '@angular/core';
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
  showDownloadMenu = false;
  popupX = 0;
  popupY = 0;

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

  constructor(
    private roomService: RoomService,
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
          // If a suite is already selected when SVG loads, auto-zoom to it
          if (this.filters.suite && this.filters.suite !== 'Select Suite') {
            this.performAutoZoom();
          }
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
            this.openPopupFromRoom(room);
            matched = true;
            return;
          }
        }
        target = (target.parentNode as Element | null);
      }
      if (!matched) {
        console.log('[Floorplan] click had no matching room element');
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
      if (key === 'outlet') {
      this.updateSelectedOutletSvgs();
      }
      this.buildOptions();
      this.applyFilters();
      if (key === 'suite') {
        // When clearing suite selection, reset zoom and close popup
        if (this.filters.suite === 'Select Suite') {
          this.resetZoom();
          this.closePopup();
        } else {
          // Zoom to the selected suite's room after filters apply
          setTimeout(() => {
            this.performAutoZoom();
            const outletNow = this.filters.outlet;
            const candidates = this.rooms.filter((r) => r.name === this.filters.suite);
            const room = candidates.find((r) => outletNow === 'Select Outlet' || r.outlet === outletNow) || candidates[0];
            if (room) {
              console.log('[Floorplan] suite filter selected', { id: room.id, name: room.name });
              this.openPopupFromRoom(room);
            }
          }, 80);
        }
      }
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

  private zoomSvgToBBox(objectEl: HTMLObjectElement, bbox: DOMRect | SVGRect, padding = 20) {
    const svgDoc = objectEl.contentDocument as Document | null;
    if (!svgDoc) return;
    const rootSvg = svgDoc.querySelector('svg') as SVGSVGElement | null;
    if (!rootSvg) return;
    const x = Math.max(0, (bbox as any).x - padding);
    const y = Math.max(0, (bbox as any).y - padding);
    const w = (bbox as any).width + padding * 2;
    const h = (bbox as any).height + padding * 2;
    rootSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  private getSvgViewBox(rootSvg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
    const vb = rootSvg.getAttribute('viewBox');
    if (!vb) return null;
    const [x, y, w, h] = vb.split(/\s+/).map(Number);
    if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
    return { x, y, w, h };
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
  performAutoZoom() {
    if (!this.svgObjects || !this.filters.suite || this.filters.suite === 'Select Suite') return;
    const outlet = this.filters.outlet;
    const candidateRooms = this.rooms.filter((r) => r.name === this.filters.suite);
    const targetRoom = candidateRooms.find((r) => outlet === 'Select Outlet' || r.outlet === outlet) || candidateRooms[0];
    if (!targetRoom) return;
    this.svgObjects.forEach((ref) => {
      const objectEl = ref.nativeElement as HTMLObjectElement;
      const doc = objectEl.contentDocument as Document | null;
      if (!doc) return;
      // Reset to original viewBox before each new zoom to pan correctly
      const rootSvg = doc.querySelector('svg') as SVGSVGElement | null;
      const original = this.objectToOriginalViewBox.get(objectEl);
      if (rootSvg && original) rootSvg.setAttribute('viewBox', original);
      const el = this.findRoomElementInDoc(doc, targetRoom);
      if (!el) return;
      const bbox = (el as any).getBBox ? (el as any).getBBox() : el.getBoundingClientRect();
      this.zoomSvgToBBox(objectEl, bbox, 30);
    });
    // After zoom, show popup near the selected room
    setTimeout(() => this.openPopupFromRoom(targetRoom), 60);
  }

  resetZoom() {
    if (!this.svgObjects) return;
    this.svgObjects.forEach((ref) => {
      const objectEl = ref.nativeElement as HTMLObjectElement;
      const svgDoc = objectEl.contentDocument as Document | null;
      const rootSvg = svgDoc?.querySelector('svg') as SVGSVGElement | null;
      if (!rootSvg) return;
      const original = this.objectToOriginalViewBox.get(objectEl);
      if (original) rootSvg.setAttribute('viewBox', original);
    });
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
    
    // Reset suite search term
    this.suiteSearchTerm = '';
    
    // Reset zoom to original view
    this.resetZoom();
    
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

}