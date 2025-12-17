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
import { FloorplanDeleteService } from './floorplan-delete.service';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service'; 


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
  mobileOpen = false;

  // Delete confirmation modal state
  showDeleteModal = false;
  deleteTarget: { officeId: string; floorId: string; label: string } | null = null;
  isDeleting = false;

  // Drag and drop state
  draggedIndex: number | null = null;
  showFloorplanList = false; // Collapse/expand state for floorplan list
  hasUnsavedChanges = false; // Track if order has changed
  isSavingOrder = false; // Track saving state

  // Guidelines modal state
  showGuidelinesModal = false;

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  closeMobile() {
    this.mobileOpen = false;
  }

  openMobile() {
    this.mobileOpen = true;
  }

  onMainContentClick() {
    // Only close if the sidebar is open and the click was outside it
    if (!this.sidebarCollapsed) {
      this.sidebarCollapsed = true;
    }
  }

  constructor(
    private fb: FormBuilder,
    private uploader: BQService,
    private sanitizer: DomSanitizer,
    private officeService: OfficeService,
    private floorService: FloorService,
    private http: HttpClient,
    private router: Router,
    private deleteService: FloorplanDeleteService,
    private auth: AuthService
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
        const totalOutlets = officeResponse.success && officeResponse.data ? officeResponse.data.length : 0;
        
        // Get all floorplans from Firebase
        this.uploader.getAllFloorplans().subscribe({
          next: (floorplans: any[]) => {
            
            // Calculate statistics
            const outletsWithFloorplans = floorplans.length;
            let totalFloorplans = 0;
            
            floorplans.forEach(outlet => {
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
            
          },
          error: () => {

            this.overviewStats = {
              totalOutlets,
              outletsWithFloorplans: 0,
              totalFloorplans: 0,
              loading: false
            };
          }
        });
      },
      error: () => {

        this.overviewStats.loading = false;
      }
    });
  }

  loadDropdown() {
    
    // Load offices using OfficeService
    this.officeService.loadOffices().subscribe({
      next: (response) => {
        
        if (response.success && response.data && response.data.length > 0) {
          this.locations = response.data
            .filter(office => {
              // Only include offices that have both a valid name and ID
              const hasValidName = office.displayName || office.name;
              const hasValidId = office.id;
              return hasValidName && hasValidId;
            })
            .map(office => {
              return {
                label: office.displayName || office.name,
                value: office.id
              };
            });
        } else {


          this.locations = [];
        }
      },
      error: () => {


        this.locations = [];
      }
    });

    // Load floors using FloorService
    this.floorService.getFloors().subscribe({
      next: (floors) => {
        
        if (floors && floors.length > 0) {
          this.floors = floors.map(floor => ({
            label: floor.floor_no,
            value: floor.floor_id
          }));
        } else {

          this.floors = [];
        }
      },
      error: () => {


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

      return;
    }

    this.errorMsg.set(null);
    this.form.patchValue({ file });
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

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
      return;
    }
    
    this.loading = true;
    this.error = '';

    const floor = this.selectedFloor || undefined;
    
    // Use the same pattern as floorplan.component.ts - try getAllSvgFilesForOutlet first
    if (!floor) {
      // Case 1: No floor selected - get all outlet SVGs (same as floorplan.component.ts)
      this.floorService.getAllSvgFilesForOutlet(this.selectedOffice).pipe(
        catchError((error: any) => {
          // Only log as error if it's not a 404
          if (error?.status !== 404) {

            this.error = 'Failed to load floorplan SVGs';
          }
          return of<string[]>([]);
        })
      ).subscribe((svgs: string[]) => {
        if (svgs && svgs.length > 0) {
          this.selectedOutletSvgs = svgs;
          this.displayedSvgs = svgs.slice();

          // Apply saved floorplan order from localStorage
          this.applySavedFloorplanOrder();

          this.currentFloorplanIndex = 0;
          this.loadInlineSvgs(this.displayedSvgs);
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

            this.error = 'Failed to load floor SVG';
          }
          this.loading = false;
          return of<string[]>([]);
        })
      ).subscribe((urls: string[]) => {
        if (urls && urls.length > 0) {
          this.selectedOutletSvgs = urls;
          this.displayedSvgs = urls.slice();

          // Apply saved floorplan order from localStorage
          this.applySavedFloorplanOrder();

          this.currentFloorplanIndex = 0;
          this.loadInlineSvgs(this.displayedSvgs);
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
      this.displayedSvgs = cloudSvgs.slice();

      // Apply saved floorplan order from localStorage
      this.applySavedFloorplanOrder();

      this.currentFloorplanIndex = 0;
      this.loadInlineSvgs(this.displayedSvgs);
      this.loading = false;
    } else {
      this.error = 'No floorplan found for this outlet.';
      this.displayedSvgs = [];
      this.selectedOutletSvgs = [];
      this.updateCurrentSvgDisplay();
      this.loading = false;
    }
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

          return { originalUrl: url, normalizedUrl: url }; // Fallback to original URL
        }
      })
    );

    // Now process all normalized URLs
    normalizedUrls.forEach(({ originalUrl, normalizedUrl }) => {
      // Use fetch API to handle CORS issues with Firebase Storage URLs
      fetch(normalizedUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.text();
        })
        .then(svgText => {
          // Process SVG for compact display
          const processedSvgText = this.processSvgForCompactDisplay(svgText);
          const safe = this.sanitizer.bypassSecurityTrustHtml(processedSvgText);
          // Store using normalized key (without query params) for consistent lookup
          const key = this.normalizeUrlKey(originalUrl);
          this.svgHtmlMap.set(key, safe);

          completedRequests++;

          // Only hide loading when ALL SVGs are loaded
          if (completedRequests === totalRequests) {
            setTimeout(() => {
              this.loading = false;
              this.updateCurrentSvgDisplay();
            }, 200);
          }
        })
        .catch(err => {


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
          }
        });
    });

    // SVG loading timeout (5 seconds)
    setTimeout(() => {
      if (this.loading) {

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

      if (cachedSvg) {
        // Use the cached SVG from map (preferred method for multiple SVGs)
        // Set svgHtml for template compatibility
        this.svgHtml = cachedSvg;
      } else {
        // Fallback to direct URL if not yet loaded
        this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(currentUrl);
      }
    } else if (this.displayedSvgs.length === 0) {
      // Only clear if we truly have nothing to display
      this.safeSvgUrl = undefined;
      this.svgHtml = undefined;
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
    svgElement.setAttribute('height', '100%');
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
      this.updateCurrentSvgDisplay();
    }
  }

  previousFloorplan() {
    if (this.hasPreviousFloorplan) {
      this.currentFloorplanIndex--;
      this.updateCurrentSvgDisplay();
    }
  }

  goToFloorplan(index: number) {
    if (index >= 0 && index < this.totalFloorplans) {
      this.currentFloorplanIndex = index;
      this.updateCurrentSvgDisplay();
    }
  }

  // Refresh data
  refreshData() {
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

      return url; // Return original URL on error
    }
  }

  onOutletSelected() {
    
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

    // Show available outlets for reference

    // Find the selected outlet object

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
    }, 0);
  }

  filterFloorsByOutlet(officeId: string) {
    if (!officeId) {
      this.filteredFloors = [];
      return;
    }

    // Get the full outlet object to see what we're working with

    // Get floors for this specific outlet
    this.floorService.getFloors().subscribe({
      next: (floors) => {


        // Filter floors by location_id
        const filteredFloors = floors.filter(floor => {
          return floor.location_id === officeId;
        });


        if (filteredFloors.length === 0) {

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
      },
      error: () => {

        this.filteredFloors = [];
      }
    });
  }

  getSelectedFloorLabel(): string {
    if (!this.selectedFloor) return '';
    const floor = this.floors.find(f => f.value === this.selectedFloor);
    return floor?.label || 'Selected Floor';
  }

  /**
   * Get floor label by floor ID
   * @param floorId - The floor ID to look up
   * @returns Floor label or the floorId itself if not found
   */
  getFloorLabelById(floorId: string): string {
    const floor = this.floors.find(f => f.value === floorId);
    return floor?.label || floorId;
  }

  // Delete confirmation modal methods
  confirmDelete(officeId: string, floorId: string, label: string) {
    this.deleteTarget = { officeId, floorId, label };
    this.showDeleteModal = true;
  }

  cancelDelete() {
    this.showDeleteModal = false;
    this.deleteTarget = null;
  }

  /**
   * Execute the delete operation
   * Handles both office-level and floor-level deletions
   */
  executeDelete() {
    if (!this.deleteTarget) return;

    this.isDeleting = true;
    const { officeId, floorId, label } = this.deleteTarget;

    // Extract filename from current floorplan URL
    const filename = this.currentFloorplan ? this.extractFilenameFromUrl(this.currentFloorplan) : null;

    console.log('[executeDelete] Current floorplan URL:', this.currentFloorplan);
    console.log('[executeDelete] Extracted filename:', filename);
    console.log('[executeDelete] officeId:', officeId);
    console.log('[executeDelete] floorId:', floorId);

    // Call delete service with optional floorId and filename
    // Empty string means office-level, so pass null instead
    const floorIdParam = floorId ? floorId : null;

    this.deleteService.deleteFloorplan(officeId, floorIdParam, filename).subscribe({
      next: (response) => {

        // Show success message with deleted files
        const filesDeleted = response.deletedFiles?.length || 0;
        const fileInfo = filename ? `File: ${filename}` : `Files deleted: ${filesDeleted}`;
        const message = `Successfully deleted floorplan: ${label}\n\n` +
          `${fileInfo}\n\n` +
          (response.deletedFiles?.length ? response.deletedFiles.join('\n') : 'No files listed');

        alert(message);

        // Refresh data to update UI
        this.refreshData();

        // Close modal and reset state
        this.showDeleteModal = false;
        this.deleteTarget = null;
        this.isDeleting = false;
      },
      error: (err) => {


        // Build user-friendly error message
        let errorMsg = 'Failed to delete floorplan';

        if (err.status === 404) {
          errorMsg = 'Floorplan not found. It may have already been deleted.';
        } else if (err.status === 403) {
          errorMsg = 'Permission denied. You do not have permission to delete this floorplan.';
        } else if (err.status === 401) {
          errorMsg = 'Authentication failed. Please refresh the page and try again.';
        } else if (err.error?.message) {
          errorMsg = err.error.message;
        } else if (err.error?.error) {
          errorMsg = err.error.error;
        }

        alert(`Error: ${errorMsg}`);
        this.isDeleting = false;
        // Keep modal open so user can try again or cancel
      }
    });
  }

  /**
   * Delete current floorplan (extracts floorId and filename from current floorplan URL)
   * Handles both office-level and floor-level floorplans
   */
  deleteCurrentFloorplan() {
    if (!this.currentFloorplan || !this.selectedOffice) {

      alert('Error: No floorplan selected');
      return;
    }


    // Extract floorId and filename from URL
    const floorId = this.extractFloorIdFromUrl(this.currentFloorplan);
    const filename = this.extractFilenameFromUrl(this.currentFloorplan);


    // Build label for confirmation dialog
    const baseLabel = floorId
      ? `${this.getSelectedOfficeLabel()} - Floor ${this.getFloorLabelById(floorId)}`
      : `${this.getSelectedOfficeLabel()} (Office Level)`;

    const label = filename ? `${baseLabel} - ${filename}` : baseLabel;

    // Show confirmation modal
    this.deleteTarget = {
      officeId: this.selectedOffice,
      floorId: floorId || '', // Empty string for office-level
      label
    };
    this.showDeleteModal = true;
  }

  /**
   * Extract filename from floorplan URL path
   *
   * Examples:
   * - "https://storage.googleapis.com/.../floorplan.svg" -> "floorplan.svg"
   * - "https://storage.googleapis.com/.../custom-name.svg" -> "custom-name.svg"
   *
   * @param url - The full URL to the floorplan SVG
   * @returns filename (e.g., "floorplan.svg")
   */
  extractFilenameFromUrl(url: string): string | null {
    try {
      console.log('[extractFilenameFromUrl] Input URL:', url);
      let path = url;

      // If it's a full URL, extract the pathname
      if (url.includes('://')) {
        const urlObj = new URL(url);
        path = urlObj.pathname;
        console.log('[extractFilenameFromUrl] Extracted pathname:', path);
      }

      // Remove query parameters and fragments
      path = path.split('?')[0].split('#')[0];

      // Split by / and filter empty strings
      let parts = path.split('/').filter(p => p.trim() !== '' && p !== 'v0' && p !== 'b');
      console.log('[extractFilenameFromUrl] Initial path parts:', parts);

      // For Firebase Storage URLs (storage.googleapis.com), the first part is the bucket name
      // which we need to skip. The actual path structure is: bucket/officeId/floorId/filename.svg
      if (url.includes('storage.googleapis.com') && parts.length > 0) {
        // Skip the bucket name (first part after domain)
        if (parts[0].includes('firebasestorage.app') || parts[0].includes('appspot.com')) {
          parts = parts.slice(1); // Remove bucket name
          console.log('[extractFilenameFromUrl] Removed bucket name, new parts:', parts);
        }
      }

      // Get the last part (filename)
      if (parts.length > 0) {
        const filename = parts[parts.length - 1];
        // Decode URI component in case filename has encoded characters
        const decodedFilename = decodeURIComponent(filename);
        console.log('[extractFilenameFromUrl] Raw filename:', filename);
        console.log('[extractFilenameFromUrl] Decoded filename:', decodedFilename);
        return decodedFilename;
      }

      return null;
    } catch (err) {
      console.error('Failed to extract filename from URL:', url, err);
      return null;
    }
  }

  /**
   * Extract floorId from floorplan URL path
   *
   * Storage Path Formats:
   * - Floor-level:  {officeId}/{floorId}/floorplan.svg    -> Returns floorId
   * - Office-level: {officeId}/floorplan.svg               -> Returns null
   *
   * Examples:
   * - "67ad665a.../634.../floorplan.svg" -> "634..."       (floor-level)
   * - "67ad665a.../floorplan.svg"        -> null           (office-level)
   *
   * @param url - The full URL or path to the floorplan SVG
   * @returns floorId if floor-level, null if office-level
   */
  extractFloorIdFromUrl(url: string): string | null {
    try {
      let path = url;

      // If it's a full URL, extract the pathname
      if (url.includes('://')) {
        const urlObj = new URL(url);
        path = urlObj.pathname;
      }

      // Remove query parameters and fragments
      path = path.split('?')[0].split('#')[0];

      // Split by / and filter empty strings
      let parts = path.split('/').filter(p => p.trim() !== '' && p !== 'v0' && p !== 'b');

      // For Firebase Storage URLs (storage.googleapis.com), the first part is the bucket name
      // which we need to skip. The actual path structure is: bucket/officeId/floorId/filename.svg
      if (url.includes('storage.googleapis.com') && parts.length > 0) {
        // Skip the bucket name (first part after domain)
        if (parts[0].includes('firebasestorage.app') || parts[0].includes('appspot.com')) {
          parts = parts.slice(1); // Remove bucket name
        }
      }


      // Detect format based on number of parts
      // Expected formats:
      // Floor-level:  [..., officeId, floorId, filename.svg]  (3+ parts)
      // Office-level: [..., officeId, filename.svg]           (2 parts)

      if (parts.length >= 3) {
        // Floor-level: Get second-to-last part (before filename)
        const potentialFloorId = parts[parts.length - 2];
        const filename = parts[parts.length - 1];

        // Validate that the last part is actually a filename (.svg)
        if (filename.endsWith('.svg') || filename.endsWith('.png')) {
          return potentialFloorId;
        }
      } else if (parts.length === 2) {
        // Office-level: Only officeId and filename
        const filename = parts[parts.length - 1];

        if (filename.endsWith('.svg') || filename.endsWith('.png')) {
          return null; // Office-level has no floorId
        }
      }

      return null;
    } catch (err) {

      return null;
    }
  }

  /**
   * Drag and Drop methods for reordering floorplans
   */
  onDragStart(event: DragEvent, index: number): void {
    this.draggedIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', index.toString());
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();

    if (this.draggedIndex === null || this.draggedIndex === dropIndex) {
      return;
    }

    // Reorder the displayed SVGs array
    const draggedItem = this.displayedSvgs[this.draggedIndex];
    const newArray = [...this.displayedSvgs];

    // Remove the dragged item
    newArray.splice(this.draggedIndex, 1);

    // Insert at the new position
    newArray.splice(dropIndex, 0, draggedItem);

    // Update the array
    this.displayedSvgs = newArray;

    // Also update selectedOutletSvgs to keep them in sync
    this.selectedOutletSvgs = newArray;

    // Update current index if needed
    if (this.currentFloorplanIndex === this.draggedIndex) {
      // If we're viewing the dragged item, update to its new position
      this.currentFloorplanIndex = dropIndex;
    } else if (this.draggedIndex < this.currentFloorplanIndex && dropIndex >= this.currentFloorplanIndex) {
      // Dragged from before current to after current
      this.currentFloorplanIndex--;
    } else if (this.draggedIndex > this.currentFloorplanIndex && dropIndex <= this.currentFloorplanIndex) {
      // Dragged from after current to before current
      this.currentFloorplanIndex++;
    }

    // Mark as having unsaved changes
    this.hasUnsavedChanges = true;

    // Update the display
    this.updateCurrentSvgDisplay();
  }

  onDragEnd(_event: DragEvent): void {
    this.draggedIndex = null;
  }

  /**
   * Toggle the floorplan list visibility
   */
  toggleFloorplanList(): void {
    this.showFloorplanList = !this.showFloorplanList;
  }

  /**
   * Get a descriptive name for a floorplan based on its URL
   * @param url - The floorplan URL
   * @param index - The index in the array (fallback)
   * @returns A descriptive name like "Floor L21" or the filename
   */
  getFloorplanName(url: string, index: number): string {
    try {
      // Extract floorId and filename
      const floorId = this.extractFloorIdFromUrl(url);
      const filename = this.extractFilenameFromUrl(url);

      // Try to get floor label from floorId
      if (floorId) {
        const floorLabel = this.getFloorLabelById(floorId);
        if (floorLabel && floorLabel !== floorId) {
          return `Floor ${floorLabel}`;
        }
      }

      // Fallback to filename without extension
      if (filename) {
        const nameWithoutExt = filename.replace(/\.svg$/i, '');
        return nameWithoutExt;
      }

      // Last resort: use index
      return `Floorplan ${index + 1}`;
    } catch (err) {
      console.error('Failed to get floorplan name:', err);
      return `Floorplan ${index + 1}`;
    }
  }

  /**
   * Save the current floorplan order to localStorage
   * This persists the order across page refreshes and affects the dashboard
   */
  saveFloorplanOrder(): void {
    if (!this.selectedOffice || this.displayedSvgs.length === 0) {
      alert('No floorplans to save');
      return;
    }

    this.isSavingOrder = true;

    try {
      // Get existing orders from localStorage
      const existingOrders = localStorage.getItem('floorplanOrders');
      const orders = existingOrders ? JSON.parse(existingOrders) : {};

      // Normalize URLs before saving (remove query parameters)
      const normalizedUrls = this.displayedSvgs.map(url => this.normalizeUrlKey(url));

      // Save the normalized order for this office
      orders[this.selectedOffice] = normalizedUrls;

      // Save back to localStorage
      localStorage.setItem('floorplanOrders', JSON.stringify(orders));

      // Mark as saved
      this.hasUnsavedChanges = false;

      // Show success message
      alert(`Successfully saved floorplan order for ${this.getSelectedOfficeLabel()}!\n\nThe new order will be reflected on the dashboard page.`);
    } catch (err) {
      console.error('Failed to save floorplan order:', err);
      alert('Failed to save floorplan order. Please try again.');
    } finally {
      this.isSavingOrder = false;
    }
  }

  /**
   * Reset the floorplan order to the original/default order
   */
  resetFloorplanOrder(): void {
    if (!this.selectedOffice) {
      return;
    }

    const confirmed = confirm('Are you sure you want to reset the floorplan order to the default?\n\nThis will discard any saved custom order.');

    if (!confirmed) {
      return;
    }

    try {
      // Remove from localStorage
      const existingOrders = localStorage.getItem('floorplanOrders');
      if (existingOrders) {
        const orders = JSON.parse(existingOrders);
        delete orders[this.selectedOffice];
        localStorage.setItem('floorplanOrders', JSON.stringify(orders));
      }

      // Reset to original order
      this.displayedSvgs = [...this.selectedOutletSvgs];
      this.currentFloorplanIndex = 0;
      this.hasUnsavedChanges = false;

      this.updateCurrentSvgDisplay();

      alert('Floorplan order has been reset to default.');
    } catch (err) {
      console.error('Failed to reset floorplan order:', err);
      alert('Failed to reset floorplan order. Please try again.');
    }
  }

  /**
   * Apply saved floorplan order from localStorage for the current outlet
   * This is called after SVGs are loaded to restore the user's custom order
   */
  private applySavedFloorplanOrder() {
    const outletId = this.selectedOffice;
    if (!outletId || this.displayedSvgs.length === 0) {
      return;
    }

    try {
      const existingOrders = localStorage.getItem('floorplanOrders');
      if (!existingOrders) {
        return;
      }

      const orders = JSON.parse(existingOrders);
      const savedOrder = orders[outletId];

      if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) {
        return;
      }

      // Create a map of saved order for quick lookup (normalize URLs for comparison)
      const orderMap = new Map<string, number>();
      savedOrder.forEach((url: string, index: number) => {
        const normalizedUrl = this.normalizeUrlKey(url);
        orderMap.set(normalizedUrl, index);
      });

      // Sort displayedSvgs based on saved order
      // SVGs in saved order come first, then any new SVGs that weren't in the saved order
      this.displayedSvgs.sort((urlA, urlB) => {
        const normalizedA = this.normalizeUrlKey(urlA);
        const normalizedB = this.normalizeUrlKey(urlB);
        const indexA = orderMap.has(normalizedA) ? orderMap.get(normalizedA)! : Number.MAX_SAFE_INTEGER;
        const indexB = orderMap.has(normalizedB) ? orderMap.get(normalizedB)! : Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
      });
    } catch (error) {
      console.error('Error loading saved floorplan order:', error);
    }
  }

  /**
   * Toggle the guidelines modal
   */
  toggleGuidelinesModal(): void {
    this.showGuidelinesModal = !this.showGuidelinesModal;
  }

  /**
   * Close the guidelines modal
   */
  closeGuidelinesModal(): void {
    this.showGuidelinesModal = false;
  }

  /**
   * Logout user and navigate to login page
   */
  logout(): void {
    this.auth.logout();
  }

}