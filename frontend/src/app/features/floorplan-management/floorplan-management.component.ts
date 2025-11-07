import {
  Component,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormGroup,
  FormsModule,
} from '@angular/forms';
import { HttpClientModule } from '@angular/common/http'; 
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { OfficeService } from '../../core/services/office.service';
import { FloorService } from '../../core/services/floor.service';
import { BQService, UploadResponse } from './bq.service';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { Router, RouterLink } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs'; 


type Option = { label: string; value: string };

@Component({
  selector: 'app-floorplan-upload',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, FormsModule],
  templateUrl: './floorplan-management.component.html',
})
export class FloorplanManagementComponent implements OnInit {
  uploading = signal(false);
  progress = signal(0);
  result = signal<UploadResponse | null>(null);
  errorMsg = signal<string | null>(null);

  selectedOffice: string = '';
  selectedFloor: string = '';
  safeSvgUrl?: SafeResourceUrl;
  svgHtml?: SafeResourceUrl;
  error = '';
  loading = false;
  // Multiple SVG support (like floorplan.component.ts)
  selectedOutletSvgs: string[] = [];
  displayedSvgs: string[] = [];
  svgHtmlMap = new Map<string, SafeHtml>(); // Store SafeHtml for [innerHTML] binding
  currentFloorplanIndex = 0;

  form: FormGroup;

  // Dropdown options
  locations: Option[] = [];
  floors: Option[] = [];
  filteredFloors: Option[] = []; // Floors filtered by selected outlet

  // Overview statistics
  overviewStats = {
    totalOutlets: 0,
    outletsWithFloorplans: 0,
    totalFloorplans: 0,
    loading: true
  };

  // Tab management
  activeTab: 'overview' | 'upload' = 'overview';

    sidebarCollapsed = true;  // start hidden

  toggleSidebar() {
  this.sidebarCollapsed = !this.sidebarCollapsed;
}

  constructor(
    private fb: FormBuilder,
    private uploader: BQService,
    private sanitizer: DomSanitizer,
    private officeService: OfficeService,
    private floorService: FloorService,
    private http: HttpClient,
    private router: Router
    
  ) {
    this.form = this.fb.group({
      officeId: ['', Validators.required],
      floorId: [''], // optional
      fileName: [''], // optional
      file: [null as File | null, Validators.required],
    });
  }
  //Navigate back to dashboard
   goBackToDashboard(): void {
    this.router.navigate(['/floorplan']);
  }

  ngOnInit(): void {
    this.loadDropdown();
    this.loadOverviewStats();
  }

  loadOverviewStats() {
    this.overviewStats.loading = true;
    
    // Get total outlets from BigQuery and floorplans from Firebase
    this.officeService.loadOffices().subscribe({
      next: (officeResponse) => {
        console.log('Office response:', officeResponse);
        const totalOutlets = officeResponse.success && officeResponse.data ? officeResponse.data.length : 0;
        console.log('Total outlets from BigQuery:', totalOutlets);
        
        // Get all floorplans from Firebase
        this.uploader.getAllFloorplans().subscribe({
          next: (floorplans: any[]) => {
            console.log('Floorplans data:', floorplans);
            console.log('Number of outlets with floorplans:', floorplans.length);
            
            // Calculate statistics
            const outletsWithFloorplans = floorplans.length;
            let totalFloorplans = 0;
            
            floorplans.forEach(outlet => {
              console.log('Outlet:', outlet.officeId, 'has officeSvg:', !!outlet.officeSvg, 'floors:', outlet.floors?.length || 0);
              // Count office-level SVG
              if (outlet.officeSvg) {
                totalFloorplans++;
              }
              // Count floor-level SVGs
              if (outlet.floors && outlet.floors.length > 0) {
                totalFloorplans += outlet.floors.length;
              }
            });
            
            this.overviewStats = {
              totalOutlets,
              outletsWithFloorplans,
              totalFloorplans,
              loading: false
            };
            
            console.log('Final overview stats:', this.overviewStats);
          },
          error: (err) => {
            console.error('Error loading floorplans:', err);
            this.overviewStats = {
              totalOutlets,
              outletsWithFloorplans: 0,
              totalFloorplans: 0,
              loading: false
            };
          }
        });
      },
      error: (err) => {
        console.error('Error loading offices:', err);
        this.overviewStats.loading = false;
      }
    });
  }

  loadDropdown() {
    console.log('Loading dropdown data...');
    
    // Load offices using OfficeService
    this.officeService.loadOffices().subscribe({
      next: (response) => {
        console.log('Office service response:', response);
        console.log('Response success:', response.success);
        console.log('Response data:', response.data);
        console.log('Response data length:', response.data?.length);
        
        if (response.success && response.data && response.data.length > 0) {
          this.locations = response.data
            .filter(office => {
              // Only include offices that have both a valid name and ID
              const hasValidName = office.displayName || office.name;
              const hasValidId = office.id;
              console.log('Office validation:', { 
                office, 
                hasValidName: !!hasValidName, 
                hasValidId: !!hasValidId 
              });
              return hasValidName && hasValidId;
            })
            .map(office => {
              console.log('Mapping valid office:', office);
              return {
                label: office.displayName || office.name,
                value: office.id
              };
            });
          console.log('Mapped locations:', this.locations);
        } else {
          console.warn('No office data received or success=false');
          console.warn('Response details:', { success: response.success, dataLength: response.data?.length });
          this.locations = [];
        }
      },
      error: (err) => {
        console.error('Error loading offices:', err);
        console.error('Error details:', err.status, err.statusText, err.url);
        this.locations = [];
      }
    });

    // Load floors using FloorService
    console.log('Calling floorService.getFloors()...');
    this.floorService.getFloors().subscribe({
      next: (floors) => {
        console.log('Floor service response:', floors);
        console.log('Floors array length:', floors?.length || 0);
        console.log('First floor object:', floors?.[0]);
        
        if (floors && floors.length > 0) {
          this.floors = floors.map(floor => ({
            label: floor.floor_no,
            value: floor.floor_id
          }));
          console.log('Mapped floors:', this.floors);
        } else {
          console.warn('No floors data received or empty array');
          this.floors = [];
        }
      },
      error: (err) => {
        console.error('Error loading floors:', err);
        console.error('Error details:', err.status, err.statusText, err.url);
        this.floors = [];
      }
    });

  }

  onFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] || null;

    if (!file) return;

    const isSvg =
      file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    if (!isSvg) {
      this.form.patchValue({ file: null });
      input.value = '';
      this.errorMsg.set('Only SVG files are allowed.');
      console.warn('❌ Rejected non-SVG file:', file.name, file.type);
      return;
    }

    this.errorMsg.set(null);
    this.form.patchValue({ file });
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      console.warn('⚠️ Form invalid:', this.form.value);
      return;
    }

    const { officeId, floorId, fileName, file, overwrite } = this.form.value as {
      officeId: string;
      floorId: string;
      fileName?: string;
      file: File;
      overwrite?: boolean;
    };

    this.uploading.set(true);
    this.progress.set(0);
    this.result.set(null);
    this.errorMsg.set(null);

    console.log('🚀 Starting upload with params:', {
      officeId,
      floorId,
      fileName: fileName || undefined,
      overwrite: !!overwrite,
      fileSize: file.size,
      fileType: file.type,
      originalFileName: file.name
    });

    this.uploader
      .uploadFloorplan({
        officeId,
        floorId,
        file,
        fileName: fileName || undefined,
        overwrite: !!overwrite,
      })
      .subscribe({
        next: (state) => {
          this.progress.set(state.progress);
          if (state.done && state.data) {
            this.result.set(state.data);
            this.uploading.set(false);
          }
        },
        error: (err) => {
          console.error('❌ Upload error:', err);
          console.error('❌ Upload error details:', {
            status: err.status,
            statusText: err.statusText,
            url: err.url,
            error: err.error,
            message: err.message,
            name: err.name,
            stack: err.stack
          });
          this.uploading.set(false);
          this.errorMsg.set(
            err?.error?.error || err?.message || 'Upload failed.'
          );
        },
      });
  }

  // removed unused toStorageUrl helper

  onSelected() {
    if (!this.selectedOffice) {
      console.log('❌ No office selected, skipping floorplan load');
      return;
    }
    
    this.loading = true;
    this.error = '';

    const floor = this.selectedFloor || undefined;
    console.log('🔍 Loading floorplan for office:', this.selectedOffice, 'floor:', floor);
    
    // Use the same pattern as floorplan.component.ts - try getAllSvgFilesForOutlet first
    if (!floor) {
      // Case 1: No floor selected - get all outlet SVGs (same as floorplan.component.ts)
      this.floorService.getAllSvgFilesForOutlet(this.selectedOffice).pipe(
        catchError((error: any) => {
          // Only log as error if it's not a 404
          if (error?.status !== 404) {
            console.error('❌ Error loading outlet SVGs:', error);
            this.error = 'Failed to load floorplan SVGs';
          }
          return of<string[]>([]);
        })
      ).subscribe((svgs: string[]) => {
        if (svgs && svgs.length > 0) {
          this.selectedOutletSvgs = svgs;
          this.displayedSvgs = svgs.slice();
          this.currentFloorplanIndex = 0;
          this.loadInlineSvgs(svgs);
          this.loading = false;
        } else {
          // Try fallback to office-level cloud SVGs
          this.tryOfficeLevelFallbackForManagement();
        }
      });
    } else {
      // Case 2: Specific floor selected - get floor SVGs
      this.floorService.getFloorplanUrls(this.selectedOffice, floor).pipe(
        catchError((err: any) => {
          // 404 is expected for floors without SVGs
          if (err?.status !== 404) {
            console.error('Error loading floor SVG:', err);
            this.error = 'Failed to load floor SVG';
          }
          this.loading = false;
          return of<string[]>([]);
        })
      ).subscribe((urls: string[]) => {
        if (urls && urls.length > 0) {
          this.selectedOutletSvgs = urls;
          this.displayedSvgs = urls;
          this.currentFloorplanIndex = 0;
          this.loadInlineSvgs(urls);
        } else {
          this.error = 'No floorplan found for this floor.';
          this.displayedSvgs = [];
          this.selectedOutletSvgs = [];
          this.updateCurrentSvgDisplay();
        }
        this.loading = false;
      });
    }
  }

  private tryOfficeLevelFallbackForManagement() {
    const selectedOffice = this.officeService.getOffices().find(o => o.id === this.selectedOffice);
    if (!selectedOffice) {
      this.error = 'No floorplan found for this outlet.';
      this.loading = false;
      return;
    }

    const officeSvgs = selectedOffice?.svg;
    const normalizeArray = (value: string | string[] | undefined): string[] => 
      Array.isArray(value) ? value : (value ? [value] : []);
    const isCloudUrl = (u: string) => 
      typeof u === 'string' && !u.startsWith('assets/') && (u.startsWith('https://') || u.startsWith('http://'));

    const cloudSvgs = normalizeArray(officeSvgs).filter(isCloudUrl);
    
    if (cloudSvgs.length > 0) {
      this.selectedOutletSvgs = cloudSvgs;
      this.displayedSvgs = cloudSvgs;
      this.currentFloorplanIndex = 0;
      this.loadInlineSvgs(cloudSvgs);
      this.loading = false;
    } else {
      this.error = 'No floorplan found for this outlet.';
      this.displayedSvgs = [];
      this.selectedOutletSvgs = [];
      this.updateCurrentSvgDisplay();
      this.loading = false;
    }
  }

  private loadInlineSvg(url: string) {
    // Reset previous displays
    this.safeSvgUrl = undefined;
    this.svgHtml = undefined;
    
    // Add authentication token to request
    const token = sessionStorage.getItem('userAccessToken') || '';
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    
    this.http.get(url, { responseType: 'text', headers }).subscribe({
      next: (svgText) => {
        console.log('✅ Single SVG loaded successfully:', url);
        // Basic responsive attributes
        try {
          const temp = document.createElement('div');
          temp.innerHTML = svgText;
          const svg = temp.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', 'auto');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            if (!svg.getAttribute('viewBox')) {
              const w = svg.getAttribute('width') || '1000';
              const h = svg.getAttribute('height') || '1000';
              svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
            this.svgHtml = this.sanitizer.bypassSecurityTrustHtml(temp.innerHTML);
          } else {
            // Fallback to direct URL if not valid SVG
            this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          }
        } catch {
          this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        }
        this.loading = false;
      },
      error: (e) => {
        console.error('Inline SVG fetch failed, falling back to direct URL', e);
        this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        this.loading = false;
      }
    });
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

  // Multiple SVG support methods (like floorplan.component.ts)
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
    
    if (toFetch.length === 0) {
      // If everything already cached, still process
      setTimeout(() => {
        this.loading = false;
        this.updateCurrentSvgDisplay();
      }, 100);
      return;
    }

    // Track completed requests
    let completedRequests = 0;
    const totalRequests = toFetch.length;

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
      // Add authentication token to request
      const token = sessionStorage.getItem('userAccessToken') || '';
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      
      this.http.get(normalizedUrl, { responseType: 'text', headers }).subscribe({
        next: (svgText) => {
          console.log('✅ SVG loaded successfully:', originalUrl);
          // Process SVG for compact display
          const processedSvgText = this.processSvgForCompactDisplay(svgText);
          const safe = this.sanitizer.bypassSecurityTrustHtml(processedSvgText);
          // Store using normalized key (without query params) for consistent lookup
          const key = this.normalizeUrlKey(originalUrl);
          this.svgHtmlMap.set(key, safe);
          console.log('✅ SVG stored with key:', key, 'Map keys:', Array.from(this.svgHtmlMap.keys()));

          completedRequests++;
          
          // Only hide loading when ALL SVGs are loaded
          if (completedRequests === totalRequests) {
            setTimeout(() => {
              this.loading = false;
              this.updateCurrentSvgDisplay();
              console.log('✅ All SVGs loaded, updated display');
            }, 200);
          }
        },
        error: (err) => {
          console.error('❌ Failed to fetch SVG:', originalUrl, err);
          console.error('Error details:', {
            status: err.status,
            statusText: err.statusText,
            url: err.url,
            error: err.error
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
          
          // More specific error messages
          if (err.status === 401) {
            this.error = 'Authentication failed. Please refresh the page and try again.';
          } else if (err.status === 404) {
            this.error = 'Floorplan not found. Please check if the SVG file exists.';
          } else if (err.status === 403) {
            this.error = 'Access denied. You may not have permission to view this floorplan.';
          } else {
            this.error = `Failed to load floorplan SVG (${err.status}: ${err.statusText})`;
          }
          
          completedRequests++;
          
          // Hide loading even if some requests fail
          if (completedRequests === totalRequests) {
            this.loading = false;
            this.updateCurrentSvgDisplay();
            console.log('⚠️ Some SVGs failed to load, but updated display with available ones');
          }
        }
      });
    });

    // SVG loading timeout (5 seconds)
    setTimeout(() => {
      if (this.loading) {
        console.warn('SVG loading timeout');
        this.loading = false;
        this.error = 'SVG loading timed out. Please try again.';
        this.updateCurrentSvgDisplay();
      }
    }, 5000);
  }

  private updateCurrentSvgDisplay() {
    // Only reset if we're in multiple SVG mode (have displayedSvgs)
    // Don't clear if we're in single SVG mode (loadInlineSvg sets svgHtml directly)
    if (this.displayedSvgs.length > 0) {
      this.safeSvgUrl = undefined;
      this.svgHtml = undefined;
    }

    if (this.displayedSvgs.length > 0 && this.currentFloorplan) {
      const currentUrl = this.currentFloorplan;
      const key = this.normalizeUrlKey(currentUrl);
      const cachedSvg = this.svgHtmlMap.get(key);
      
      console.log('🔍 updateCurrentSvgDisplay:', {
        currentUrl,
        key,
        hasCachedSvg: !!cachedSvg,
        mapKeys: Array.from(this.svgHtmlMap.keys())
      });
      
      if (cachedSvg) {
        // Use the cached SVG from map (preferred method for multiple SVGs)
        // Set svgHtml for template compatibility
        this.svgHtml = cachedSvg;
        console.log('✅ Displaying cached SVG for:', currentUrl, 'key:', key);
      } else {
        console.log('⚠️ No cached SVG found for:', currentUrl, 'key:', key);
        // Fallback to direct URL if not yet loaded
        this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(currentUrl);
      }
    } else if (this.displayedSvgs.length === 0) {
      // Only clear if we truly have nothing to display
      this.safeSvgUrl = undefined;
      this.svgHtml = undefined;
      console.log('⚠️ No floorplan to display:', { 
        displayedSvgsLength: this.displayedSvgs.length, 
        currentFloorplan: this.currentFloorplan 
      });
    }
  }

  private processSvgForCompactDisplay(svgText: string): string {
    // Create a temporary DOM element to parse the SVG
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svgText;
    const svgElement = tempDiv.querySelector('svg');
    
    if (!svgElement) return svgText;

    // Set responsive attributes for display
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', 'auto');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.setAttribute('style', 'max-width: 100%; height: auto; display: block;');
    
    // Ensure viewBox is set for proper scaling
    if (!svgElement.getAttribute('viewBox')) {
      const width = svgElement.getAttribute('width') || '1000';
      const height = svgElement.getAttribute('height') || '1000';
      svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    return tempDiv.innerHTML;
  }

  // Tab management
  setActiveTab(tab: 'overview' | 'upload') {
    this.activeTab = tab;
  }

  // Multiple SVG navigation methods (like floorplan.component.ts)
  get totalFloorplans(): number {
    return this.displayedSvgs.length;
  }

  get hasNextFloorplan(): boolean {
    return this.currentFloorplanIndex < this.totalFloorplans - 1;
  }

  get hasPreviousFloorplan(): boolean {
    return this.currentFloorplanIndex > 0;
  }

  get currentFloorplan(): string | null {
    if (!this.displayedSvgs || this.displayedSvgs.length === 0) {
      return null;
    }
    return this.displayedSvgs[this.currentFloorplanIndex] || null;
  }

  nextFloorplan() {
    if (this.hasNextFloorplan) {
      this.currentFloorplanIndex++;
      console.log('➡️ Next floorplan:', this.currentFloorplanIndex, 'of', this.totalFloorplans);
      this.updateCurrentSvgDisplay();
    }
  }

  previousFloorplan() {
    if (this.hasPreviousFloorplan) {
      this.currentFloorplanIndex--;
      console.log('⬅️ Previous floorplan:', this.currentFloorplanIndex, 'of', this.totalFloorplans);
      this.updateCurrentSvgDisplay();
    }
  }

  goToFloorplan(index: number) {
    if (index >= 0 && index < this.totalFloorplans) {
      this.currentFloorplanIndex = index;
      console.log('🎯 Go to floorplan:', index, 'of', this.totalFloorplans);
      this.updateCurrentSvgDisplay();
    }
  }

  // Refresh data
  refreshData() {
    console.log('🔄 Refreshing page to default state');
    // Reset selections & viewer
    this.selectedOffice = '';
    this.selectedFloor = '';
    this.safeSvgUrl = undefined;
    this.svgHtml = undefined;
    this.error = '';
    this.loading = false;

    // Reset multiple SVG support
    this.selectedOutletSvgs = [];
    this.displayedSvgs = [];
    this.svgHtmlMap.clear();
    this.currentFloorplanIndex = 0;

    // Reset dropdown sources
    this.locations = [];
    this.floors = [];
    this.filteredFloors = [];

    // Reset form
    this.form.reset({ officeId: '', floorId: '', fileName: '', file: null });
    this.form.markAsPristine();
    this.form.markAsUntouched();

    // Default to overview tab
    this.activeTab = 'overview';

    // Reload data
    this.loadDropdown();
    this.loadOverviewStats();
  }

  // Helper methods for template
  getSelectedOfficeLabel(): string {
    if (!this.selectedOffice) return 'No Outlet Selected';
    const office = this.locations.find(l => l.value === this.selectedOffice);
    return office?.label || 'Selected Outlet';
  }


  // Debug method to help troubleshoot SVG loading issues
  debugSvgLoading() {
    console.log('🔍 SVG Loading Debug Info:');
    console.log('- Selected Office:', this.selectedOffice);
    console.log('- Selected Floor:', this.selectedFloor);
    console.log('- Loading State:', this.loading);
    console.log('- Error State:', this.error);
    console.log('- Selected Outlet SVGs:', this.selectedOutletSvgs);
    console.log('- Displayed SVGs:', this.displayedSvgs);
    console.log('- Current Floorplan Index:', this.currentFloorplanIndex);
    console.log('- Current Floorplan URL:', this.currentFloorplan);
    console.log('- SVG HTML Map Size:', this.svgHtmlMap.size);
    console.log('- Safe SVG URL:', this.safeSvgUrl);
    console.log('- SVG HTML:', this.svgHtml);
    console.log('- User Token:', sessionStorage.getItem('userAccessToken') ? 'Present' : 'Missing');
  }

  // Firebase URL normalization (same as floorplan.component.ts)
  private async normalizeToDownloadUrl(url: string): Promise<string> {
    try {
      if (!url) return url;

      // Already a Firebase download URL
      if (url.includes('firebasestorage.googleapis.com/v0/b/')) return url;

      // gs://bucket/path.svg  -> downloadURL
      if (url.startsWith('gs://')) {
        const withoutScheme = url.slice('gs://'.length);          // bucket/path
        const firstSlash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, firstSlash);
        const objectPath = withoutScheme.slice(firstSlash + 1);
        const storage = getStorage(undefined, `gs://${bucket}`);
        return await getDownloadURL(ref(storage, objectPath));
      }

      // https://storage.googleapis.com/bucket/path.svg -> downloadURL
      const m = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
      if (m) {
        const [, bucket, objectPath] = m;
        const storage = getStorage(undefined, `gs://${bucket}`);
        return await getDownloadURL(ref(storage, objectPath));
      }

      // Anything else: return as-is
      return url;
    } catch (err) {
      console.warn('⚠️ normalizeToDownloadUrl failed:', url, err);
      return url; // Return original URL on error
    }
  }

  onOutletSelected() {
    console.log('🏢 Outlet selected:', this.selectedOffice);
    console.log('🏢 Selected office value:', this.selectedOffice);
    
    // Clear selected floor when outlet changes
    this.selectedFloor = '';
    this.form.patchValue({ floorId: '' });
    
    // Clear previous floorplan
    this.safeSvgUrl = undefined;
    this.error = '';
    
    // Filter floors based on selected outlet
    this.filterFloorsByOutlet(this.selectedOffice);
    
    // Load floorplan for the outlet
    if (this.selectedOffice) {
      this.onSelected();
    }
  }

  onUploadOutletSelected() {
    const selectedOfficeId = this.form.get('officeId')?.value;
     console.log('🏢 Upload outlet selected - Outlet ID:', selectedOfficeId);
    
    // Clear selected floor when outlet changes
    this.form.patchValue({ floorId: '' });
    
    // Filter floors based on selected outlet for upload form
    if (selectedOfficeId) {
      this.filterFloorsByOutlet(selectedOfficeId);
    } else {
      this.filteredFloors = [];
    }
  }

  onUploadFloorSelected() {
    // Use setTimeout to ensure the form value is updated
    setTimeout(() => {
      const selectedOfficeId = this.form.get('officeId')?.value;
      const selectedFloorId = this.form.get('floorId')?.value;
      console.log('🏢 Upload floor selected - Outlet ID:', selectedOfficeId, 'Floor ID:', selectedFloorId);
    }, 0);
  }

  filterFloorsByOutlet(officeId: string) {
    if (!officeId) {
      this.filteredFloors = [];
      return;
    }
    console.log('🔍 Filtering floors for outlet:', officeId);
    
    // Get floors for this specific outlet
    this.floorService.getFloors().subscribe({
      next: (floors) => {
        console.log('🏢 All floors:', floors);
        // Filter floors by location_id
        const filteredFloors = floors.filter(floor => floor.location_id === officeId);
        console.log('🏢 Floors for outlet:', filteredFloors);
        
        if (filteredFloors.length === 0) {
          console.log('⚠️ No floors found for outlet, showing all floors as fallback');
          // Fallback: show all floors if no specific floors found
          this.filteredFloors = floors.map(floor => ({
            label: floor.floor_no,
            value: floor.floor_id
          }));
        } else {
          this.filteredFloors = filteredFloors.map(floor => ({
            label: floor.floor_no,
            value: floor.floor_id
          }));
        }
        console.log('📋 Filtered floors:', this.filteredFloors);
      },
      error: (err) => {
        console.error('Error loading floors for outlet:', err);
        this.filteredFloors = [];
      }
    });
  }

  getSelectedFloorLabel(): string {
    if (!this.selectedFloor) return '';
    const floor = this.floors.find(f => f.value === this.selectedFloor);
    return floor?.label || 'Selected Floor';
  }

}