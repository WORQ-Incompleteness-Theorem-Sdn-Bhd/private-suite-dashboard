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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { OfficeService } from '../../core/services/office.service';
import { FloorService } from '../../core/services/floor.service';
import { ToastComponent } from '../../shared/components/toast.component';
import { BQService, UploadResponse } from './bq.service';

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
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, FormsModule, ToastComponent],
  templateUrl: './floorplan-management.component.html',
})
export class FloorplanManagementComponent implements OnInit {
  uploading = signal(false);
  progress = signal(0);
  result = signal<UploadResponse | null>(null);
  errorMsg = signal<string | null>(null);

  selectedOffice: any = null;
  selectedFloor: any = null;
  safeSvgUrl?: SafeResourceUrl;
  error = '';
  loading = false;

  form: FormGroup;

  // Dropdown options
  locations: Option[] = [];
  floors: Option[] = [];

  // Tab management
  activeTab: 'overview' | 'upload' = 'overview';

  constructor(
    private fb: FormBuilder,
    private uploader: BQService,
    private sanitizer: DomSanitizer,
    private officeService: OfficeService,
    private floorService: FloorService
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
  }

  loadDropdown() {
    console.log('Loading dropdown data...');
    
    // Load offices using OfficeService
    this.officeService.loadOffices().subscribe({
      next: (response) => {
        console.log('Office service response:', response);
        if (response.success && response.data) {
          this.locations = response.data.map(office => ({
            label: office.displayName,
            value: office.id
          }));
          console.log('Mapped locations:', this.locations);
        } else {
          console.warn('No office data received or success=false');
          this.locations = [];
        }
      },
      error: (err) => {
        console.error('Error loading offices:', err);
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

  private toStorageUrl(meta: FloorplanMeta): string {
    if (meta.signedUrl) return meta.signedUrl;

    const encodedPath = encodeURIComponent(meta.path);
    const token = meta.metadata?.firebaseStorageDownloadTokens;

    return `https://firebasestorage.googleapis.com/v0/b/${
      meta.bucket
    }/o/${encodedPath}?alt=media${token ? `&token=${token}` : ''}`;
  }

  onSelected() {
    if (!this.selectedOffice) return;
    this.loading = true;
    this.error = '';

    const floor = this.selectedFloor || undefined;
    this.uploader.getFloorplan(this.selectedOffice, floor).subscribe({
      next: (meta: FloorplanMeta) => {
        const url = this.toStorageUrl(meta);
        this.safeSvgUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to load floorplan.';
        this.loading = false;
      },
    });
  }

  // Tab management
  setActiveTab(tab: 'overview' | 'upload') {
    this.activeTab = tab;
  }

  // Refresh data
  refreshData() {
    this.loadDropdown();
    if (this.selectedOffice) {
      this.onSelected();
    }
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
}
