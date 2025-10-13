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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { OfficeService } from '../../core/services/office.service';
import { FloorService } from '../../core/services/floor.service';
import { BQService, UploadResponse } from './bq.service';
import { environment } from '../../environments/environment.prod';

type Option = { label: string; value: string };

interface FloorplanMeta {
  ok: boolean;
  bucket: string;
  path: string;
  signedUrl?: string;
  contentType: string;
  size: number;
  updated: string;
  metadata?: {
    officeId: string;
    originalName: string;
    firebaseStorageDownloadTokens?: string;
  };
}

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

  constructor(
    private fb: FormBuilder,
    private uploader: BQService,
    private sanitizer: DomSanitizer,
    private officeService: OfficeService,
    private floorService: FloorService,
    private http: HttpClient
  ) {
    this.form = this.fb.group({
      officeId: ['', Validators.required],
      floorId: [''], // optional for outlets with more than 1 floor
      fileName: [''], // optional
      file: [null as File | null, Validators.required],
    });
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

    const { officeId, floorId, fileName, file } = this.form.value as {
      officeId: string;
      floorId: string;
      fileName?: string;
      file: File;
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
    
    this.uploader.getFloorplan(this.selectedOffice, floor).subscribe({
      next: (response: any) => {
        console.log('✅ Floorplan response received:', response);
        
        if (response.ok) {
          if (response.scope === 'single') {
            // Single SVG - use signedUrl or construct URL
            if (response.signedUrl) {
              this.loadInlineSvg(response.signedUrl);
            } else if (response.path) {
              const rawUrl = `${environment.floorplanUrl}/${this.selectedOffice}${floor ? `/${floor}` : ''}?raw=1`;
              console.log('Using raw fallback URL (single):', rawUrl);
              this.loadInlineSvg(rawUrl);
            }
          } else if (response.scope === 'list' && response.items && response.items.length > 0) {
            // Multiple SVGs - use the first one
            console.log('📄 Multiple SVGs found:', response.items.length, 'items');
            const firstItem = response.items[0];
            if (firstItem.signedUrl) {
              this.loadInlineSvg(firstItem.signedUrl);
            } else if (firstItem.path) {
              // Fallback to backend raw streaming for lists
              // Extract floorId from firstItem.path: `${officeId}/${floorId}/filename.svg`
              const match = String(firstItem.path).match(/^([^/]+)\/([^/]+)\/[^/]+$/);
              const extractedOffice = match ? match[1] : this.selectedOffice;
              const extractedFloor = match ? match[2] : floor;
              const rawUrl = `${environment.floorplanUrl}/${extractedOffice}${extractedFloor ? `/${extractedFloor}` : ''}?raw=1`;
              console.log('Using raw fallback URL (list with extracted floor):', { path: firstItem.path, extractedOffice, extractedFloor, rawUrl });
              this.loadInlineSvg(rawUrl);
              // Optionally reflect the derived floor in UI state
              if (!this.selectedFloor && extractedFloor) {
                this.selectedFloor = extractedFloor;
              }
            }
          } else {
            console.log('⚠️ No floorplan found in response');
            this.error = 'No floorplan found for this outlet.';
          }
        } else {
          console.log('❌ Response not OK:', response);
          this.error = 'Failed to load floorplan.';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('❌ Floorplan loading error:', err);
        this.error = 'Failed to load floorplan.';
        this.loading = false;
      },
    });
  }

  private loadInlineSvg(url: string) {
    // Reset previous displays
    this.safeSvgUrl = undefined;
    this.svgHtml = undefined;
    this.http.get(url, { responseType: 'text' }).subscribe({
      next: (svgText) => {
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

  // Tab management
  setActiveTab(tab: 'overview' | 'upload') {
    this.activeTab = tab;
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

  getSelectedFloorLabel(): string {
    if (!this.selectedFloor) return '';
    const floor = this.floors.find(f => f.value === this.selectedFloor);
    return floor?.label || 'Selected Floor';
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
        this.filteredFloors = filteredFloors.map(floor => ({
          label: floor.floor_no,
          value: floor.floor_id
        }));
        console.log('📋 Filtered floors:', this.filteredFloors);
      },
      error: (err) => {
        console.error('Error loading floors for outlet:', err);
        this.filteredFloors = [];
      }
    });
  }
}
