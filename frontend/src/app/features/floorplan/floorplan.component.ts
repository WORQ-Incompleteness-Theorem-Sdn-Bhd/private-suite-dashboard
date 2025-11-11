import {
  Component,
  OnInit,
  AfterViewInit,
  ElementRef,
  ViewChildren,
  QueryList,
  ViewChild,
  NgZone,
  Inject,
} from '@angular/core';
import { Room } from '../../core/models/room.model';
import { RoomService, ResourceParams } from '../../core/services/room.service';
import { OfficeService } from '../../core/services/office.service';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FloorService } from '../../core/services/floor.service';
import { Floor } from '../../core/models/floor.model';
import { ToastService } from '../../shared/services/toast.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../shared/services/auth.service';
import { Observable, of, forkJoin, combineLatest, timer } from 'rxjs';
import { catchError, finalize, map, switchMap, tap, filter, first, takeUntil, timeout } from 'rxjs/operators';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ToastComponent } from '../../shared/components/toast.component';
import { YoutubeModalComponent } from '../../shared/components/youtube-modal.component';
import { HttpClient } from '@angular/common/http';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { environment } from '../../environments/environment.dev';


type FilterKey = 'outlet' | 'status' | 'pax';

interface FilterConfig {
  key: FilterKey;
  label: string;
  options: string[];
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ToastComponent, RouterLink,RouterLinkActive, YoutubeModalComponent],
  selector: 'app-floorplan',
  templateUrl:'./floorplan.component.html',
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
  floors: Floor[] = [];
  floorIdToFloorMap: Map<string, Floor> = new Map();
  
  sidebarCollapsed = false;
  mobileOpen = false; 

  // Pagination for floorplans
  currentFloorplanIndex = 0;
  get totalFloorplans(): number {
    return this.displayedSvgs.length;
  }
  get hasNextFloorplan(): boolean {
    const result = this.currentFloorplanIndex < this.totalFloorplans - 1;
    return result;
  }
  get hasPreviousFloorplan(): boolean {
    const result = this.currentFloorplanIndex > 0;
    return result;
  }
  get currentFloorplan(): string | null {
   /* console.log('🔍 currentFloorplan getter called:', { 
      displayedSvgs: this.displayedSvgs, 
      displayedSvgsLength: this.displayedSvgs?.length,
      currentFloorplanIndex: this.currentFloorplanIndex,
      selectedOutletSvgs: this.selectedOutletSvgs,
      selectedOutletSvgsLength: this.selectedOutletSvgs?.length
    });*/ //used this after svg can load
    
    if (!this.displayedSvgs || this.displayedSvgs.length === 0) {;
      return null;
    }
    const current = this.displayedSvgs[this.currentFloorplanIndex] || null;
    return current;
  }

  // Loading states
  isLoadingOffices = false;
  isLoadingSvgs = false;
  
  // Independent loading flags
  dataLoading = false;
  svgLoading = false;
  svgFailed = false;
  noSvgsFromFirebase = false;
  floorplansLoaded = false;
  uiMessage: string = '';
  
  // Computed loading state
  get isLoading(): boolean {
    return this.dataLoading || this.svgLoading;
  }

  // Computed property to determine when to show no floorplan message
  get shouldShowNoFloorplanMessage(): boolean {
    return !this.isLoading && this.floorplansLoaded && this.totalFloorplans === 0 && !this.noSvgsFromFirebase;
  }

  // Computed property to determine when to show Firebase no SVG message
  get shouldShowFirebaseNoSvgMessage(): boolean {
    return !this.isLoading && this.floorplansLoaded && this.noSvgsFromFirebase; //this one will show the message when svg doesn't exist in Firebase
  }

  Occupied: number = 0;
  Available: number = 0;

  // Pax-based color palette //legend
  paxPalette = ['rgb(61, 168, 218)', 'rgb(20, 50, 218)', 'rgb(215, 66, 218)', 'rgb(173, 4, 63)', 'rgb(240, 70, 40)', 'rgb(255, 166, 0)'] as const;
  paxBuckets = [
    { max: 4, label: '2-4' }, // ->rgb(61, 168, 218)
    { max: 6, label: '5–6' }, // ->rgb(20, 50, 218)
    { max: 8, label: '7–8' }, // ->rgb(215, 66, 218)
    { max: 12, label: '9–12' }, // ->rgb(173, 4, 63)
    { max: 20, label: '13–20' }, // ->rgb(240, 70, 40)
    { max: Infinity, label: '21+' }, // ->rgb(255, 166, 0)
  ];

  // Multi-select suite functionality
  selectedSuites: string[] = [];
  suiteSearchTerm: string = '';

  isArray(value: unknown): boolean {
    return Array.isArray(value);
  }

  getOptionValue(opt: any): string {
    return typeof opt === 'string' ? opt : opt.value;
  }

  getOptionLabel(opt: any): string {
    return typeof opt === 'string' ? opt : opt.label;
  }

  filtersConfig: FilterConfig[] = [
    { key: 'outlet', label: 'Outlet', options: [] as any[] },
    { key: 'status', label: 'Status', options: [] as string[] },
    { key: 'pax', label: 'Pax', options: [] as string[] },
  ];

  filters = {
    outlet: 'Select Outlet',
    status: 'Select Status',
    pax: 'Select Pax',
    svg: 'all',
  };
  // Date filters
  selectedStartDate: string = ''; //Added date filters
  selectedEndDate: string = ''; //Added date filters
  availabilityByRoomId: Map<string, 'free' | 'occupied'> = new Map(); //Added date filters
  outletOptions: { label: string; value: string }[] = [];
  statusOptions: string[] = [];
  paxOptions: string[] = [];
  suiteOptions: string[] = [];
  leftPanelCollapsed = false;

  selectedRoom: any;
  showPopup = false;
  showDownloadMenu = false;
  popupX = 0;
  popupY = 0;

  // YouTube Modal
  showYoutubeModal = false;
  selectedVideoUrl: string | null = null;
  selectedRoomName: string = '';

  // PDF export loading states
  isExportingFloorplan = false;

  // User feedback for PDF export
  pdfExportMessage = '';
  showPdfMessage = false;

  // PDF quality settings - compact size for better fit
  private readonly pdfQuality = {
    scale: 1.5, // Reduced from 2 for more compact size
    quality: 0.85, // Slightly lower quality for smaller file size
    dimensions: { width: 1800, height: 1200 } // Smaller dimensions for compact layout
  };

  // Compact mode for PDF export
  private compactMode = true;

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
  private floorLabelOverrides: Record<string, Record<string, string>> = {};
 
  svgHtmlMap = new Map<string, SafeHtml>(); // Store SafeHtml for [innerHTML] binding
  @ViewChildren('svgHost') svgHosts!: QueryList<ElementRef<HTMLDivElement>>;

  private basename(path: string): string {
    return (path || '').split(/[\\/]/).pop() || path;
  }

  // Normalize URL key by removing query params for consistent lookup (public for template)
  normalizeUrlKey(url: string | null): string {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      // If URL parsing fails, just remove query string manually
      return url.split('?')[0].split('#')[0];
    }
  }
  constructor(
    private roomService: RoomService,
    private officeService: OfficeService,
    private floorService: FloorService,
    private toastService: ToastService,
    public sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private http: HttpClient,
    private router: Router,
    private auth: AuthService
  ) { }
  
  logout() {
    this.auth.logout();
  }
  getSafeUrl(url: string): SafeResourceUrl {
    console.log("getSafeUrl url", url)
    const cached = this.safeUrlCache.get(url);
    if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.safeUrlCache.set(url, safe);
    return safe;
  }
  /**
   * Toggle sidebar open/closed
   */
toggleSidebar() {
  // on mobile, toggle overlay; on desktop, toggle compact width
  if (window.innerWidth < 1024) {
    this.mobileOpen = !this.mobileOpen;
  } else {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}

closeMobile() { this.mobileOpen = false; }
openMobile() { this.mobileOpen = true; }
toggleCollapse() { this.sidebarCollapsed = !this.sidebarCollapsed; } // for a desktop collapse button 

onMainContentClick(event: MouseEvent) {
  // Only close if the sidebar is open and the click was outside it
  if (!this.sidebarCollapsed) {
    this.sidebarCollapsed = true;
  }
}

  trackBySvgUrl = (_: number, url: string) => url;


  ngOnInit() {
    // 1) Load outlets and floors first
    this.loadOffices();
    this.loadFloors();

    // 2) Setup keyboard navigation
    this.setupKeyboardNavigation();

    // 4) Subscribe to rooms changes
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
      this.updateSelectedOutletSvgs();// Gets Urls from firebase
      this.buildOptions();
      this.applyFilters();
    });
  }


  // Setup keyboard navigation for floorplan pagination <--- check this later
  private setupKeyboardNavigation() {
    document.addEventListener('keydown', (event) => {
      // Only handle navigation if floorplan is focused and not in input fields
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          this.previousFloorplan();
          break;
        case 'ArrowRight':
          event.preventDefault();
          this.nextFloorplan();
          break;
        case 'Home':
          event.preventDefault();
          this.goToFloorplan(0);
          break;
        case 'End':
          event.preventDefault();
          this.goToFloorplan(this.totalFloorplans - 1);
          break;
      }
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
        this.toastService.success('Outlets loaded successfully');
        this.buildOptions();
      }
    });
  }

  // Load floors from backend
  loadFloors() {
    this.floorService.getFloors().pipe(
      catchError((error) => {
        console.error('Error loading floors:', error);
        this.toastService.error('Failed to load floors. Please try again.');
        return of([]);
      })
    ).subscribe((floors) => {
      this.floors = floors;
      console.log("floors", floors)
      // Build floor ID to floor mapping for quick lookup
      this.floorIdToFloorMap.clear();
      floors.forEach(floor => {
        this.floorIdToFloorMap.set(floor.floor_id, floor);
      });
      console.log('Floors loaded:', floors);
    });
  }

  // When user selects an outlet
  onOutletChange(outletDisplayName: string) {
    // Close any open popup when switching outlets
    this.closePopup();
    if (!outletDisplayName || outletDisplayName === 'Select Outlet') {
      this.rooms = [];
      this.filteredRooms = [];
      this.selectedOutletSvgs = [];
      this.displayedSvgs = [];
      this.svgHtmlMap.clear(); // Clear existing SVGs
      this.dataLoading = false;
      this.svgLoading = false;
      this.svgFailed = false;
      this.floorplansLoaded = true; // Mark as loaded even when no outlet selected
      this.buildOptions();
      this.applyFilters();
      return;
    }

    // Get the office ID from the display name and store normalized ID in filters
    const officeId = this.getOfficeIdFromOutletName(outletDisplayName);
    console.log("officeId", officeId)
    if (!officeId) {
      console.error('Office ID not found for outlet:', outletDisplayName);
      this.toastService.error('Invalid outlet selected');
      return;
    }

    // Normalize selection: filters.outlet should always store the office ID
    this.filters.outlet = officeId;

    // Reset loading states
    this.dataLoading = true;
    this.svgLoading = true;
    this.svgFailed = false;
    this.noSvgsFromFirebase = false;
    this.floorplansLoaded = false;

    // 3) Fetch resources for this outlet using office.id
    this.loadResources({ officeId });

    // If date already chosen, refresh availability for the outlet
    if (this.selectedStartDate) {
      this.fetchAvailabilityForCurrentSelection();
    }
  }

  // Fetch resources for selected outlet with 15s timeout
  loadResources(params: ResourceParams) {
    this.roomService.getResources(params).pipe(
      catchError((error) => {
        console.error('Error loading resources:', error);
        this.toastService.error('Failed to load resources. Please try again.');
        this.dataLoading = false;
        return of(null);
      })
    ).subscribe((response) => {
      this.dataLoading = false; // Data loading complete
      if (response) {
        this.toastService.success('Resources loaded successfully');
        // Update selected outlet SVGs first, then build filters
        this.updateSelectedOutletSvgs();
        this.buildFiltersFromBackend();
        // SVG color updates will be handled by updateSelectedOutletSvgs -> updateDisplayedSvgs
      }
    });

  }

  // Build filters from backend data
  buildFiltersFromBackend() {
    this.buildOptions();
    this.applyFilters();
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
          this.svgLoading = false; // SVG loaded successfully
          this.applyFloorplanState();
        };
        const onError = () => {
          console.error('SVG object failed to load');
          this.svgFailed = true;
          this.svgLoading = false;
          this.applyFloorplanState();
        };
        if (!this.processedSvgObjects.has(objectEl)) {
          objectEl.addEventListener('load', onLoad);
          objectEl.addEventListener('error', onError);
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

  // Apply floorplan state after loading is complete
  private applyFloorplanState() {
    if (!this.isLoading) {
      // Apply colors to SVG paths
      this.updateSvgColors();
      // Re-attach click listeners for popup functionality
      this.attachAndColorAllInline();
    }
  }

  // Floorplan navigation methods
  nextFloorplan() {
    if (this.hasNextFloorplan) {
      console.log('➡️ NEXT FLOORPLAN: Moving from', this.currentFloorplanIndex, 'to', this.currentFloorplanIndex + 1);
      this.currentFloorplanIndex++;
      console.log('➡️ New floorplan URL:', this.currentFloorplan);
      // Close any open popup when changing floorplans
      this.closePopup();
      // Apply filters to ensure resources data is maintained
      this.applyFilters();
      // Apply floorplan state for SVG updates
      this.applyFloorplanState();
      
      // Force reattachment of event listeners after a short delay
      setTimeout(() => {
        this.attachAndColorAllInline();
      }, 100);
    }
  }

  previousFloorplan() {
    if (this.hasPreviousFloorplan) {
      this.currentFloorplanIndex--;
      // Close any open popup when changing floorplans
      this.closePopup();
      // Apply filters to ensure resources data is maintained
      this.applyFilters();
      // Apply floorplan state for SVG updates
      this.applyFloorplanState();
      
      // Force reattachment of event listeners after a short delay
      setTimeout(() => {
        this.attachAndColorAllInline();
      }, 100);
    }
  }

  goToFloorplan(index: number) {
    if (index >= 0 && index < this.totalFloorplans) {
      this.currentFloorplanIndex = index;
      // Close any open popup when changing floorplans
      this.closePopup();
      // Apply filters to ensure resources data is maintained
      this.applyFilters();
      // Apply floorplan state for SVG updates
      this.applyFloorplanState();
      
      // Force reattachment of event listeners after a short delay
      setTimeout(() => {
        console.log('🔄 Force reattaching event listeners after navigation');
        this.attachAndColorAllInline();
      }, 100);
    }
  }
  
  //key connector between your resources data and the SVG floorplans.
  private updateSelectedOutletSvgs() {
    const outletId = this.filters.outlet;
    // Reset baseline state
    this.selectedOutletSvgs = [];
    this.displayedSvgs = [];
    this.selectedFloorSvg = 'all';
    this.floorOptions = [];
    this.noSvgsFromFirebase = false;
    this.floorplansLoaded = false;
    this.uiMessage = '' as any;

    // Find the selected office by ID
    const selectedOffice = this.officeService.getOffices().find(office => office.id === outletId);
    if (!selectedOffice) {
      // console.error('Office not found for ID:', outletId);
      // this.uiMessage = 'Selected outlet not found.';
      // this.floorplansLoaded = true;
      return;
    } 
   // Get rooms for the selected outlet
   const outletRooms = this.rooms.filter((r) => r.outlet === selectedOffice.displayName);


    // Extract unique floor IDs from rooms
    const floorIds = new Set<string>();
    outletRooms.forEach(room => {
      if (room.floor_id) {
        floorIds.add(room.floor_id);
      }
    });

    // Build floor options from backend floor data
    this.floorOptions = Array.from(floorIds)
      .map(floorId => {
        const floor = this.floorIdToFloorMap.get(floorId);
        if (floor) {
          const floorLabel = this.floorService.getFloorDisplayLabel(floorId, this.floors);
          return `${floorLabel}|${floorId}`; // Format: "Sibelco Office|floor_id" for display and ID
        } else {
          console.warn('⚠️ Floor ID not found in floorIdToFloorMap:', floorId);
          // Still try to create option with floorId as label
          return `${floorId}|${floorId}`;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // Sort by floor label (Sibelco Office will come first alphabetically)
        const aLabel = a!.split('|')[0];
        const bLabel = b!.split('|')[0];

        // Special sorting: Sibelco Office first, then numeric floors
        if (aLabel === 'Sibelco Office') return -1;
        if (bLabel === 'Sibelco Office') return 1;

        // For numeric floors, sort by number
        const aNum = parseInt(aLabel) || 999;
        const bNum = parseInt(bLabel) || 999;
        return aNum - bNum;
      }) as string[];
    
    console.log('📋 Built floor options:', { count: this.floorOptions.length, options: this.floorOptions });

    // Get all SVG files for this outlet from floor service
    console.log('🔍 Starting Firebase lookup for outlet:', { outletId, officeName: selectedOffice?.displayName });
    this.floorService.getAllSvgFilesForOutlet(outletId).pipe(
      tap(svgs => console.log('📋 getAllSvgFilesForOutlet returned:', { count: svgs?.length || 0, urls: svgs })),
      catchError(error => {
        console.error('❌ Error loading outlet SVGs:', { error, outletId, message: error?.message, status: error?.status });
        this.toastService.error('Failed to load floorplan SVGs');
        return of([]);
      })
    ).subscribe((svgs: string[]) => {
      console.log('📊 SVG loading result:', { svgs, length: svgs?.length, outletId });
      
      // Case 1: Got outlet-level SVGs → show all by default
      if (svgs && svgs.length > 0) {
        this.selectedOutletSvgs = svgs;
        this.noSvgsFromFirebase = false;
        this.floorplansLoaded = true;
        console.log('✅ Outlet SVGs loaded (all floorplans):', this.selectedOutletSvgs);
        this.updateDisplayedSvgs();
        return;
      }

      // Case 2: Fallback to office-level cloud SVGs (no floor_id dependency)
      // Skip floor aggregation - just try office-level SVGs directly
      this.tryOfficeLevelFallback(selectedOffice);
    });

    // default to all floors when outlet changes
    this.selectedFloorSvg = 'all';
  }

  private tryOfficeLevelFallback(selectedOffice: any) {
    const officeSvgs = selectedOffice?.svg;
    const normalizeArray = (value: string | string[] | undefined): string[] => 
      Array.isArray(value) ? value : (value ? [value] : []);
    const isCloudUrl = (u: string) => 
      typeof u === 'string' && (u.startsWith('https://') || u.startsWith('http://'));

    const cloudSvgs = normalizeArray(officeSvgs).filter(isCloudUrl);
    
    if (cloudSvgs.length > 0) {
      this.selectedOutletSvgs = cloudSvgs;
      this.noSvgsFromFirebase = false;
      this.floorplansLoaded = true;
      console.log('✅ Office-level cloud SVGs:', cloudSvgs);
      this.updateDisplayedSvgs();
    } else {
      this.selectedOutletSvgs = [];
      this.noSvgsFromFirebase = true;
      this.floorplansLoaded = true;
      console.log('⚠️ No SVGs found via any method');
      this.updateDisplayedSvgs();
    }
  }


  // Helper method to detect if SVG is from Firebase/cloud or unknown.
  // HTTP(S)/Firebase/cloud URL will be treated as 'firebase'.
  private detectSvgSource(url: string): 'firebase' | 'unknown' {
    if (!url) return 'unknown';
    const u = String(url).toLowerCase().trim();

    // Backend API URLs (from floorplan service) should be treated as Firebase
    if (u.includes(environment.apiBaseUrl.toLowerCase()) || u.includes('/api/floorplans')) {
      return 'firebase';
    }

    // Firebase / cloud storage URLs (explicit checks)
    if (
      u.includes('firebasestorage.googleapis.com') ||
      u.includes('storage.googleapis.com') ||
      u.includes('firebase') ||
      (u.startsWith('https://') && u.includes('googleapis.com'))
    ) {
      return 'firebase';
    }

    // Any full external HTTP(S) URL is treated as cloud (firebase-like)
    if (u.startsWith('http://') || u.startsWith('https://')) {
      return 'firebase';
    }

    // gs:// URLs are Firebase Storage
    if (u.startsWith('gs://')) {
      return 'firebase';
    }

    // Anything else (relative paths, assets/, etc.) → unknown
    return 'unknown';
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

    // Helper to compute effective status based on selected date range
    const getEffectiveStatus = (room: Room): 'Available' | 'Occupied' => {
      if (this.selectedStartDate) {
        const avail = this.availabilityByRoomId.get(room.id);
        if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') {
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            return 'Occupied';
          } else {
            // Room is available - use date-based availability
            return avail === 'free' ? 'Available' : 'Occupied';
          }
        }
      }
      return this.toStatusUnion(room.status);
    };

    let filteredForOutlet = this.rooms;
    let filteredForStatus = filteredForOutlet.filter(
      (r) => {
        if (this.filters.outlet === 'Select Outlet') return true;
        // Find the office by ID and compare with room's outlet name
        const selectedOffice = this.officeService.getOffices().find(office => office.id === this.filters.outlet);
        return selectedOffice && r.outlet === selectedOffice.displayName;
      }
    );
    console.log('After outlet filter:', filteredForStatus);

    let filteredForPax = filteredForStatus.filter(
      (r) => {
        const effectiveStatus = getEffectiveStatus(r);
        return this.filters.status === 'Select Status' || effectiveStatus === this.filters.status;
      }
    );
    console.log('After status filter:', filteredForPax);

    let filteredForSuite = filteredForPax.filter(
      (r) =>
        this.filters.pax === 'Select Pax' ||
        r.capacity.toString() === this.filters.pax
    );
    console.log('After pax filter:', filteredForSuite);

    // Outlet options: from office service - label = displayName, value = id
    this.outletOptions = this.officeService.getOffices().map(office => ({
      label: office.displayName,
      value: office.id
    }));
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
            const outletMatch = (() => {
              if (this.filters.outlet === 'Select Outlet') return true;
              const selectedOffice = this.officeService.getOffices().find(office => office.id === this.filters.outlet);
              return selectedOffice && r.outlet === selectedOffice.displayName;
            })();
            const effectiveStatus = getEffectiveStatus(r);
            const statusMatch =
              this.filters.status === 'Select Status' ||
              effectiveStatus === this.filters.status;
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
      this.outletOptions as any[];
    this.filtersConfig.find((f) => f.key === 'status')!.options =
      this.statusOptions;
    this.filtersConfig.find((f) => f.key === 'pax')!.options = this.paxOptions;
  }

  updateFilter(type: string, value: string) {
    const key = type as keyof typeof this.filters;
    this.filters[key] = value;
    if (key === 'outlet'){
      console.log('🧭 Outlet filter change:', { rawValue: value });
      this.onOutletChange(value);
      this.updateSelectedOutletSvgs();
      // Rendering will be triggered after URLs are fetched in subscriptions
      return;
    } else {
      // Close any open popup when changing other filters
      this.closePopup();
      // For other filters, show loading briefly and apply client-side filtering
      this.svgLoading = true;
      this.buildOptions();
      this.applyFilters();
      // Update SVG colors after filter changes
      setTimeout(() => {
        this.updateSvgColors();
        this.svgLoading = false; // Hide loading when filtering is complete
        this.applyFloorplanState();
      }, 500);
    }
        // Use string comparison to avoid TypeScript narrowing issues on the key union
    const keyStr = String(key);
    if (['status', 'pax', 'outlet'].includes(keyStr)) {
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

  // Date change handlers
  onDateChange(which: 'start' | 'end', value: string) {
    // Close any open popup when changing dates
    this.closePopup();
    
    if (which === 'start') {
      // If user clears the start date, reset both dates and availability
      if (!value) {
        this.selectedStartDate = '';
        this.selectedEndDate = '';
        this.availabilityByRoomId.clear();
        this.applyFilters();
        setTimeout(() => this.updateSvgColors(), 50);
        return;
      }
      this.selectedStartDate = value;
      // If end date is before new start date, clear it
      if (this.selectedEndDate && this.selectedEndDate < value) {
        this.selectedEndDate = '';
      }
    }
    if (which === 'end') {
      // If user clears the end date, treat it as single-day selection
      if (!value) {
        this.selectedEndDate = '';
        if (this.selectedStartDate) {
          this.fetchAvailabilityForCurrentSelection();
        } else {
          // No start date either → clear availability and reset
          this.availabilityByRoomId.clear();
          this.applyFilters();
          setTimeout(() => this.updateSvgColors(), 50);
        }
        return;
      }
      this.selectedEndDate = value; // here where getavailability is called
    }
    
    // Validate date range (max 366 days inclusive; leap-year friendly)
    if (this.selectedStartDate && this.selectedEndDate) {
      const startDate = new Date(this.selectedStartDate);
      const endDate = new Date(this.selectedEndDate);
      const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
      
      if (dayCount > 366) {
        this.toastService.error('Date range too large. Please select a range of 366 days or less.');
        this.selectedEndDate = '';
        return;
      }
    }
    
    // If only start picked, treat as single day
    if (this.selectedStartDate) {
      this.fetchAvailabilityForCurrentSelection();
    }
  }
//New function to fetch availability for current selection
  private fetchAvailabilityForCurrentSelection() {
    const outlet = this.filters.outlet;
    const officeId = this.getOfficeIdFromOutletName(outlet);
    if (!officeId || !this.selectedStartDate) return;
        
    const start = this.selectedStartDate;
    const end = this.selectedEndDate || this.selectedStartDate; // Use start date as end if no end date selected
    
    // Build day count to decide whether to chunk requests (handles backends with shorter limits)
    const startDate = new Date(start);
    const endDate = new Date(end);
    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

    const MAX_WINDOW = 31; // compatible with stricter backends
    if (totalDays > MAX_WINDOW) {
      // Split into <=31-day windows and combine results client-side
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
          // Only add rooms that have explicit availability data from API
          // If a room is not in the API response, it won't be in the map (fallback to original status)
          const combined = new Map<string, 'free' | 'occupied'>();
          responses.forEach(resp => {
            const rows = resp?.resources || resp?.rows || resp?.data || [];
            rows.forEach((r: any) => {
              const days = r.days || [];
              // Only process rooms that have days data
              if (days.length === 0) {
                // No days data = don't add to map (will fall back to original status)
                return;
              }
              
              const allFree = days.every((d: any) => {
                const status = (d.status || '').toLowerCase();
                return status === 'free';
              });
              
              // Also check if the room itself is unavailable - if so, treat as occupied
              const room = this.rooms.find(room => room.id === r.resource_id);
              if (room && this.isRoomUnavailable(room)) {
                // Room is unavailable - mark as occupied
                combined.set(r.resource_id, 'occupied');
              } else if (allFree) {
                combined.set(r.resource_id, 'free');
              } else {
                // Has days data but not all free = occupied
                combined.set(r.resource_id, 'occupied');
              }
            });
          });
          
          console.log('📅 Availability data loaded (multi-window):', { 
            roomsWithData: combined.size, 
            totalRooms: this.rooms.length,
            freeRooms: Array.from(combined.values()).filter(v => v === 'free').length
          });
          this.availabilityByRoomId = combined;
          this.applyFilters();
          setTimeout(() => this.updateSvgColors(), 50);
        },
      });
      return;
    }

    // Simple single-call case
    this.roomService.getAvailability({ start, end, officeId }).subscribe({
      next: (resp) => {
        // resp.resources expected: [{ resource_id, days: [{date, status}, ...] }, ...]
        // Only add rooms that have explicit availability data from API
        // If a room is not in the API response, it won't be in the map (fallback to original status)
        const map = new Map<string, 'free' | 'occupied'>(); 
        const rows = resp?.resources || resp?.rows || resp?.data || [];
        
        rows.forEach((r: any) => {
          const days = r.days || [];
          // Only process rooms that have days data
          if (days.length === 0) {
            // No days data = don't add to map (will fall back to original status)
            return;
          }
          
          // For date range: room is available if ALL days in the range are free
          // For single date: room is available if that specific date is free
          const isAvailable = days.every((d: any) => {
            const status = (d.status || '').toLowerCase();
            return status === 'free';
          });
          
          // Also check if the room itself is unavailable - if so, treat as occupied
          const room = this.rooms.find(room => room.id === r.resource_id);
          if (room && this.isRoomUnavailable(room)) {
            // Room is unavailable - mark as occupied
            map.set(r.resource_id, 'occupied');
          } else if (isAvailable) {
            map.set(r.resource_id, 'free');
          } else {
            // Has days data but not all free = occupied
            map.set(r.resource_id, 'occupied');
          }
        });
        
        console.log('📅 Availability data loaded:', { 
          roomsWithData: map.size, 
          totalRooms: this.rooms.length,
          freeRooms: Array.from(map.values()).filter(v => v === 'free').length
        });
        this.availabilityByRoomId = map;
        this.applyFilters();
        setTimeout(() => this.updateSvgColors(), 50);
      },
      error: (e) => {
        console.error('Failed to fetch availability', e);
        // Check if it's a range too large error
        if (e.error && e.error.error && e.error.error.includes('Range too large')) {
          this.toastService.error('Date range too large. Please select a range of 366 days or less.');
        } else {
          this.toastService.error('Failed to fetch availability data. Please try again.');
        }
        // Clear availability data on error
        this.availabilityByRoomId.clear();
        this.applyFilters();
        setTimeout(() => this.updateSvgColors(), 50);
      }
    });
  }

  // Floor selection handler (kept for compatibility, but now always shows all SVGs)
  onFloorChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const raw = select.value; // e.g. "9|63f5decf5de9f10007e115a6" or "all"
    // store as-is for reference (display still shows all SVGs)
    this.selectedFloorSvg = raw;
    
    // Close any open popup when changing floors
    this.closePopup();
    
    // Always display all outlet SVGs regardless of floor selection
    // Floor selector is now informational only - all floorplans are shown
    this.displayedSvgs = this.selectedOutletSvgs || [];
    this.currentFloorplanIndex = 0;
    
    if (this.displayedSvgs.length > 0) {
      this.svgLoading = true;
      this.svgFailed = false;
      this.loadInlineSvgs(this.displayedSvgs);
    } else {
      this.svgLoading = false;
      this.svgFailed = true;
    }
  }

  private updateDisplayedSvgs() {
    const outletId = this.filters.outlet;
    const currentSource = this.selectedOutletSvgs.length > 0 ? this.detectSvgSource(this.selectedOutletSvgs[0]) : this.detectSvgSource('');
    console.log('🔄 updateDisplayedSvgs called:', { 
      outletId, 
      selectedFloorSvg: this.selectedFloorSvg, 
      selectedOutletSvgs: this.selectedOutletSvgs,
      selectedOutletSvgsCount: this.selectedOutletSvgs.length,
      floorplansLoaded: this.floorplansLoaded,
      source: currentSource.toUpperCase()
    });
    console.log('🧭 Rendering floorplans:', { count: this.selectedOutletSvgs.length, urls: this.selectedOutletSvgs });
    
    if (!outletId || outletId === 'Select Outlet') {
      this.displayedSvgs = [];
      this.currentFloorplanIndex = 0; // Reset pagination
      console.log('❌ No outlet selected, clearing displayedSvgs');
      return;
    }

    // Wait for floorplans to be loaded before displaying
    if (!this.floorplansLoaded) {
      console.log('⏳ Floorplans not loaded yet, waiting...');
      // Retry after a short delay
      setTimeout(() => {
        if (this.floorplansLoaded) {
          console.log('✅ Floorplans loaded, retrying updateDisplayedSvgs');
          this.updateDisplayedSvgs();
        } else {
          console.warn('⚠️ Floorplans still not loaded after wait, proceeding anyway');
          // Proceed anyway after timeout to avoid infinite waiting
          this.floorplansLoaded = true; // Mark as loaded to prevent infinite waiting
          this.updateDisplayedSvgs();
        }
      }, 300);
      return;
    }

    // Always display ALL outlet SVGs, regardless of floor selection
    // This ensures all floorplans for the outlet are shown without filtering by floor_id
    this.displayedSvgs = this.selectedOutletSvgs || [];
    this.currentFloorplanIndex = 0; // Reset pagination
    console.log('🖼️ Displaying all outlet SVGs:', { count: this.displayedSvgs.length, total: this.selectedOutletSvgs.length });
    
    if (this.displayedSvgs.length > 0) {
      console.log('📥 Loading inline SVGs for display:', this.displayedSvgs.length, 'SVGs');
      this.loadInlineSvgs(this.displayedSvgs);   // ✅ Load all SVGs
    } else {
      console.warn('⚠️ No SVGs to display, selectedOutletSvgs is empty');
      this.svgLoading = false;
      this.svgFailed = true;
      this.floorplansLoaded = true; // Ensure loaded state is set
    }
  }


  // onFloorChange(event: Event) {
  //   const select = event.target as HTMLSelectElement | null;
  //   const raw = select?.value ?? '';
  //   this.selectedFloorSvg = raw;
  //   console.log("onFloorChange selectedFloorSvg", this.selectedFloorSvg)
  //   console.log("onFloorChange raw", raw)
  //   this.updateDisplayedSvgs();
  //   if (!raw) return;

  // }

  // private updateDisplayedSvgs() {
  //   console.log("updateDisplayedSvgs", this.selectedFloorSvg)
  //   console.log("updateDisplayedSvgs", this.selectedFloorSvg)
  //   // "9|63f5decf5de9f10007e115a6" -> extract floorId
  //   const _hasPipe = this.selectedFloorSvg.includes('|');
  //   const hasPipe = _hasPipe ? true:false;
  //   console.log("hasPipe", hasPipe)
  //   // const floorId = hasPipe ? this.selectedFloorSvg.split('|')[1]?.trim() : '';
  //   const floorId = this.selectedFloorSvg.split('|')[1];
  //   const outletId = this.filters.outlet;
  //   console.log("floorId", floorId)
  //   console.log("outletId", outletId)
  //   console.log("selectedFloorSvg", this.selectedFloorSvg)

  //   if (hasPipe && floorId && outletId !== 'Select Outlet') {
  //     console.log("hello")
  //     this.floorService.getSvgFilesForFloor(outletId, floorId, this.floors).pipe(
  //       catchError(err => {
  //         console.error('Error loading floor SVGs:', err);
  //         this.toastService.error('Failed to load floor SVGs');
  //         return of<string[]>([]);
  //       })
  //     ).subscribe(floorSvgs => {
  //       this.displayedSvgs = floorSvgs.length ? floorSvgs : this.selectedOutletSvgs.slice();
  //     });
  //   } else if (!hasPipe) {
  //     console.log("hello 2")
  //     // Fallback old behavior (value is a direct SVG url)
  //     this.displayedSvgs = this.selectedOutletSvgs.filter(p => p === this.selectedFloorSvg);
  //   } else {
  //     console.log("hello 3")
  //     this.displayedSvgs = this.selectedOutletSvgs.slice();
  //   }
  //   if (!this.selectedOutletSvgs?.length) {
  //     this.displayedSvgs = [];
  //     return;
  //   }

  //   if (this.selectedFloorSvg === 'all') {
  //     this.displayedSvgs = this.selectedOutletSvgs.slice();
  //     return;
  //   }




  // }

  // // Floor selection handler
  // onFloorChange(event: Event) {
  //   console.log("onFloorChange event.target", event.target)
  //   const select: any = event.target as HTMLSelectElement | null;
  //   console.log("onFloorChange select", select)
  //   console.log("onFloorChange select.value", select.value)
  //   if (select) {
  //     this.selectedFloorSvg = select.value;
  //     this.updateDisplayedSvgs();
  //     // colors/handlers will reattach on next load event automatically
  //   }
  // }

  // private updateDisplayedSvgs() {
  //   console.log("updateDisplayedSvgs selectedOutletSvgs", this.selectedOutletSvgs)
  //   if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
  //     this.displayedSvgs = [];
  //     return;
  //   }
  //   if (this.selectedFloorSvg === 'all') {
  //     this.displayedSvgs = this.selectedOutletSvgs.slice();
  //   } else {
  //     // Check if selectedFloorSvg is in the new format (floorNumber|floorId)
  //     if (this.selectedFloorSvg.includes('|')) {
  //       const floorId = this.selectedFloorSvg.split('|')[1];
  //       const outletId = this.filters.outlet;
  //       console.log("floorId", floorId)
  //       console.log("outletId", outletId)
  //       if (outletId && outletId !== 'Select Outlet') {
  //         // Get SVG files for the specific floor
  //         this.floorService.getSvgFilesForFloor(outletId, floorId, this.floors).pipe(
  //           catchError(error => {
  //             console.error('Error loading floor SVGs:', error);
  //             this.toastService.error('Failed to load floor SVGs');
  //             return of([]);
  //           })
  //         ).subscribe(floorSvgs => {
  //           console.log("getSvgFilesForFloor : floorSvgs", floorSvgs)
  //           this.displayedSvgs = floorSvgs.length > 0 ? floorSvgs : this.selectedOutletSvgs.slice();
  //         });
  //       } else {
  //         this.displayedSvgs = this.selectedOutletSvgs.slice();
  //       }
  //     } else {
  //       // Fallback to old SVG-based filtering
  //       this.displayedSvgs = this.selectedOutletSvgs.filter(
  //         (p) => p === this.selectedFloorSvg
  //       );
  //     }
  //   }
  // }

  applyFilters() {
    // Helper to compute effective status based on selected date range
    const getEffectiveStatus = (room: Room): 'Available' | 'Occupied' => {
      if (this.selectedStartDate) {
        const avail = this.availabilityByRoomId.get(room.id);
        if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') { 
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            return 'Occupied';
          } else {
            // Room is available - use date-based availability
            return avail === 'free' ? 'Available' : 'Occupied';
          }
        }
      }
      return this.toStatusUnion(room.status);
    };

    this.filteredRooms = this.rooms
      .filter((r) => {
        const outletMatch = (() => {
          if (this.filters.outlet === 'Select Outlet') return true;
          const selectedOffice = this.officeService.getOffices().find(o => o.id === this.filters.outlet);
          return selectedOffice && r.outlet === selectedOffice.displayName;
        })();
        
        const effectiveStatus = getEffectiveStatus(r);
        const statusOk =
          this.filters.status === 'Select Status' || effectiveStatus === this.filters.status;
        
        const paxOk =
          this.filters.pax === 'Select Pax' || String(r.capacity) === this.filters.pax;
        
        const suiteOk = this.selectedSuites.length === 0 || this.selectedSuites.includes(r.name);
        
        return outletMatch && statusOk && paxOk && suiteOk;
      })
      .sort((a, b) => {
        if (this.filters.pax !== 'Select Pax') return a.capacity - b.capacity;
        if (this.selectedSuites.length > 0) return a.name.localeCompare(b.name, undefined, { numeric: true });
        return 0;
      });

    // Metrics reflect effective availability
    this.Occupied = this.filteredRooms.filter(
      (r) => getEffectiveStatus(r) === 'Occupied'
    ).length;
    this.Available = this.filteredRooms.filter(
      (r) => getEffectiveStatus(r) === 'Available'
    ).length;
    // Re-color after the view updates so <object> is loaded
    setTimeout(() => {
      // <object>-embedded SVGs
      this.updateSvgColors();

      // Inline SVGs
      if (this.svgHosts) {
        this.svgHosts.forEach(hostRef => {
          const rootSvg = hostRef.nativeElement.querySelector('svg') as SVGSVGElement | null;
          if (rootSvg) this.updateSvgColorsInline(rootSvg);
        });
      }
    }, 0);
  }


  updateSvgColors(svgDoc?: Document) {
    const applyColors = (doc: Document) => {
      this.rooms.forEach((room) => {
        const el = doc.getElementById(room.id);
        doc.querySelector(`[data-id="${room.id}"], [data-room="${room.id}"]`);
        if (el) {
          if (this.filteredRooms.includes(room)) {
          
            // Compute effective status based on selected-date availability if provided
            const avail = this.selectedStartDate ? this.availabilityByRoomId.get(room.id) : undefined;
            let effectiveStatus: 'Occupied' | 'Available';
            if (avail) {
              // When date is selected, check both availability AND original room status
              // If room status is reserved/unavailable/available_soon/occupied, keep it red
              const originalStatus = this.toStatusUnion(room.status);
              if (originalStatus === 'Occupied') {
                // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
                effectiveStatus = 'Occupied';
              } else {
                // Room is available - use date-based availability
                effectiveStatus = (avail === 'free') ? 'Available' : 'Occupied';
              }
            } else {
              effectiveStatus = this.toStatusUnion(room.status);
            }

            let color: string;
            if (effectiveStatus === 'Occupied') {  //change from room.status to effectiveStatus
              color = '#ef4444'; // Red for occupied
            } else if (this.filters.status === 'Available') {
              // Use pax-based palette for available rooms when filtering by Available (even with date range)
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
      document
        .querySelectorAll<HTMLObjectElement>('object[type="image/svg+xml"]')
        .forEach((objectEl) => {
          const doc = objectEl.contentDocument;
          if (doc) applyColors(doc);
        });
    }
  }

  private toStatusUnion(status: string): 'Available' | 'Occupied' { //this function
    // Group statuses: available vs occupied/reserved/available_soon/unavailable
    const availableStatuses = ['available'];
    const occupiedStatuses = ['occupied', 'reserved', 'available_soon', 'unavailable'];
    
    const normalizedStatus = status.toLowerCase();
    
    if (availableStatuses.includes(normalizedStatus)) {
      return 'Available';
    } else if (occupiedStatuses.includes(normalizedStatus)) {
      return 'Occupied';
    } else {
      // Default to occupied for any unknown status
      return 'Occupied';
    }
  }

  // Helper function to check if a room is unavailable based on original backend data
  private isRoomUnavailable(room: Room): boolean {
    // Check if the original status from backend is 'unavailable'
    return room.originalStatus?.toLowerCase() === 'unavailable';
  }

  // Helper function to format status display for popup
  getStatusDisplayText(room: Room, isDateSelected: boolean): string {
    const status = room.status.toLowerCase();
    
    if (isDateSelected) {
      // When date is selected, show status based on room's original status
      switch (status) {
        case 'reserved':
          return 'Reserved';
        case 'occupied':
          return 'Occupied';
        case 'unavailable':
          return 'Unavailable';
        case 'available_soon':
          // For available_soon, show the actual available date
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
          // For available rooms, check date-based availability
          const avail = this.availabilityByRoomId.get(room.id);
          return avail === 'free' ? 'Available' : 'Occupied';
        default:
          return 'Occupied';
      }
    } else {
      // When no date is selected, show original status
      switch (status) {
        case 'reserved':
          return 'Reserved';
        case 'occupied':
          return 'Occupied';
        case 'unavailable':
          return 'Unavailable';
        case 'available_soon':
          // For available_soon, show the actual available date
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

  // Get office ID from outlet display name
  getOfficeIdFromOutletName(outletName: string): string | undefined {
    const offices = this.officeService.getOffices();
    const normalized = (outletName || '').trim().toLowerCase();
    const byDisplay = offices.find(o => (o.displayName || '').trim().toLowerCase() === normalized);
    const byId = offices.find(o => (o.id || '').trim().toLowerCase() === normalized);
    const chosen = byDisplay ?? byId;
    console.log('🏢 Outlet normalization:', { input: outletName, id: chosen?.id, displayName: chosen?.displayName });
    return chosen?.id;
  }

  private normalizeId(value: string | undefined | null): string {
    if (!value) return '';
    return value
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private buildRoomIdIndex(): Map<string, Room> {
    console.log('🏗️ Building room ID index for', this.rooms.length, 'rooms');
    const index = new Map<string, Room>();
    this.rooms.forEach((room, roomIndex) => {
      const candidates = [
        room.id,
        room.name,
        room.name?.replace(/\s+/g, ''),
        room.name?.replace(/\s+/g, '-'),
        room.name?.replace(/\s+/g, '_'),
      ];
      //console.log(`Room ${roomIndex}:`, {
       // id: room.id,
       /* name: room.name,
        candidates: candidates
      });*/
      candidates.forEach((c) => {
        const key = this.normalizeId(c);
        if (key) {
          index.set(key, room);
        }
      });
    });
   // console.log('🏗️ Room ID index built with', index.size, 'entries');
    //console.log('🏗️ Index keys:', Array.from(index.keys()).slice(0, 10)); // Show first 10 keys */
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

  private openPopupFromRoom(room: Room, clickEvent?: MouseEvent) {
    console.log('🚀 openPopupFromRoom called with room:', {
      id: room.id,
      name: room.name,
      status: room.status,
      capacity: room.capacity,
      clickEvent: clickEvent ? 'present' : 'missing',
      currentShowPopup: this.showPopup,
      currentSelectedRoom: this.selectedRoom?.name
    });
    
    let positioned = false;
    // Try inline SVG hosts first
    if (this.svgHosts && this.svgHosts.length > 0) {
      this.svgHosts.forEach(hostRef => {
        if (positioned) return;
        const hostEl = hostRef.nativeElement as HTMLDivElement;
        const rootSvg = hostEl.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) return;

        const viewBoxAttr = rootSvg.getAttribute('viewBox');
        if (!viewBoxAttr) return;
        const [vbX, vbY, vbW, vbH] = viewBoxAttr.split(/\s+/).map(Number);
        if ([vbX, vbY, vbW, vbH].some(n => Number.isNaN(n))) return;

        const el = this.findRoomElementInline(rootSvg, room) as any;
        if (!el || !el.getBBox) return;

        const bbox = el.getBBox();
        const hostRect = hostEl.getBoundingClientRect();
        const scaleX = hostRect.width / vbW;
        const scaleY = hostRect.height / vbH;

        const roomRightX = bbox.x + bbox.width;
        const roomCenterY = bbox.y + bbox.height / 2;
        let screenX = hostRect.left + (roomRightX - vbX) * scaleX + 10;
        let screenY = hostRect.top + (roomCenterY - vbY) * scaleY;

        const containerEl = this.panelContainer?.nativeElement;
        const containerRect = containerEl?.getBoundingClientRect();
        let popupXInline = screenX;
        let popupYInline = screenY - 10;
        if (containerRect && containerEl) {
          popupXInline = screenX - containerRect.left + (containerEl.scrollLeft || 0);
          popupYInline = screenY - containerRect.top + (containerEl.scrollTop || 0) - 10;
        }

        // Clamp
        const popupWidthInline = 192;
        const popupHeightInline = 120;
        if (containerRect) {
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          if (popupXInline + popupWidthInline > containerWidth) popupXInline = containerWidth - popupWidthInline - 10;
          if (popupXInline < 0) popupXInline = 10;
          if (popupYInline < 0) popupYInline = 10;
          if (popupYInline + popupHeightInline > containerHeight) popupYInline = containerHeight - popupHeightInline - 10;
        }

        this.selectedRoom = room;
        this.showPopup = true;
        this.popupX = Math.max(0, popupXInline);
        this.popupY = Math.max(0, popupYInline);
        positioned = true;
      });
    }

    if (positioned) return;

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
    // Inline <svg> positioning (when SVGs are inlined into the DOM)
    if (!positioned && this.svgHosts) {
      this.svgHosts.forEach((hostRef) => {
        if (positioned) return;
        const host = hostRef.nativeElement as HTMLDivElement;
        const rootSvg = host.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) return;

        const vbAttr = rootSvg.getAttribute('viewBox');
        if (!vbAttr) return; // require viewBox for proper mapping
        const [vbX, vbY, vbW, vbH] = vbAttr.split(/\s+/).map(Number);
        if ([vbX, vbY, vbW, vbH].some((n) => Number.isNaN(n))) return;

        const el = this.findRoomElementInline(rootSvg, room) as any;
        if (!el || !el.getBBox) return;

        const bbox = el.getBBox();
        const svgRect = rootSvg.getBoundingClientRect();

        const scaleX = svgRect.width / vbW;
        const scaleY = svgRect.height / vbH;

        // Compute screen coordinates from SVG bbox center
        const roomCenterX = bbox.x + bbox.width / 2;
        const roomCenterY = bbox.y + bbox.height / 2;

        let popupX = svgRect.left + (roomCenterX - vbX) * scaleX + (bbox.width * scaleX) / 2 + 10;
        let popupY = svgRect.top + (roomCenterY - vbY) * scaleY - 10;

        // Convert to container-relative coordinates
        const containerRect = this.panelContainer?.nativeElement?.getBoundingClientRect();
        if (containerRect) {
          popupX -= containerRect.left;
          popupY -= containerRect.top;
        }

        // Clamp within container bounds
        const popupWidth = 192; // w-48
        const popupHeight = 120; // approx
        if (containerRect) {
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          if (popupX + popupWidth > containerWidth) popupX = containerWidth - popupWidth - 10;
          if (popupX < 0) popupX = 10;
          if (popupY < 0) popupY = 10;
          if (popupY + popupHeight > containerHeight) popupY = containerHeight - popupHeight - 10;
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
    
    console.log('🎯 Final popup state:', {
      showPopup: this.showPopup,
      selectedRoom: this.selectedRoom?.name,
      popupX: this.popupX,
      popupY: this.popupY,
      positioned: positioned
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

  async downloadFloorplanWithDetails(format: 'svg' | 'png' = 'svg') {  //allows the user to download the svg floorplan as svg or png
    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to download.');
      return;
    }
    const first = this.svgObjects?.first?.nativeElement as //this one is for finding the first svg object element
      | HTMLObjectElement
      | undefined;
    const doc = first?.contentDocument as Document | null;
    const rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;
    if (!doc || !rootSvg) return;

    // Clone SVG
    const svgClone = rootSvg.cloneNode(true) as SVGSVGElement; // deep clone ( snapshot of the current state)

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

  // Handle floorplan container clicks
  onFloorplanContainerClick(event: MouseEvent) {
    // Close popup when clicking on container background
    this.closePopup();
  }
//Delete this later
  onSvgHostClick(event: MouseEvent) {
    console.log('🎨 SVG HOST CLICK:', {
      target: event.target,
      targetTag: (event.target as Element)?.tagName,
      targetId: (event.target as Element)?.id,
      targetClass: (event.target as Element)?.className,
      coordinates: {
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        offsetX: event.offsetX,
        offsetY: event.offsetY
      },
      isSVG: (event.target as Element)?.tagName === 'svg',
      isSVGChild: (event.target as Element)?.closest('svg') !== null,
      svgContent: (event.target as Element)?.innerHTML?.substring(0, 100) + '...'
    });
  }

  // YouTube Modal Methods
  openYoutubeModal(room: Room) {
    if (room.video) {
      this.selectedVideoUrl = room.video;
      this.selectedRoomName = room.name;
      this.showYoutubeModal = true;
      this.closePopup(); // Close the room popup when opening video modal
    }
  }

  closeYoutubeModal() {
    this.showYoutubeModal = false;
    this.selectedVideoUrl = null;
    this.selectedRoomName = '';
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

    // availability selected suites
    this.Occupied = 0; 
    this.Available = 0; 

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

      // Process inline SVGs (your actual SVG display method)
      const svgHosts = this.svgHosts?.toArray?.() ?? [];
      console.log('🔍 PDF Export: Found', svgHosts.length, 'inline SVG hosts');
      
      if (svgHosts.length === 0) {
        console.warn('❌ No SVG hosts found for PDF export');
        this.showMessage('No floorplan data available for export', true);
        return;
      }

      // Only render pages that match selected suites (when any are selected)
      let firstPageRendered = false;
      for (let idx = 0; idx < svgHosts.length; idx++) {
        const hostRef = svgHosts[idx];
        const hostEl = hostRef.nativeElement as HTMLDivElement;
        const rootSvg = hostEl.querySelector('svg') as SVGSVGElement | null;

        console.log(`🔍 Processing SVG ${idx + 1}:`, {
          hasHostEl: !!hostEl,
          hasRootSvg: !!rootSvg,
          svgWidth: rootSvg?.getAttribute('width'),
          svgHeight: rootSvg?.getAttribute('height'),
          viewBox: rootSvg?.getAttribute('viewBox')
        });

        if (!rootSvg) {
          console.warn(`❌ No SVG found in host ${idx + 1}`);
          continue;
        }

        // Page inclusion logic: if user selected suites, only include pages
        // that actually contain at least one of those suites
        const shouldIncludeThisPage = (() => {
          if (!rootSvg) return false;
          if ((this.selectedSuites?.length ?? 0) === 0) return true;
          return this.selectedSuites.some((suiteName) => {
            const room = this.rooms.find(r => r.name === suiteName);
            if (!room) return false;
            const el = this.findRoomElementInline(rootSvg, room);
            return !!el;
          });
        })();

        if (!shouldIncludeThisPage) {
          // Skip this floorplan page entirely if none of the selected suites are present
          continue;
        }

        if (firstPageRendered) {
          pdf.addPage('landscape');
        } else {
          firstPageRendered = true;
        }

        // Compact page title and filters
        pdf.setFontSize(16); // Reduced from 20
        pdf.setTextColor(255, 102, 0);
        pdf.text('Private Suite Dashboard - Floorplan', 20, 15); // Moved up from 20
        pdf.setFontSize(10); // Reduced from 12
        pdf.setTextColor(0, 0, 0);
        let yPos = 25; // Reduced from 35
        if (this.filters.outlet !== 'Select Outlet') {
          const selectedOffice = this.officeService.getOffices().find(office => office.id === this.filters.outlet);
          const outletDisplayName = selectedOffice ? selectedOffice.displayName : this.filters.outlet;
          pdf.text(`Outlet: ${outletDisplayName}`, 20, yPos);  
          yPos += 6; // Reduced from 8
        }
        const floorLabel = this.getFloorLabel(this.displayedSvgs[idx] || '');
        if (floorLabel) {
          pdf.text(`Floor: ${floorLabel}`, 20, yPos);
          yPos += 6; // Reduced from 8
        }
        if (this.filters.pax !== 'Select Pax') {
          pdf.text(`Pax: ${this.filters.pax}`, 20, yPos);
          yPos += 6; // Reduced from 8
        }
        // Build suites list from available rooms if none explicitly selected
        const effectiveStatus = (room: Room): 'Available' | 'Occupied' => {
          if (this.selectedStartDate) {
            const avail = this.availabilityByRoomId.get(room.id);
            if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') {
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            return 'Occupied';
          } else {
            // Room is available - use date-based availability
            return avail === 'free' ? 'Available' : 'Occupied';
          }
        }
          }
          return this.toStatusUnion(room.status);
        };
        // Suites list for header: if user selected suites, show only those
        // that exist on this page; otherwise show available suites on this page
        const suitesToShow = (() => {
          const pageRoomHasName = (name: string) => {
            const room = this.rooms.find(r => r.name === name);
            return room ? !!this.findRoomElementInline(rootSvg!, room) : false;
          };

          if (this.selectedSuites.length > 0) {
            return this.selectedSuites.filter(pageRoomHasName);
          }

          const availableOnThisPage = this.filteredRooms
            .filter(r => effectiveStatus(r) === 'Available' && pageRoomHasName(r.name))
            .map(r => r.name);
          return Array.from(new Set(availableOnThisPage))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        })();

        if (suitesToShow.length > 0) {
          const suitesLabel = 'Suites: ';
          const suitesText = suitesToShow.join(', ');
          // Use smaller font and wrap when too many suites are listed
          const manySuites = suitesToShow.length > 6; // Reduced threshold for compact layout
          const originalFont = 10; // Reduced from 12
          const smallFont = 7; // Reduced from 8
          const fontToUse = manySuites ? smallFont : originalFont;

          pdf.setFontSize(fontToUse);
          const infoBlockWidth = pageWidth - 120; // leave space for right-side legend
          const wrapped = pdf.splitTextToSize(suitesText, infoBlockWidth - suitesLabel.length * (fontToUse / 2));
          // Print label on first line, then continuation lines indented
          if (wrapped.length > 0) {
            pdf.text(`${suitesLabel}${wrapped[0]}`, 20, yPos);
            let yy = yPos;
            for (let i = 1; i < wrapped.length; i++) {
              yy += manySuites ? 4 : 5; // Even tighter line height for compact layout
              pdf.text(`        ${wrapped[i]}`, 20, yy);
            }
            yPos = yy + (manySuites ? 4 : 5);
          } else {
            pdf.text(`${suitesLabel}`, 20, yPos);
            yPos += manySuites ? 5 : 6;
          }
          // Restore default font for subsequent lines
          pdf.setFontSize(12);
        }
        
        // Add date range information
        if (this.selectedStartDate) {
          // Set font size to match other details (10px)
          pdf.setFontSize(10);
          if (this.selectedEndDate && this.selectedEndDate !== this.selectedStartDate) {
            pdf.text(`Date Range: ${this.selectedStartDate} to ${this.selectedEndDate}`, 20, yPos);
          } else {
            pdf.text(`Date: ${this.selectedStartDate}`, 20, yPos);
          }
          yPos += 6; // Reduced from 8
        }

        // Add compact Pax legend (always compact, based on currently available rooms)
        const buildPdfPaxLegend = (): Array<{label: string, color: string}> => {
          const legend: Array<{label: string, color: string}> = [];
          // Effective status helper
          const effStatus = (room: Room): 'Available' | 'Occupied' => {
            if (this.selectedStartDate) {
              const avail = this.availabilityByRoomId.get(room.id);
              if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') {
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            return 'Occupied';
          } else {
            // Room is available - use date-based availability
            return avail === 'free' ? 'Available' : 'Occupied';
          }
        }
            }
            return this.toStatusUnion(room.status);
          };
          const usedPax = new Set<number>();
          this.filteredRooms.forEach(r => {
            if (effStatus(r) === 'Available') usedPax.add(r.capacity);
          });
          if (usedPax.size === 0) return legend;
          this.paxBuckets.forEach((bucket, i) => {
            const has = Array.from(usedPax).some(p => {
              if (i === 0) return p >= 2 && p <= bucket.max;
              const prev = this.paxBuckets[i - 1];
              return p > prev.max && p <= bucket.max;
            });
            if (has) legend.push({ label: bucket.label, color: this.paxPalette[i] });
          });
          return legend;
        };

        const pdfLegend = buildPdfPaxLegend();
        if (pdfLegend.length > 0) {
          // Render legend on the right side beside the header info
          const rightMargin = 15;
          const legendAreaWidth = 75; // More compact block
          const legendStartX = pageWidth - rightMargin - legendAreaWidth;
          let legendY = 25; // Align with compact header

          pdf.setFontSize(9);
          pdf.setTextColor(0, 0, 0);
          pdf.text('Pax (Available):', legendStartX, legendY);
          legendY += 5;

          const legendItemWidth = 32; // Reduced for more compact layout
          const legendItemHeight = 4; // Reduced height
          let currentX = legendStartX;
          let currentY = legendY;
          
          pdfLegend.forEach((item) => {
            if (currentX + legendItemWidth > legendStartX + legendAreaWidth) {
              currentX = legendStartX;
              currentY += legendItemHeight + 1;
            }
            const rgb = this.hexToRgb(item.color);
            if (rgb) {
              pdf.setFillColor(rgb.r, rgb.g, rgb.b);
              pdf.rect(currentX, currentY - 2, 3, 3, 'F');
            }
            pdf.setTextColor(0,0,0);
            pdf.text(item.label, currentX + 5, currentY);
            currentX += legendItemWidth;
          });
          // keep yPos unchanged to avoid pushing down the image; legend lives on the right

          yPos = currentY + 8;
        }

        // Clone the SVG for processing
        const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;
        
        // Ensure proper viewBox
        if (!svgClone.getAttribute('viewBox')) {
          const width = svgClone.getAttribute('width') || '1920';
          const height = svgClone.getAttribute('height') || '1018';
          svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }

        // Add YouTube links to rooms that have videos
        this.addYouTubeLinksToSvg(svgClone);

        try {
          console.log(`🎨 Converting SVG ${idx + 1} to canvas...`);
          let canvas = await this.svgToCanvas(svgClone);
          console.log(`✅ Canvas created:`, {
            width: canvas.width,
            height: canvas.height,
            hasContent: canvas.width > 0 && canvas.height > 0
          });
          
          canvas = this.downscaleCanvasIfNeeded(canvas);

          // Compact layout settings
          const margin = 12; // slightly larger margin for breathing room
          const imgY = Math.max(yPos + 12, 36); // push image a bit further down from the header/date
          const maxWidth = pageWidth - margin * 2;
          const maxHeight = pageHeight - imgY - margin - 24; // reserve a little more bottom space
          
          // Calculate compact dimensions
          const aspect = canvas.width / canvas.height;
          let imgWidth = maxWidth * 0.82; // use ~82% of available width to make the SVG a bit smaller
          let imgHeight = imgWidth / aspect;
          
          // If still too tall, scale down further
          if (imgHeight > maxHeight) {
            imgHeight = maxHeight * 0.85; // shrink a bit more to avoid overlap
            imgWidth = imgHeight * aspect;
          }
          
          // Center the image
          const imgX = (pageWidth - imgWidth) / 2;

          // Use PNG for crisp vectors; jsPDF will compress
          const imgData = canvas.toDataURL('image/png');
          console.log(`📐 Image dimensions:`, {
            imgX, imgY, imgWidth, imgHeight,
            pageWidth, pageHeight,
            imgDataLength: imgData.length
          });
          
          pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'MEDIUM');
          console.log(`✅ Image added to PDF page ${idx + 1}`);

          // Add clickable YouTube links for rooms with videos
          this.addYouTubeLinksToPdf(pdf, imgX, imgY, imgWidth, imgHeight, svgClone);

          // (Moved) YouTube links summary will be added once after all pages
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

      // After all pages are added, render a single Virtual Tour Links section
      // on the last page, positioned a bit higher from the bottom
      pdf.setPage(pdf.getNumberOfPages());
      this.addYouTubeLinksSummary(pdf, pageWidth, pageHeight);

      // Save PDF with compression
      let fileName = `floorplan-${this.filters.outlet !== 'Select Outlet' ? this.filters.outlet : 'all'
        }`;
    
      fileName += '.pdf';
      this.savePdfSmart(pdf, fileName);

      // Show success message with file size info
      this.showMessage(
        `Floorplan PDF exported successfully! 🎉 `
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
  // Add YouTube links to SVG for PDF export (visual elements)
  private addYouTubeLinksToSvg(svgElement: SVGSVGElement): void {
    // Find rooms with YouTube videos
    const roomsWithVideos = this.filteredRooms.filter(room => room.video && room.video.trim() !== '');
    
    if (roomsWithVideos.length === 0) return;

    roomsWithVideos.forEach(room => {
      const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      if (!roomElement) return;

      // Get room's bounding box
      const bbox = roomElement.getBBox();
      if (!bbox) return;

      const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textElement.setAttribute('x', (bbox.x + bbox.width / 2).toString());
      textElement.setAttribute('y', (bbox.y + bbox.height / 2).toString());
      textElement.setAttribute('text-anchor', 'middle');
      textElement.setAttribute('dominant-baseline', 'middle');
      textElement.setAttribute('font-family', 'Arial, sans-serif');
      textElement.setAttribute('font-size', '8px');
      textElement.setAttribute('font-weight', 'bold');
      textElement.setAttribute('fill', '#ff0000'); // Red color for YouTube
      textElement.setAttribute('stroke', '#ffffff'); // White stroke for visibility
      textElement.setAttribute('stroke-width', '0.8');
      textElement.setAttribute('paint-order', 'stroke fill');
      textElement.textContent = 'Tour';
      
      // Add text to SVG
      svgElement.appendChild(textElement);
    });
  }

  // Add clickable YouTube links to PDF
  private addYouTubeLinksToPdf(pdf: any, imgX: number, imgY: number, imgWidth: number, imgHeight: number, svgElement: SVGSVGElement): void {
    // Find rooms with YouTube videos
    const roomsWithVideos = this.filteredRooms.filter(room => room.video && room.video.trim() !== '');
    
    if (roomsWithVideos.length === 0) return;

    // Get SVG viewBox for coordinate mapping
    const viewBox = svgElement.getAttribute('viewBox');
    if (!viewBox) return;
    
    const [svgX, svgY, svgWidth, svgHeight] = viewBox.split(' ').map(Number);
    
    roomsWithVideos.forEach(room => {
      const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      if (!roomElement) return;

      // Get room's bounding box in SVG coordinates
      const bbox = roomElement.getBBox();
      if (!bbox) return;

      // Convert SVG coordinates to PDF coordinates
      const pdfX = imgX + (bbox.x - svgX) * (imgWidth / svgWidth);
      const pdfY = imgY + (bbox.y - svgY) * (imgHeight / svgHeight);
      const pdfWidth = bbox.width * (imgWidth / svgWidth);
      const pdfHeight = bbox.height * (imgHeight / svgHeight);

      // Ensure coordinates are within the image bounds
      if (pdfX >= imgX && pdfY >= imgY && 
          pdfX + pdfWidth <= imgX + imgWidth && 
          pdfY + pdfHeight <= imgY + imgHeight) {
        
        // Add clickable link to PDF
        pdf.link(pdfX, pdfY, pdfWidth, pdfHeight, {
          url: room.video,
          target: '_blank'
        });
      }
    });
  }

  // Add YouTube links summary to PDF
  private addYouTubeLinksSummary(pdf: any, pageWidth: number, pageHeight: number): void {
    // Find rooms with YouTube videos
    const roomsWithVideos = this.filteredRooms.filter(room => room.video && room.video.trim() !== '');
    
    if (roomsWithVideos.length === 0) return;

    // Layout metrics
    const titleFontSize = 9;   // title font size used
    const titleGap = 3;        // extra spacing between title and first item
    const titleHeight = titleFontSize; // approximate baseline step
    const lineHeight = 3;      // compact line height
    const bottomMargin = 20;   // keep space from bottom

    // Compute total list height with two-column fallback to keep within one page
    const totalItems = roomsWithVideos.length;
    const singleColumnHeight = totalItems * lineHeight;
    const availableHeightForList = (pageHeight - bottomMargin) - titleHeight; // when bottom aligned
    const useTwoColumns = singleColumnHeight > availableHeightForList;

    // Determine list height based on layout
    const listHeight = useTwoColumns
      ? Math.ceil(totalItems / 2) * lineHeight
      : singleColumnHeight;

    // Anchor the block (title + list) above bottom, so title moves up as list grows
    let blockBottom = pageHeight - bottomMargin;
    let listBottom = blockBottom;                    // list ends at bottom margin
    let listTop = listBottom - listHeight;           // start of list

    // Prepare for list rendering
    pdf.setFontSize(8); // Smaller font for more compact layout
    pdf.setTextColor(0, 0, 0);
    let yPos = listTop; // current y for list items
    
    // If too many rooms, use two-column layout
    if (useTwoColumns) {
      const midPoint = Math.ceil(roomsWithVideos.length / 2);
      const leftColumn = roomsWithVideos.slice(0, midPoint);
      const rightColumn = roomsWithVideos.slice(midPoint);
      
      // Left column
      let leftY = yPos;
      leftColumn.forEach((room, index) => {
        if (leftY > 20) { // Check if we have space
          const roomName = room.name.length > 20 ? room.name.substring(0, 20) + '...' : room.name;
          pdf.text(`${roomName}:`, 20, leftY);
          
          const linkText = 'Tour';
          const linkX = 20 + pdf.getTextWidth(roomName + ': ') + 2;
          
          pdf.setTextColor(0, 0, 255);
          pdf.textWithLink(linkText, linkX, leftY, {
            url: room.video,
            target: '_blank'
          });
          
          leftY -= lineHeight;
        }
      });
      
      // Right column
      let rightY = yPos;
      rightColumn.forEach((room, index) => {
        if (rightY > 20) { // Check if we have space
          const roomName = room.name.length > 20 ? room.name.substring(0, 20) + '...' : room.name;
          const rightX = pageWidth / 2 + 10;
          pdf.text(`${roomName}:`, rightX, rightY);
          
          const linkText = 'Tour';
          const linkX = rightX + pdf.getTextWidth(roomName + ': ') + 2;
          
          pdf.setTextColor(0, 0, 255);
          pdf.textWithLink(linkText, linkX, rightY, {
            url: room.video,
            target: '_blank'
          });
          
          rightY -= lineHeight;
        }
      });
    } else {
      // Single column layout for fewer rooms
      roomsWithVideos.forEach((room, index) => {
        if (yPos > 20) { // Check if we have space
          const roomName = room.name.length > 25 ? room.name.substring(0, 25) + '...' : room.name;
          pdf.text(`${roomName}:`, 20, yPos);
          
          const linkText = 'Watch Tour';
          const linkX = 20 + pdf.getTextWidth(roomName + ': ') + 2;
          
          pdf.setTextColor(0, 0, 255);
          pdf.textWithLink(linkText, linkX, yPos, {
            url: room.video,
            target: '_blank'
          });
          
          yPos -= lineHeight;
        }
      });
    }

    // Reset text color
    pdf.setTextColor(0, 0, 0);
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
        // Use medium quality settings for optimal file size
        tempDiv.style.width = `${this.pdfQuality.dimensions.width}px`;
        tempDiv.style.height = `${this.pdfQuality.dimensions.height}px`;
        tempDiv.style.backgroundColor = '#ffffff';

        const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
        svgClone.style.width = '100%';
        svgClone.style.height = '100%';
        tempDiv.appendChild(svgClone);
        document.body.appendChild(tempDiv);

        html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: this.pdfQuality.scale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: this.pdfQuality.dimensions.width,
          height: this.pdfQuality.dimensions.height,
          removeContainer: true,
          foreignObjectRendering: false,
          imageTimeout: 30000 // increased from 0 for iOS stability
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

  // Get estimated file size for medium quality (for display in success message)
  getEstimatedFileSize(): string {
    return this.compactMode ? '~300 KB - 600 KB' : '~500 KB - 1 MB';
  }

  // Toggle compact mode for PDF export
  toggleCompactMode(): void {
    this.compactMode = !this.compactMode;
    console.log('Compact mode:', this.compactMode ? 'ON' : 'OFF');
  }

  // Get compact mode status
  isCompactMode(): boolean {
    return this.compactMode;
  }

  // Get dynamic Pax legend based on filtered rooms
  private getDynamicPaxLegend(): Array<{ label: string, color: string }> {
    const legend: Array<{ label: string, color: string }> = [];

    // Only show legend if user has selected "Available" status AND no date filter is applied
    // When a date is selected we color by availability (green/red), not pax palette
    if (this.filters.status !== 'Available' || this.selectedStartDate) {
      return legend;
    }

    const usedPaxSizes = new Set<number>();

    // Collect all Pax sizes from filtered rooms
    // Use effective status for accuracy
    const getEffectiveStatus = (room: Room): 'Available' | 'Occupied' => {
      if (this.selectedStartDate) {
        const avail = this.availabilityByRoomId.get(room.id);
        if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') {
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            return 'Occupied';
          } else {
            // Room is available - use date-based availability
            return avail === 'free' ? 'Available' : 'Occupied';
          }
        }
      }
      return this.toStatusUnion(room.status);
    };

    this.filteredRooms.forEach(room => {
      if (getEffectiveStatus(room) === 'Available') {
        usedPaxSizes.add(room.capacity);
      }
    });

    // Only show legend if there are available rooms
    if (usedPaxSizes.size === 0) {
      return legend;
    }

    // Create legend entries only for Pax buckets that have actual rooms
    this.paxBuckets.forEach((bucket, index) => {
      // Check if any of the used Pax sizes fall within this bucket
      const hasMatchingRooms = Array.from(usedPaxSizes).some(pax => {
        // For the first bucket (2-4), check if pax is between 2 and 4
        if (index === 0) {
          return pax >= 2 && pax <= bucket.max;
        }
        // For other buckets, check if pax falls within the range
        const prevBucket = this.paxBuckets[index - 1];
        return pax > prevBucket.max && pax <= bucket.max;
      });

      if (hasMatchingRooms) {
        legend.push({
          label: bucket.label,
          color: this.paxPalette[index]
        });
      }
    });

    return legend;
  }

  // Convert hex color to RGB for jsPDF
  private hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    const result = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 10),
        g: parseInt(result[2], 10),
        b: parseInt(result[3], 10)
      };
    }

    // Handle hex format
    const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (hexResult) {
      return {
        r: parseInt(hexResult[1], 16),
        g: parseInt(hexResult[2], 16),
        b: parseInt(hexResult[3], 16)
      };
    }

    return null;
  }

  getFloorLabel(path: string): string {
    if (!path) return '';

    // Check if path is in the new format (floorLabel|floorId)
    if (path.includes('|')) {
      const floorId = path.split('|')[1];
      const floorLabel = path.split('|')[0];

      // Special case for Sibelco Office
      if (floorId === '6348ba804d92f2ab589dc7e3' || floorLabel === 'Sibelco Office') {
        return 'Sibelco Office';
      }

      // For other floors, add "Level" prefix if it's numeric
      if (/^\d+[A-Za-z]?$/.test(floorLabel)) {
        return `Level ${floorLabel}`;
      }

      return floorLabel;
    }

    // Fallback to old logic for SVG paths
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

  private isIOSDevice(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  private savePdfSmart(pdf: jsPDF, fileName: string) {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    if (this.isIOSDevice()) {
      window.open(url, '_blank'); // iOS can Share/Save
    } else {
      pdf.save(fileName);
    }
  }

  private downscaleCanvasIfNeeded(src: HTMLCanvasElement): HTMLCanvasElement {
    const MAX_PX = 8_000_000; // ~8MP safety cap
    const area = src.width * src.height;
    if (area <= MAX_PX) return src;

    const scale = Math.sqrt(MAX_PX / area);
    const dst = document.createElement('canvas');
    dst.width = Math.max(1, Math.floor(src.width * scale));
    dst.height = Math.max(1, Math.floor(src.height * scale));

    const ctx = dst.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  }

  // Returns a normal YouTube "watch" URL for the given room (if present)
  getYouTubeWatchUrlFor(room: Room | null | undefined): string | null {
    if (!room?.video) return null;
    return this.toYouTubeWatch(room.video.trim());
  }

  // Get all rooms that have YouTube links
  getRoomsWithYouTubeLinks(): Room[] {
    return this.rooms.filter(room => room.video && room.video.trim() !== '');
  }

  // Get count of rooms with YouTube links
  getYouTubeLinkCount(): number {
    return this.getRoomsWithYouTubeLinks().length;
  }

  // Normalize YouTube URLs to https://www.youtube.com/watch?v=VIDEO_ID
  private toYouTubeWatch(raw: string): string | null {
    if (!raw) return null;
    try {
      const u = new URL(raw);

      // youtu.be/<id>
      if (u.hostname.includes('youtu.be')) {
        const id = u.pathname.replace('/', '');
        return id ? `https://www.youtube.com/watch?v=${id}` : null;
      }

      // youtube.com/embed/<id>
      if (u.hostname.includes('youtube.com')) {
        if (u.pathname.startsWith('/embed/')) {
          const id = u.pathname.split('/')[2];
          return id ? `https://www.youtube.com/watch?v=${id}` : null;
        }
        // youtube.com/watch?v=<id>
        if (u.pathname === '/watch') {
          const id = u.searchParams.get('v');
          return id ? `https://www.youtube.com/watch?v=${id}` : null;
        }
      }

      // If it's already a usable link, return as-is
      return raw;
    } catch {
      return raw;
    }
  }

  private async loadInlineSvgs(urls: string[]) {
    // Normalize URLs to keys (remove query params) for consistent lookup
    const urlToKeyMap = new Map<string, string>();
    urls.forEach(url => {
      const key = this.normalizeUrlKey(url);
      urlToKeyMap.set(url, key);
    });
    
    const toFetch = urls.filter(u => {
      const key = urlToKeyMap.get(u)!;
      return !this.svgHtmlMap.has(key);
    });
    
    // If nothing to fetch, clear loading state immediately
    if (toFetch.length === 0) {
      this.svgLoading = false;
      this.floorplansLoaded = true;
      setTimeout(() => this.attachAndColorAllInline(), 0);
      return;
    }

    // Track loading progress
    let completed = 0;
    let failed = 0;
    const total = toFetch.length;

    const checkComplete = () => {
      if (completed + failed >= total) {
        // All fetches completed (success or failure)
        this.svgLoading = false;
        this.floorplansLoaded = true;
        if (completed > 0) {
          console.log(`✅ ${completed}/${total} SVGs loaded successfully`);
        }
        if (failed > 0) {
          console.warn(`⚠️ ${failed}/${total} SVGs failed to load`);
        }
        // Wait for Angular to render, then attach listeners & color
        setTimeout(() => this.attachAndColorAllInline(), 0);
      }
    };

    // Normalize all URLs first using Promise.all to avoid race conditions
    const normalizedUrls = await Promise.all(
      toFetch.map(async url => {
        try {
          const normalizedUrl = await this.normalizeToDownloadUrl(url);
          return { originalUrl: url, normalizedUrl };
        } catch (err) {
          console.warn('⚠️ Failed to normalize URL:', url, err);
          return { originalUrl: url, normalizedUrl: url }; // Fallback to original URL
        }
      })
    );

    // Now process all normalized URLs
    normalizedUrls.forEach(({ originalUrl, normalizedUrl }) => {
      const source = this.detectSvgSource(originalUrl);
      console.log(`⬇️ Fetching SVG URL from ${source.toUpperCase()}:`, originalUrl);
      console.log(`🔄 Normalized URL:`, normalizedUrl);
      
      // Add authentication header if URL is from backend API
      const token = sessionStorage.getItem('userAccessToken') || '';
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      
      this.http.get(normalizedUrl, { responseType: 'text', headers }).subscribe({
        next: (svgText) => {
          // Process SVG for compact display
          const processedSvgText = this.processSvgForCompactDisplay(svgText);
          const safe = this.sanitizer.bypassSecurityTrustHtml(processedSvgText);
          // Store using normalized key (without query params) for consistent lookup
          const key = this.normalizeUrlKey(originalUrl);
          this.svgHtmlMap.set(key, safe);
          console.log(`✅ SVG fetched and processed from ${source.toUpperCase()}:`, { 
            originalUrl, 
            normalizedUrl,
            key,
            length: processedSvgText?.length || 0,
            svgHtmlMapKeys: Array.from(this.svgHtmlMap.keys())
          });
          completed++;
          checkComplete();
        },
        error: (err) => {
          console.error('❌ Failed to fetch SVG:', originalUrl, err);
          console.error('❌ Error details:', {
            status: err.status,
            statusText: err.statusText,
            url: err.url || normalizedUrl,
            originalUrl: originalUrl,
            message: err.message,
            hasToken: !!token
          });
          
          // Store fallback error SVG so UI doesn't look blank
          const key = this.normalizeUrlKey(originalUrl);
          const fallbackSvg = `<svg width="100%" height="200" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f3f4f6"/>
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="14" fill="#6b7280">
              SVG load failed (${err.status || 'Network Error'})
            </text>
          </svg>`;
          this.svgHtmlMap.set(key, this.sanitizer.bypassSecurityTrustHtml(fallbackSvg));
          
          failed++;
          checkComplete();
          if (failed === total) {
            // All failed
            this.toastService.error('Failed to load floorplan SVGs');
            this.svgFailed = true;
          }
        }
      });
    });
  }


  //SVG Size Compact Display
  /**
   * Process SVG content to make it more compact and responsive
   */
  private processSvgForCompactDisplay(svgText: string): string {
    // Create a temporary DOM element to parse the SVG
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svgText;
    const svgElement = tempDiv.querySelector('svg');
    
    if (!svgElement) return svgText;

    // Set responsive attributes for compact display
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', 'auto');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Ensure XML namespace attributes exist (some SVGs omit them and certain browsers get picky)
    if (!svgElement.getAttribute('xmlns')) {
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!svgElement.getAttribute('xmlns:xlink')) {
      svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    // Normalize inline style: remove anything that hides the SVG
    const existingStyle = svgElement.getAttribute('style') || '';
    const cleanedStyle = existingStyle
      .replace(/display\s*:\s*none\s*;?/gi, '')
      .replace(/visibility\s*:\s*hidden\s*;?/gi, '');
    svgElement.setAttribute(
      'style',
      `${cleanedStyle};max-width: 100%; height: auto; display: block;`.replace(/^;+/,'')
    );
    
    // Ensure viewBox is set for proper scaling
    if (!svgElement.getAttribute('viewBox')) {
      const widthAttr = svgElement.getAttribute('width') || '';
      const heightAttr = svgElement.getAttribute('height') || '';
      const widthNum = parseFloat(widthAttr) || 1000;
      const heightNum = parseFloat(heightAttr) || 1000;
      svgElement.setAttribute('viewBox', `0 0 ${widthNum} ${heightNum}`);
    }

    return tempDiv.innerHTML;
  }

  private attachAndColorAllInline() {
    const currentKey = this.currentFloorplan ? this.normalizeUrlKey(this.currentFloorplan) : null;
    console.log('🔗 attachAndColorAllInline called, svgHosts count:', this.svgHosts?.length || 0);
    console.log('🎯 Current floorplan for display:', this.currentFloorplan);
    console.log('🔑 Normalized key:', currentKey);
    console.log('📊 SVG HTML Map size:', this.svgHtmlMap.size);
    console.log('📋 SVG HTML Map keys:', Array.from(this.svgHtmlMap.keys()));
    console.log('🔍 Has current key?', currentKey ? this.svgHtmlMap.has(currentKey) : false);
    
    if (!this.svgHosts) {
      console.log('❌ No svgHosts found');
      return;
    }

    // For each inlined SVG root, run listeners + color
    this.svgHosts.forEach((hostRef, index) => {
      const host = hostRef.nativeElement;
      console.log(`🔗 Processing host ${index}:`, host);
      console.log(`🔗 Host innerHTML length:`, host.innerHTML?.length || 0);
      
      const rootSvg = host.querySelector('svg') as SVGSVGElement | null;
      if (!rootSvg) {
        console.log(`❌ No SVG found in host ${index}`);
        return;
      }

      console.log(`✅ Found SVG in host ${index}:`, rootSvg);
      console.log(`🔗 SVG children count: ${rootSvg.children.length}`);
      console.log(`🔗 SVG viewBox:`, rootSvg.getAttribute('viewBox'));
      
      // Check if SVG has room elements
      const roomElements = rootSvg.querySelectorAll('[id]');
      console.log(`🔗 SVG elements with IDs: ${roomElements.length}`);
      if (roomElements.length > 0) {
        console.log(`🔗 First few IDs:`, Array.from(roomElements).slice(0, 3).map(el => el.id));
      }
      
      // Attach click handlers on this inline SVG
      this.attachRoomListenersInline(rootSvg);

      // Color rooms on this inline SVG
      this.updateSvgColorsInline(rootSvg);
    });
  }

  private attachRoomListenersInline(rootSvg: SVGSVGElement) {
    console.log('attachRoomListenersInline called for SVG:', rootSvg);
    const svgDoc = rootSvg.ownerDocument!;
    
    // Remove any existing listeners first to avoid duplicates
    if ((rootSvg as any).__ps_click_bound__) {
      console.log('Removing existing click listener');
      rootSvg.removeEventListener('click', (rootSvg as any).__ps_click_handler);
    }
    
    // Use your existing logic, but operate within rootSvg:
    //  - Instead of searching in object.contentDocument,
    //  - search within rootSvg
    const handleClick = (event: MouseEvent) => {
      console.log('🎯 SVG CLICK DETECTED:', {
        target: event.target,
        targetTagName: (event.target as Element)?.tagName,
        targetId: (event.target as Element)?.id,
        targetClass: (event.target as Element)?.className,
        currentTarget: event.currentTarget,
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        offsetX: event.offsetX,
        offsetY: event.offsetY,
        screenX: event.screenX,
        screenY: event.screenY
      });
      
      let target = event.target as Element | null;
      const root = rootSvg as Element;
      let matched = false;
      
      while (target && target !== root) {
        const el = target as HTMLElement;
        let candidate = el.id || el.getAttribute?.('data-id') || el.getAttribute?.('data-room') || '';
        
        console.log('Checking element:', {
          tagName: el.tagName,
          id: el.id,
          candidate: candidate,
          classList: el.classList.toString()
        });
        
        if (!candidate) {
          const href = el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
          if (href && href.startsWith('#')) candidate = href.slice(1);
        }
        
        if (candidate) {
          const normalized = this.normalizeId(candidate);
          console.log('🔍 Found candidate:', { 
            candidate, 
            normalized,
            roomIdIndexSize: this.roomIdIndex.size,
            roomIdIndexKeys: Array.from(this.roomIdIndex.keys()).slice(0, 5) // Show first 5 keys
          });
          const room = this.roomIdIndex.get(normalized);
          if (room) {
            console.log('✅ Matched room:', { id: room.id, name: room.name });
            this.openPopupFromRoom(room, event);
            matched = true;
            return;
          } else {
            console.log('❌ No room found for normalized ID:', normalized);
            // Try to find room by original candidate
            const roomByOriginal = this.roomIdIndex.get(candidate);
            if (roomByOriginal) {
              console.log('✅ Found room by original candidate:', { id: roomByOriginal.id, name: roomByOriginal.name });
              this.openPopupFromRoom(roomByOriginal, event);
              matched = true;
              return;
            }
          }
        }
        target = target.parentElement;
      }
      
      if (!matched) {
        console.log('No room element matched, closing popup');
        this.closePopup();
      }
    };

    // Store the handler reference for potential removal
    (rootSvg as any).__ps_click_handler = (ev: Event) => this.ngZone.run(() => handleClick(ev as MouseEvent));
    
    // Add the click listener
    rootSvg.addEventListener('click', (rootSvg as any).__ps_click_handler);
    (rootSvg as any).__ps_click_bound__ = true;
    
    // Also add a simple test listener to verify clicks are being detected
    rootSvg.addEventListener('click', (ev) => {
      console.log('🔥 TEST CLICK DETECTED!', {
        target: ev.target,
        targetTag: (ev.target as Element)?.tagName,
        targetId: (ev.target as Element)?.id,
        coordinates: {
          clientX: (ev as MouseEvent).clientX,
          clientY: (ev as MouseEvent).clientY,
          pageX: (ev as MouseEvent).pageX,
          pageY: (ev as MouseEvent).pageY
        }
      });
    });
    
    console.log('Click listener attached to SVG');

    // Strong bindings on specific room elements
    console.log('Setting up room-specific click handlers for', this.rooms.length, 'rooms');
    this.rooms.forEach((room, index) => {
      const el = this.findRoomElementInline(rootSvg, room) as HTMLElement | null;
      if (!el) {
        console.log(`Room ${index} (${room.name}) element not found in SVG`);
        return;
      }
     // console.log(`Found room element for ${room.name}:`, el);
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      if (!(el as any).__ps_room_bound__) {
        el.addEventListener('click', (ev: MouseEvent) =>
          this.ngZone.run(() => {
            console.log('Room-specific click handler triggered for:', room.name);
            ev.preventDefault();
            ev.stopPropagation();
            this.openPopupFromRoom(room, ev);
          })
        );
        (el as any).__ps_room_bound__ = true;
      }
    });
  }

  private findRoomElementInline(rootSvg: SVGSVGElement, room: Room): Element | null {
    // Same logic as findRoomElementInDoc, but scoped to rootSvg
    const byId = rootSvg.querySelector(`#${CSS.escape(room.id)}`);
    if (byId) return byId;

    const variants = [
      room.name,
      room.name.replace(/\s+/g, ''),
      room.name.replace(/\s+/g, '-'),
      room.name.replace(/\s+/g, '_'),
    ];
    for (const v of variants) {
      const el = rootSvg.querySelector(`#${CSS.escape(v)}`);
      if (el) return el;
    }
    return null;
  }

  private updateSvgColorsInline(rootSvg: SVGSVGElement) {
    this.rooms.forEach(room => {
      const el = this.findRoomElementInline(rootSvg, room);
      if (!el) return;

      // Skip elements inside <defs>/<clipPath>/<mask> (they won't render directly)
      const containerTag = (el.closest('defs,clipPath,mask') as Element | null)?.tagName?.toLowerCase();
      if (containerTag) return;

      const isSelected = this.filteredRooms.includes(room);
      let color = 'none';
      if (isSelected) {
        // Compute effective status based on selected-date availability if provided
        const avail = this.selectedStartDate ? this.availabilityByRoomId.get(room.id) : undefined;
        let effectiveStatus: 'Occupied' | 'Available';
        if (avail) {
          // When date is selected, check both availability AND original room status
          // If room status is reserved/unavailable/available_soon/occupied, keep it red
          const originalStatus = this.toStatusUnion(room.status);
          if (originalStatus === 'Occupied') {
            // Room is reserved/unavailable/available_soon/occupied - keep red regardless of availability
            effectiveStatus = 'Occupied';
          } else {
            // Room is available - use date-based availability
            effectiveStatus = (avail === 'free') ? 'Available' : 'Occupied';
          }
        } else {
          effectiveStatus = this.toStatusUnion(room.status);
        }

        if (effectiveStatus === 'Occupied') {
          color = '#ef4444'; // Red for occupied
        } else if (this.filters.status === 'Available') {
          // Use pax-based palette for available rooms when filtering by Available (even with date range)
          color = this.getPaxColor(room.capacity);
        } else {
          color = '#22c55e'; // Green for available (default)
        }
      }

      const tag = el.tagName.toLowerCase();

      // 🔥 Use inline style with !important to beat embedded SVG CSS
      (el as HTMLElement).style.setProperty('fill', color, 'important');
      (el as HTMLElement).style.setProperty('pointer-events', 'auto', 'important');
      el.setAttribute('opacity', isSelected ? '0.7' : '0.35');

      // Stroke-only shapes
      if (tag === 'line' || tag === 'polyline') {
        (el as HTMLElement).style.setProperty('stroke', color, 'important');
        if (color !== 'none') el.setAttribute('stroke-width', '2');
      }

      // If it's a <use>, style the referenced element too
      if (tag === 'use') {
        const href = (el as any).getAttribute('href') || (el as any).getAttribute('xlink:href');
        if (href && href.startsWith('#')) {
          const ref = rootSvg.querySelector(href) as HTMLElement | null;
          if (ref) {
            ref.style.setProperty('fill', color, 'important');
            ref.style.setProperty('pointer-events', 'auto', 'important');
          }
        }
      }

      (el as HTMLElement).style.cursor = 'pointer';
    });
  }

  // Helper to ensure path has floorplans prefix (for backward compatibility)
  private ensureFloorplansPrefix(path: string): string {
    // If path already starts with floorplans/, keep it
    if (path.startsWith('floorplans/')) return path;
    // Keep path as-is since backend now supports both root level and floorplans/ prefix
    return path;
  }

  // Safe version of normalizeToDownloadUrl with better error handling
  private async normalizeToDownloadUrl(url: string): Promise<string> {
    try {
      if (!url) return url;
      
      // Already a valid Firebase URL
      if (url.includes('firebasestorage.googleapis.com/v0/b/')) return url;
      
      // gs://bucket/path
      if (url.startsWith('gs://')) {
        const withoutScheme = url.slice(5);
        const firstSlash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, firstSlash);
        const objectPath = withoutScheme.slice(firstSlash + 1);
        const fixedPath = this.ensureFloorplansPrefix(objectPath);
        
        const storage = getStorage(undefined, `gs://${bucket}`);
        return await getDownloadURL(ref(storage, fixedPath));
      }
      
      // https://storage.googleapis.com/bucket/path
      const match = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
      if (match) {
        const [, bucket, objectPath] = match;
        const fixedPath = this.ensureFloorplansPrefix(objectPath);
        const storage = getStorage(undefined, `gs://${bucket}`);
        return await getDownloadURL(ref(storage, fixedPath));
      }
      
      return url;
    } catch (err) {
      console.warn('⚠️ normalizeToDownloadUrl failed:', url, err);
      return url; // Return original URL on error
    }
  }
}