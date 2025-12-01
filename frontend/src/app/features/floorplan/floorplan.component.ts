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
import { ToastComponent } from '../../shared/components/toast.component';
import { HttpClient } from '@angular/common/http';
// Services
import { DropdownFilterService, FilterConfig, Filters } from './services/dropdown-filter.service';
import { ColorPaxService } from './services/color-pax.service';
import { SvgLoaderService } from './services/svg-loader.service';
import { AvailabilityService } from './services/availability.service'; //exprot file
import { SvgColorService } from './services/svg-color.service';
import { PopupUiService } from './services/popup-ui.service';
import { YoutubeLinksService } from './services/youtube-links.service';
import { FloorplanNavigationService } from './services/floorplan-navigation.service';
import { PdfExportService } from './services/pdf-export.service';
import { DownloadService } from './services/download.service';
import { SvgEventsService } from './services/svg-events.service';
import * as FloorplanUtils from './services/floorplan-utils';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ToastComponent, RouterLink,RouterLinkActive],
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

  
  // Pax-based color palette //legend - now from service
  get paxPalette() { return this.colorPaxService.paxPalette; }
  get paxBuckets() { 
    // Return dynamic buckets based on current outlet's rooms (from /resources)
    if (this.rooms && this.rooms.length > 0) {
      return this.colorPaxService.getDynamicBucketsForRooms(this.rooms);
    }
    // Fallback to fixed buckets
    return this.colorPaxService.paxBuckets;
  }
  
  // Get dynamic pax legend based on outlet's pax groups   <-- check sini 1 //functions after status filter
  getDynamicPaxLegend(): Array<{ label: string, color: string }> {
    return this.colorPaxService.getDynamicPaxLegend(
      this.filteredRooms,
      this.filters.status,
      this.selectedStartDate,
      this.availabilityByRoomId,
      this.rooms // Pass all rooms for the outlet to get pax groups (optional fifth arg)
    );
  }

  // Multi-select suite functionality
  selectedSuites: string[] = [];
  suiteSearchTerm: string = '';

  isArray(value: unknown): boolean {
    return Array.isArray(value);
  }

  getOptionValue(opt: any): string {
    return this.dropdownFilterService.getOptionValue(opt);
  }

  getOptionLabel(opt: any): string {
    return this.dropdownFilterService.getOptionLabel(opt);
  }

  filtersConfig: FilterConfig[] = [
    { key: 'outlet', label: 'Outlet', options: [] as any[] },
    { key: 'status', label: 'Status', options: [] as string[] },
    { key: 'pax', label: 'Pax', options: [] as string[] },
  ];
  
  filters: Filters = {
    outlet: 'Select Outlet',
    status: 'Select Status',
    pax: 'Select Pax',
    svg: 'all',
  };
  // Date filters
  selectedStartDate: string = new Date().toISOString().split('T')[0]; //Added date filters - initialized with today's dates
  selectedEndDate: string = ''; //Added date filters
  availabilityByRoomId: Map<string, 'free' | 'occupied'> = new Map(); //Added date filters
  outletOptions: { label: string; value: string }[] = [];
  statusOptions: string[] = [];
  paxOptions: string[] = [];
  suiteOptions: string[] = [];
  leftPanelCollapsed = false;
  
  Occupied: number = 0;
  Available: number = 0; 
  
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
  private roomIdIndex: Map<string, Room> = new Map();
  private objectToOriginalViewBox = new WeakMap<HTMLObjectElement, string>();
  private floorLabelOverrides: Record<string, Record<string, string>> = {};
 
  svgHtmlMap = new Map<string, SafeHtml>(); // Store SafeHtml for [innerHTML] binding
  @ViewChildren('svgHost') svgHosts!: QueryList<ElementRef<HTMLDivElement>>;


  // Normalize URL key by removing query params for consistent lookup (public for template)
  normalizeUrlKey(url: string | null): string {
    return this.svgLoaderService.normalizeUrlKey(url);
  }
  constructor(
    private roomService: RoomService,
    private officeService: OfficeService,
    private floorService: FloorService,
    private toastService: ToastService,
    public sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private auth: AuthService,
    // New services
    private dropdownFilterService: DropdownFilterService,
    private colorPaxService: ColorPaxService,
    private svgLoaderService: SvgLoaderService,
    private availabilityService: AvailabilityService,  //here 
    private svgColorService: SvgColorService,
    private popupUiService: PopupUiService,
    private youtubeLinksService: YoutubeLinksService,
    private floorplanNavigationService: FloorplanNavigationService,
    private pdfExportService: PdfExportService,
    private downloadService: DownloadService,
    private svgEventsService: SvgEventsService
  ) { }
  
  logout() {
    this.auth.logout();
  }
  getSafeUrl(url: string): SafeResourceUrl {
    return this.svgLoaderService.getSafeUrl(url);
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

onMainContentClick() {
  // Only close if the sidebar is open and the click was outside it
  if (!this.sidebarCollapsed) {
    this.sidebarCollapsed = true;
  }
}

  trackBySvgUrl = (_: number, url: string) => url;

  // Helper method to get toStatusUnion for passing to services
  private toStatusUnion(status: string): 'Available' | 'Occupied' {
    return this.availabilityService.toStatusUnion(status);
  }


ngOnInit() {
    // 🛑 STOP! We wait for the Auth Service to give the green light.
    // 'ensureAuthReady()' waits until the token is refreshed and valid.
    this.auth.ensureAuthReady().subscribe(() => {
      console.log('✅ Auth is ready. Now loading floorplans...');
      
      // 🟢 GO! Now it is safe to load data.
      this.loadOffices();
      this.loadFloors();
    });

    // These do not require the backend token, so they can run immediately.
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
    this.updateSelectedOutletSvgs();

    // ✅ FIX: If a date was selected, refetch availability with new rooms
    if (this.selectedStartDate) {
      console.log('🔄 Rooms updated with date selected. Refetching availability...');
      this.fetchAvailabilityForCurrentSelection();
    } else {
      // No date selected → use current room status
      this.buildOptions();
      this.applyFilters();
    }
  });
  }


  // Setup keyboard navigation for floorplan pagination
  private setupKeyboardNavigation() {
    this.floorplanNavigationService.setupKeyboardNavigation(
      () => this.previousFloorplan(),
      () => this.nextFloorplan(),
      (index: number) => this.goToFloorplan(index),
      this.totalFloorplans
    );
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
      // Build floor ID to floor mapping for quick lookup
      this.floorIdToFloorMap.clear();
      floors.forEach(floor => {
        this.floorIdToFloorMap.set(floor.floor_id, floor);
      });
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

    this.loadResources({ officeId }).subscribe(() => {
      // 1. Rooms are now fully loaded.
      
      // 2. If date was already chosen, NOW it is safe to check availability
      if (this.selectedStartDate) {
        console.log('✅ Rooms loaded. Fetching availability...');
        this.fetchAvailabilityForCurrentSelection();
      }
    });
  }

// Updated to return Observable so we can subscribe to it
  loadResources(params: ResourceParams): Observable<any> {
    // Return the observable chain
    return this.roomService.getResources(params).pipe(
      tap((response) => {
        this.dataLoading = false; // Data loading complete
        if (response) {
          // Update selected outlet SVGs first
          this.updateSelectedOutletSvgs();
          // Always build filters immediately with base status for instant visual feedback
          // Availability data will update colors later if date is selected
          this.buildFiltersFromBackend();
          // SVG color updates will be handled by updateSelectedOutletSvgs -> updateDisplayedSvgs
        }
      }),
      catchError((error) => {
        console.error('Error loading resources:', error);
        this.toastService.error('Failed to load resources. Please try again.');
        this.dataLoading = false;
        return of(null);
      })
    );
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
      this.currentFloorplanIndex++;
      // Close any open popup when changing floorplans
      this.closePopup();
      // Apply filters to ensure resources data is maintained (without auto-switch)
      this.applyFilters(false);
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
      // Apply filters to ensure resources data is maintained (without auto-switch)
      this.applyFilters(false);
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
      // Apply filters to ensure resources data is maintained (without auto-switch)
      this.applyFilters(false);
      
      // Wait for Angular to update the DOM with the new SVG before applying colors
      // Use longer delay to ensure SVG is fully loaded in the DOM
      setTimeout(() => {
        // Apply floorplan state for SVG updates (colors and listeners)
        this.applyFloorplanState();
        // Also explicitly update colors to ensure they're applied
        this.updateSvgColors();
        // Force reattachment of event listeners and color updates
        this.attachAndColorAllInline();
      }, 250);
    }
  }
  
  //key connector between your resources data and the SVG floorplans.
  private async updateSelectedOutletSvgs() {
    const outletId = this.filters.outlet;
    // Reset baseline state
    this.selectedOutletSvgs = [];
    this.displayedSvgs = [];
    this.selectedFloorSvg = 'all';
    this.floorOptions = [];
    this.noSvgsFromFirebase = false;
    this.floorplansLoaded = false;
    this.uiMessage = '' as any;

    try {
      const result = await this.svgLoaderService.updateSelectedOutletSvgs(
        outletId,
        this.rooms,
        this.floors,
        this.floorIdToFloorMap
      );

      this.selectedOutletSvgs = result.selectedOutletSvgs;
      // Enforce order: Level 1 -> Sibelco Office -> Level 3A
      // 1. Find the readable name of the current outlet (e.g., "TTDI")
            const currentOutletLabel = this.outletOptions.find(
              opt => opt.value === this.filters.outlet
            )?.label || '';

            // 2. If this is TTDI, enforce the sequence
            if (currentOutletLabel.includes('TTDI')) {
              this.selectedOutletSvgs.sort((urlA, urlB) => {
                // Get the names (Sibelco will now be named correctly due to Step 1)
                const labelA = this.getFloorLabel(urlA).toLowerCase();
                const labelB = this.getFloorLabel(urlB).toLowerCase();

                const getWeight = (label: string) => {
                  if (label.includes('level 1')) return 1;        // Top
                  if (label.includes('sibelco')) return 2;        // Middle
                  if (label.includes('3a') || label.includes('level 3a')) return 3; // Bottom
                  return 4; 
                };

                return getWeight(labelA) - getWeight(labelB);
              });
            }
      this.floorOptions = result.floorOptions;
      this.noSvgsFromFirebase = result.noSvgsFromFirebase;
      this.floorplansLoaded = true;
      this.updateDisplayedSvgs();
    } catch (error) {
      console.error('Error updating selected outlet SVGs:', error);
      this.floorplansLoaded = true;
    }

    // default to all floors when outlet changes
    this.selectedFloorSvg = 'all';
  }

  private attachRoomListeners(svgDoc: Document) {
    this.svgEventsService.attachRoomListeners(
      svgDoc,
      this.rooms,
      this.roomIdIndex,
      (val) => this.normalizeId(val),
      (room, event) => this.openPopupFromRoom(room, event),
      () => this.closePopup(),
      this.filteredRooms,
      (room) => this.onSuiteDoubleClick(room)
    );
  }

  buildOptions() {
    const result = this.dropdownFilterService.buildOptions(
      this.rooms,
      this.filters,
      this.selectedSuites,
      this.suiteSearchTerm,
      this.availabilityByRoomId,
      this.selectedStartDate
    );

    this.outletOptions = result.outletOptions;
    this.statusOptions = result.statusOptions;
    this.paxOptions = result.paxOptions;
    this.suiteOptions = result.suiteOptions;

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
      //console.log('🧭 Outlet filter change:', { rawValue: value });
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
        this.updateSvgColors();
        this.svgLoading = false; // Hide loading when filtering is complete
        this.applyFloorplanState();
  
    }
        // Use string comparison to avoid TypeScript narrowing issues on the key union
    const keyStr = String(key);
    if (['status', 'pax', 'outlet'].includes(keyStr)) {
      // Only auto-zoom if filtering yields exactly one room
      if (this.filteredRooms.length === 1) {
        const onlyRoom = this.filteredRooms[0];
       /* console.log('[Floorplan] zoom due to filters yielding one room', {
          id: onlyRoom.id,
          name: onlyRoom.name,
          key,
          value: this.filters[key],
        });*/
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
          this.buildOptions();
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
    } else {
      // When date is cleared, reapply filters and auto-switch floorplan
      this.applyFilters();
    }
  }
//New function to fetch availability for current selection
  private async fetchAvailabilityForCurrentSelection() {
    const officeId = this.filters.outlet;

    if (!officeId || officeId === 'Select Outlet' || !this.selectedStartDate) return;

    const start = this.selectedStartDate;
    const end = this.selectedEndDate || this.selectedStartDate;

    try {
      const availabilityMap = await this.availabilityService.fetchAvailabilityForCurrentSelection(
        officeId,
        start,
        end,
        this.rooms,
        (val: string) => val,
        (room: Room) => this.availabilityService.isRoomUnavailable(room)
      );

      this.availabilityByRoomId = availabilityMap;

      // 🔍 DEBUG: Log availability data details
      console.log('📊 Availability fetch complete:', {
        officeId,
        dateRange: { start, end },
        totalRooms: this.rooms.length,
        availabilityMapSize: this.availabilityByRoomId.size,
        roomIds: this.rooms.slice(0, 5).map(r => r.id),
        availabilityKeys: Array.from(this.availabilityByRoomId.keys()).slice(0, 5),
        sampleAvailability: Array.from(this.availabilityByRoomId.entries()).slice(0, 5)
      });

      // // ✅ FIX: Validate availability data BEFORE applying filters
      // if (this.availabilityByRoomId.size === 0) {
      //   console.warn('⚠️ Availability fetch returned no data for any rooms');
      //   this.toastService.error('No availability data found for selected date(s)');
      //   // Don't update UI with empty data
      //   return;
      // }

      if (this.availabilityByRoomId.size < this.rooms.length) {
        console.warn(`⚠️ Availability data incomplete: ${this.availabilityByRoomId.size}/${this.rooms.length} rooms`);
      }

      // ✅ FIX: Update UI after availability is confirmed loaded
      this.buildOptions(); // Rebuild dropdown options with availability data
      this.applyFilters(); // Recalculate metrics with correct availability data

      // Use requestAnimationFrame for better timing
      this.ngZone.run(() => {
        requestAnimationFrame(() => {
          this.updateSvgColors();
          console.log('✅ SVG colors updated after availability fetch');
        });
      });

    } catch (error) {
      console.error('❌ Failed to fetch availability', error);
      this.toastService.error('Failed to fetch availability for selected date(s)');
      this.availabilityByRoomId.clear();
      this.buildOptions(); // Rebuild options even on error
      this.applyFilters(); // Recalculate metrics
      this.ngZone.run(() => {
        requestAnimationFrame(() => this.updateSvgColors());
      });
    }
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
    /*console.log('🔄 updateDisplayedSvgs called:', { 
      outletId, 
      selectedFloorSvg: this.selectedFloorSvg, 
      selectedOutletSvgs: this.selectedOutletSvgs,
      selectedOutletSvgsCount: this.selectedOutletSvgs.length,
      floorplansLoaded: this.floorplansLoaded,
      source: currentSource.toUpperCase()
    });*/
    //console.log('🧭 Rendering floorplans:', { count: this.selectedOutletSvgs.length, urls: this.selectedOutletSvgs });
    
    if (!outletId || outletId === 'Select Outlet') {
      this.displayedSvgs = [];
      this.currentFloorplanIndex = 0; // Reset pagination
      //console.log('❌ No outlet selected, clearing displayedSvgs');
      return;
    }

    // Wait for floorplans to be loaded before displaying
    if (!this.floorplansLoaded) {
      //console.log('⏳ Floorplans not loaded yet, waiting...');
      // Retry after a short delay
      setTimeout(() => {
        if (this.floorplansLoaded) {
          //console.log('✅ Floorplans loaded, retrying updateDisplayedSvgs');
          this.updateDisplayedSvgs();
        } else {
          //console.warn('⚠️ Floorplans still not loaded after wait, proceeding anyway');
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
    //console.log('🖼️ Displaying all outlet SVGs:', { count: this.displayedSvgs.length, total: this.selectedOutletSvgs.length });
    
    if (this.displayedSvgs.length > 0) {
      //console.log('📥 Loading inline SVGs for display:', this.displayedSvgs.length, 'SVGs');
      this.loadInlineSvgs(this.displayedSvgs);   // ✅ Load all SVGs
    } else {
      //console.warn('⚠️ No SVGs to display, selectedOutletSvgs is empty');
      this.svgLoading = false;
      this.svgFailed = true;
      this.floorplansLoaded = true; // Ensure loaded state is set
    }
  }

  applyFilters(shouldAutoSwitch: boolean = true) {
    console.log('🚀 [applyFilters] STARTED:', {
      totalRooms: this.rooms.length,
      currentStatusFilter: this.filters.status,
      hasDate: !!this.selectedStartDate,
      timestamp: new Date().toISOString()
    });

    console.log('🔍 [applyFilters] BEFORE filtering:', {
      totalRooms: this.rooms.length,
      selectedSuites: this.selectedSuites,
      selectedSuitesCount: this.selectedSuites.length
    });

    this.filteredRooms = this.dropdownFilterService.applyFilters(
      this.rooms,
      this.filters,
      this.selectedSuites,
      this.availabilityByRoomId,
      this.selectedStartDate
    );

    console.log('✅ [applyFilters] AFTER filtering:', {
      filteredRoomsCount: this.filteredRooms.length,
      selectedSuites: this.selectedSuites,
      statusFilter: this.filters.status,
      filteredRoomNames: this.filteredRooms.map(r => r.name)
    });

    // Debug: Log filtered rooms when no date is selected
    if (!this.selectedStartDate) {
      console.log('🔍 [DEBUG] No date selected - using today\'s availability:', {
        totalRooms: this.rooms.length,
        filteredRoomsCount: this.filteredRooms.length,
        statusFilter: this.filters.status,
        sampleRoomStatuses: this.rooms.slice(0, 5).map(r => ({ id: r.id, name: r.name, status: r.status })),
        availabilityMapSize: this.availabilityByRoomId.size
      });
    }

    // Metrics reflect effective availability
const getEffectiveStatus = (room: Room): 'Available' | 'Occupied' => {
  if (this.selectedStartDate) {
    // Date is selected - use availability data from API
    const avail = this.availabilityByRoomId.get(room.id);

    // 🔍 DEBUG: Log evaluation for first 3 rooms
    const roomIndex = this.filteredRooms.indexOf(room);
    if (roomIndex >= 0 && roomIndex < 3) {
      console.log(`🎯 Evaluating room ${room.id} (${room.name}):`, {
        availabilityData: avail,
        hasData: avail !== undefined,
        originalStatus: room.status,
        originalStatusType: room.originalStatus
      });
    }

    // If availability data exists, use it
    if (avail !== undefined) {
      // Only respect PERMANENT unavailability
      const isPermanentlyUnavailable = room.originalStatus?.toLowerCase() === 'unavailable';

      if (isPermanentlyUnavailable) {
        console.log(`🔒 Room ${room.id} is permanently unavailable`);
        return 'Occupied';
      }

      // For all other rooms, trust the availability data
      const result = avail === 'free' ? 'Available' : 'Occupied';

      if (roomIndex >= 0 && roomIndex < 3) {
        console.log(`✅ Room ${room.id} final decision: ${result}`);
      }

      return result;
    }

    // No availability data yet - use room's base status as temporary fallback
    // This will be updated once availability API returns data
    return this.toStatusUnion(room.status);
  }

  // No date selected - use room's base status
  return this.toStatusUnion(room.status);
};

    this.Occupied = this.filteredRooms.filter(
      (r) => getEffectiveStatus(r) === 'Occupied'
    ).length;
    this.Available = this.filteredRooms.filter(
      (r) => getEffectiveStatus(r) === 'Available'
    ).length;
    
    // Auto-switch to the floorplan that contains the filtered rooms (only when filters change, not during manual navigation)
    if (shouldAutoSwitch) {
      this.autoSwitchToRelevantFloorplan();
    }
    
    // Re-color after the view updates so <object> is loaded
    // Also re-attach event listeners with updated filteredRooms
    setTimeout(() => {
      // <object>-embedded SVGs
      this.updateSvgColors();
      // Re-attach listeners for object-embedded SVGs
      document.querySelectorAll<HTMLObjectElement>('object[type="image/svg+xml"]').forEach((objectEl) => {
        const doc = objectEl.contentDocument;
        if (doc) {
          this.attachRoomListeners(doc);
        }
      });

      // Inline SVGs - re-attach listeners and update colors
      if (this.svgHosts) {
        this.svgHosts.forEach(hostRef => {
          const rootSvg = hostRef.nativeElement.querySelector('svg') as SVGSVGElement | null;
          if (rootSvg) {
            // Re-attach listeners with updated filteredRooms
            this.attachRoomListenersInline(rootSvg);
            // Update colors
            this.updateSvgColorsInline(rootSvg);
          }
        });
      }
    }, 0);
  }

  // /**
  //  * Automatically switch to the floorplan that contains the most filtered rooms
  //  * This helps users see the relevant floorplan when they apply filters
  //  */
  private autoSwitchToRelevantFloorplan() {
    if (!this.filteredRooms || this.filteredRooms.length === 0) {
      return;
    }

    if (!this.displayedSvgs || this.displayedSvgs.length === 0) {
      return;
    }

    // Group filtered rooms by floor_id
    const roomsByFloorId = new Map<string, Room[]>();
    this.filteredRooms.forEach(room => {
      if (room.floor_id) {
        if (!roomsByFloorId.has(room.floor_id)) {
          roomsByFloorId.set(room.floor_id, []);
        }
        roomsByFloorId.get(room.floor_id)!.push(room);
      }
    });

    if (roomsByFloorId.size === 0) {
      return;
    }

    // Find which floorplan URL corresponds to each floor_id
    const floorplanScores = new Map<number, number>(); // index -> room count
    
    this.displayedSvgs.forEach((url, index) => {
      const floorId = this.extractFloorIdFromUrl(url);
      if (floorId && roomsByFloorId.has(floorId)) {
        const roomCount = roomsByFloorId.get(floorId)!.length;
        floorplanScores.set(index, roomCount);
      }
    });

    if (floorplanScores.size === 0) {
      return;
    }

    // Find the floorplan with the most filtered rooms
    let bestIndex = -1;
    let maxRooms = 0;
    
    floorplanScores.forEach((roomCount, index) => {
      if (roomCount > maxRooms) {
        maxRooms = roomCount;
        bestIndex = index;
      }
    });

    // Switch to the best floorplan if it's different from current
    if (bestIndex >= 0 && bestIndex !== this.currentFloorplanIndex) {
      this.goToFloorplan(bestIndex);
      // After auto-switching, ensure colors are applied with a longer delay to allow SVG to load
      setTimeout(() => {
        this.updateSvgColors();
        if (this.svgHosts) {
          this.svgHosts.forEach(hostRef => {
            const rootSvg = hostRef.nativeElement.querySelector('svg') as SVGSVGElement | null;
            if (rootSvg) {
              this.updateSvgColorsInline(rootSvg);
            }
          });
        }
      }, 300);
    }
  }


  updateSvgColors(svgDoc?: Document) {
    const applyColors = (doc: Document) => {
      this.svgColorService.updateSvgColors(
        doc,
        this.rooms,
        this.filteredRooms,
        this.selectedStartDate,
        this.availabilityByRoomId,
        this.filters.status,
        (status: string) => this.toStatusUnion(status),
        (capacity: number) => this.getPaxColor(capacity)
      );
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

  // Helper function to format status display for popup
  getStatusDisplayText(room: Room, isDateSelected: boolean): string {
    return this.availabilityService.getStatusDisplayText(room, isDateSelected, this.availabilityByRoomId);
  }


  // Get color based on pax capacity (dynamic based on outlet's rooms)
  getPaxColor(capacity: number): string {
    // Use filtered rooms to build dynamic buckets for current outlet
    const roomsForBuckets = this.filteredRooms.length > 0 ? this.filteredRooms : this.rooms;
    return this.colorPaxService.getPaxColor(capacity, roomsForBuckets);
  }

  // Multi-select suite functionality
  toggleSuiteSelection(suiteName: string) {
    const index = this.selectedSuites.indexOf(suiteName);
    const beforeState = [...this.selectedSuites];

    if (index > -1) {
      this.selectedSuites.splice(index, 1);
      console.log(`➖ [Toggle] Removed "${suiteName}"`, {
        before: beforeState,
        after: this.selectedSuites
      });
    } else {
      this.selectedSuites.push(suiteName);
      console.log(`➕ [Toggle] Added "${suiteName}"`, {
        before: beforeState,
        after: this.selectedSuites
      });
    }
    this.applyFilters(); // This will auto-switch to relevant floorplan
  }

  isSuiteSelected(suiteName: string): boolean {
    return this.selectedSuites.includes(suiteName);
  }

  clearSuiteSelection() {
    this.selectedSuites = [];
    this.applyFilters(); // This will auto-switch to relevant floorplan
  }

  // Handle double-click on suite to select it
  onSuiteDoubleClick(room: Room) {
    if (!room || !room.name) return;

    // Close popup if open
    this.closePopup();

    // Toggle suite selection
    this.toggleSuiteSelection(room.name);

    // Show toast notification with total count
    const isSelected = this.isSuiteSelected(room.name);
    const totalSelected = this.selectedSuites.length;
    const message = isSelected
      ? `Suite "${room.name}" selected (${totalSelected} total)`
      : `Suite "${room.name}" deselected (${totalSelected} remaining)`;
    this.toastService.success(message);

    console.log('🎯 [Suite Selection]', {
      action: isSelected ? 'SELECTED' : 'DESELECTED',
      suite: room.name,
      totalSelected: totalSelected,
      allSelected: this.selectedSuites
    });
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
    return this.dropdownFilterService.getOfficeIdFromOutletName(outletName);
  }

  private normalizeId(value: string | undefined | null): string {
    return FloorplanUtils.normalizeId(value);
  }

  private buildRoomIdIndex(): Map<string, Room> {
    return FloorplanUtils.buildRoomIdIndex(this.rooms, (val) => this.normalizeId(val));
  }

  private findRoomElementInDoc(doc: Document, room: Room): Element | null {
    return FloorplanUtils.findRoomElementInDoc(doc, room);
  }

  private getSvgViewBox(
    rootSvg: SVGSVGElement
  ): { x: number; y: number; w: number; h: number } | null {
    return FloorplanUtils.getSvgViewBox(rootSvg);
  }

  private openPopupFromRoom(room: Room, clickEvent?: MouseEvent) {
    // Only open popup if the room is in filteredRooms (i.e., colored)
    if (!this.filteredRooms.includes(room)) {
      return;
    }
    
    this.popupUiService.openPopupFromRoom(
      room,
      clickEvent,
      this.svgHosts,
      this.svgObjects,
      this.panelContainer,
      (rootSvg: SVGSVGElement, room: Room) => this.findRoomElementInline(rootSvg, room),
      (doc: Document, room: Room) => this.findRoomElementInDoc(doc, room),
      (rootSvg: SVGSVGElement) => this.getSvgViewBox(rootSvg),
      (show: boolean, x: number, y: number, selectedRoom: Room) => {
        this.showPopup = show;
        this.popupX = x;
        this.popupY = y;
        this.selectedRoom = selectedRoom;
      }
    );
  }
  

async downloadFloorplanWithDetails(format: 'svg' | 'png' = 'svg') {
  await this.downloadService.downloadFloorplanWithDetails(
    format,
    this.svgObjects,
      this.selectedRoom,
      this.objectToOriginalViewBox,
      (doc, room) => this.findRoomElementInDoc(doc, room)
    );
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

    /*console.log('[Floorplan] popup opened (click)', {
      OutletID: room.outlet,
      ID: room.id,
      room: room.name,
      x: this.popupX,
      y: this.popupY,
    });*/
  }

  closePopup() {
    this.showPopup = false;
    this.selectedRoom = null;
  }

  // Handle floorplan container clicks
  onFloorplanContainerClick(event: MouseEvent) {
    // Close popup when clicking on container background (but not on SVG elements)
    const target = event.target as HTMLElement;
    // Only close if clicking directly on the container, not on SVG or its children
    if (target.classList.contains('floorplan-container') || target.tagName === 'DIV') {
      // Check if click is on SVG or its children
      const svgElement = target.closest('svg') || (target as any).querySelector?.('svg');
      if (!svgElement) {
        this.closePopup();
      }
    }
  }

  // Open YouTube link in new tab
  openYouTubeLink(room: Room) {
    this.youtubeLinksService.openYouTubeLink(room);
  }

  // Download current outlet's SVG
  downloadFloorplan() {
    this.downloadService.downloadFloorplan(this.selectedOutletSvgs, this.sanitizer);
  }

  // Refresh rooms and reapply filters
  refreshFloorplan() {
    // Reset all filter selections to default values  < sini
    this.filters = {
      outlet: 'Select Outlet',
      status: 'Select Status',
      pax: 'Select Pax',
      svg: 'all',
    };
    this.selectedEndDate = '';
    this.availabilityByRoomId.clear();
    this.selectedSuites = [];

    // Clear room data to ensure counters reset to 0
    this.rooms = [];
    this.filteredRooms = [];

    //Reset counters
    this.Available = 0;
    this.Occupied = 0;

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
    this.showDownloadMenu = false;

    if (!this.selectedOutletSvgs || this.selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to export.');
      return;
    }

    this.isExportingFloorplan = true;

    try {
      const svgHosts = this.svgHosts?.toArray?.() ?? [];
      
      if (svgHosts.length === 0) {
        console.warn('❌ No SVG hosts found for PDF export');
        this.showMessage('No floorplan data available for export', true);
        return;
      }

      // Get dynamic buckets and color map for current outlet (from /resources pax_size data)
      const dynamicBuckets = this.paxBuckets;
      let paxBucketColorMap: Map<number, string> | undefined;
      if (this.rooms && this.rooms.length > 0) {
        const { colorMap } = this.colorPaxService.buildDynamicBuckets(this.rooms);
        paxBucketColorMap = colorMap;
      }
      
      const pdf = await this.pdfExportService.exportFloorplanAsPdf({
        svgHosts,
        rooms: this.rooms,
        filteredRooms: this.filteredRooms,
        selectedSuites: this.selectedSuites,
        filters: this.filters,
        selectedStartDate: this.selectedStartDate,
        selectedEndDate: this.selectedEndDate,
        displayedSvgs: this.displayedSvgs,
        availabilityByRoomId: this.availabilityByRoomId,
        paxPalette: this.paxPalette,
        paxBuckets: dynamicBuckets, // Use dynamic buckets based on outlet's pax groups
        paxBucketColorMap: paxBucketColorMap, // Color mapping for dynamic buckets
        toStatusUnion: (status: string) => this.toStatusUnion(status),
        getFloorLabel: (path: string) => this.getFloorLabel(path),
        findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => this.findRoomElementInline(rootSvg, room),
        hexToRgb: (hex: string) => this.hexToRgb(hex),
        floorIdToFloorMap: this.floorIdToFloorMap,
        pdfQuality: this.pdfQuality
      });

      // Get outlet display name instead of ID for filename
      let outletName = 'all';
      if (this.filters.outlet && this.filters.outlet !== 'Select Outlet') {
        const selectedOffice = this.officeService.getOffices().find(office => office.id === this.filters.outlet);
        outletName = selectedOffice ? selectedOffice.displayName : this.filters.outlet;
      }

      let fileName = `floorplan-${outletName}.pdf`;
      this.pdfExportService.savePdfSmart(pdf, fileName);

      this.showMessage(`Floorplan PDF exported successfully! 🎉`);
    } catch (error) {
      console.error('Error exporting floorplan as PDF:', error);
      this.showMessage('Failed to export floorplan PDF. Please try again.', true);
    } finally {
      this.isExportingFloorplan = false;
    }
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
  }

  // Get compact mode status
  isCompactMode(): boolean {
    return this.compactMode;
  }

  // Convert hex color to RGB for jsPDF
  private hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    return this.colorPaxService.hexToRgb(hex);
  }

  getFloorLabel(path: string): string {
    // First, try to extract floor_id from URL and use floor_no from floors API
    const floorId = this.extractFloorIdFromUrl(path);
    if (floorId === '6348ba804d92f2ab589dc7e3' || path.includes('6348ba804d92f2ab589dc7e3')) {
      return 'Sibelco Office';
    }
    if (floorId) {
      const floor = this.floorIdToFloorMap.get(floorId);
      if (floor && floor.floor_no) {
        // Remove "L" prefix if present and format as "Level {number}"
        // e.g., "L12" -> "Level 12", "L3A" -> "Level 3A"
        const floorNo = floor.floor_no.trim();
        const floorNumber = floorNo.startsWith('L') || floorNo.startsWith('l') 
          ? floorNo.substring(1).trim() 
          : floorNo;
        return `Level ${floorNumber}`;
      }
    }
    // Fallback to original logic if floor_id not found or floor_no not available
  return FloorplanUtils.getFloorLabel(path, this.filters.outlet, this.floorLabelOverrides);
  }

  /**
   * Extract floor_id from a floorplan URL
   * URLs can be in formats like:
   * - Firebase Storage: https://firebasestorage.googleapis.com/v0/b/bucket/o/officeId%2FfloorId%2Ffilename.svg?alt=media&token=...
   * - Backend API: /api/floorplans/officeId/floorId?raw=1
   * - Signed URLs with encoded paths
   */
  private extractFloorIdFromUrl(url: string): string | null {
    if (!url) return null;

    try {
      // Decode URL-encoded paths
      let decodedUrl = url;
      try {
        decodedUrl = decodeURIComponent(url);
      } catch (e) {
        // If decoding fails, use original URL
      }

      // Try to extract from URL path structure: officeId/floorId/filename
      // Check for backend API format: /api/floorplans/officeId/floorId
      const apiMatch = decodedUrl.match(/\/api\/floorplans\/[^\/]+\/([0-9a-f]{24})(?:\/|\?|$)/i);
      if (apiMatch && apiMatch[1]) {
        return apiMatch[1];
      }

      // Check for Firebase Storage URL format with encoded path
      // Format: /o/officeId%2FfloorId%2Ffilename.svg or /o/officeId/floorId/filename.svg
      const firebaseEncodedMatch = decodedUrl.match(/\/o\/([^\/\?]+)/);
      if (firebaseEncodedMatch && firebaseEncodedMatch[1]) {
        const path = firebaseEncodedMatch[1];
        const parts = path.split(/[\/%2F]/).filter(p => p.length > 0);
        if (parts.length >= 2) {
          // parts[0] = officeId, parts[1] = floorId
          // Check if parts[1] looks like a floor_id (MongoDB ObjectId format)
          const potentialFloorId = parts[1];
          if (/^[0-9a-f]{24}$/i.test(potentialFloorId)) {
            return potentialFloorId;
          }
        }
      }

      // Check for direct path format (if URL contains the path directly)
      // Pattern: /officeId/floorId/ or officeId/floorId/
      const pathMatch = decodedUrl.match(/\/([0-9a-f]{24})\/([0-9a-f]{24})(?:\/|\?|$)/i);
      if (pathMatch && pathMatch[2]) {
        return pathMatch[2];
      }

      // Try to match floor_id from rooms that have this URL in their SVG
      // This is a fallback if URL structure doesn't contain floor_id directly
      if (this.rooms && this.rooms.length > 0) {
        // Normalize URLs for comparison (remove query params, decode)
        const normalizeForComparison = (u: string) => {
          try {
            return decodeURIComponent(u.split('?')[0].toLowerCase());
          } catch {
            return u.split('?')[0].toLowerCase();
          }
        };
        
        const normalizedUrl = normalizeForComparison(url);
        
        // Check if any room's SVG matches this URL
        for (const room of this.rooms) {
          if (room.svg && room.floor_id) {
            const svgArray = Array.isArray(room.svg) ? room.svg : [room.svg];
            for (const svg of svgArray) {
              const normalizedSvg = normalizeForComparison(svg);
              // Check if URLs match (either exact or one contains the other)
              if (normalizedUrl === normalizedSvg || 
                  normalizedUrl.includes(normalizedSvg) || 
                  normalizedSvg.includes(normalizedUrl)) {
                return room.floor_id;
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error extracting floor_id from URL:', url, error);
    }

    return null;
  }


  // Returns a normal YouTube "watch" URL for the given room (if present)
  getYouTubeWatchUrlFor(room: Room | null | undefined): string | null {
    return this.youtubeLinksService.getYouTubeWatchUrlFor(room);
  }

  // Get all rooms that have YouTube links
  getRoomsWithYouTubeLinks(): Room[] {
    return this.youtubeLinksService.getRoomsWithYouTubeLinks(this.rooms);
  }

  // Get count of rooms with YouTube links
  getYouTubeLinkCount(): number {
    return this.youtubeLinksService.getYouTubeLinkCount(this.rooms);
  }

  private async loadInlineSvgs(urls: string[]) {
    this.svgLoading = true;
    await this.svgLoaderService.loadInlineSvgs(
      urls,
      this.svgHtmlMap,
      () => {
        this.svgLoading = false;
        this.floorplansLoaded = true;
        setTimeout(() => this.attachAndColorAllInline(), 0);
      }
    );
  }

  private attachAndColorAllInline() {
    /*console.log('🔗 attachAndColorAllInline called, svgHosts count:', this.svgHosts?.length || 0);
    console.log('🎯 Current floorplan for display:', this.currentFloorplan);
    console.log('🔑 Normalized key:', currentKey);
    console.log('📊 SVG HTML Map size:', this.svgHtmlMap.size);*/
    // console.log('📋 SVG HTML Map keys:', Array.from(this.svgHtmlMap.keys()));
    // console.log('🔍 Has current key?', currentKey ? this.svgHtmlMap.has(currentKey) : false);*/
    
    if (!this.svgHosts) {
      //console.log('❌ No svgHosts found');
      return;
    }

    // For each inlined SVG root, run listeners + color
    this.svgHosts.forEach((hostRef) => {
      const host = hostRef.nativeElement;
      // console.log(`🔗 Processing host ${index}:`, host);
      // console.log(`🔗 Host innerHTML length:`, host.innerHTML?.length || 0);
      
      const rootSvg = host.querySelector('svg') as SVGSVGElement | null;
      if (!rootSvg) {
        // console.log(`❌ No SVG found in host ${index}`);
        return;
      }

      // Check if SVG has room elements
      
      // Attach click handlers on this inline SVG
      this.attachRoomListenersInline(rootSvg);

      // Color rooms on this inline SVG
      this.updateSvgColorsInline(rootSvg);
    });
  }

  private attachRoomListenersInline(rootSvg: SVGSVGElement) {
    this.svgEventsService.attachRoomListenersInline(
      rootSvg,
      this.rooms,
      this.roomIdIndex,
      (val) => this.normalizeId(val),
      (room, event) => this.openPopupFromRoom(room, event),
      () => this.closePopup(),
      (rootSvg, room) => this.findRoomElementInline(rootSvg, room),
      this.filteredRooms,
      (room) => this.onSuiteDoubleClick(room)
    );
  }

  private findRoomElementInline(rootSvg: SVGSVGElement, room: Room): Element | null {
    return FloorplanUtils.findRoomElementInline(rootSvg, room);
  }

  private updateSvgColorsInline(rootSvg: SVGSVGElement) {
    this.svgColorService.updateSvgColorsInline(
      rootSvg,
      this.rooms,
      this.filteredRooms,
      this.selectedStartDate,
      this.availabilityByRoomId,
      this.filters.status,
      (status: string) => this.toStatusUnion(status),
      (capacity: number) => this.getPaxColor(capacity),
      (rootSvg: SVGSVGElement, room: Room) => this.findRoomElementInline(rootSvg, room)
    );
  }

}