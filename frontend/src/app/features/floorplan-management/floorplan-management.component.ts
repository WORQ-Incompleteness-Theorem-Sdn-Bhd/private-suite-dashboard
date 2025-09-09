import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormGroup,
} from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BQService, UploadResponse } from './bq.service';
import { forkJoin } from 'rxjs';

type Option = { label: string; value: string };

@Component({
  selector: 'app-floorplan-upload',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './floorplan-management.component.html',
})
export class FloorplanManagementComponent implements OnInit {
  uploading = signal(false);
  progress = signal(0);
  result = signal<UploadResponse | null>(null);
  errorMsg = signal<string | null>(null);

  // ✅ Use FormGroup (not FormData)
  form: FormGroup;

  // Dropdown options
  locations: Option[] = [];
  floors: Option[] = [];

  constructor(private fb: FormBuilder, private uploader: BQService) {
    this.form = this.fb.group({
      officeId: ['', Validators.required],
      floorId: [''],
      fileName: [''], // optional
      file: [null as File | null, Validators.required],
    });
  }

  ngOnInit(): void {
    this.loadDropdown();
  }

  loadDropdown() {
    forkJoin({
      locations: this.uploader.getLocation(), // -> Option[]
      floors: this.uploader.getFloor(), // -> Option[]
    }).subscribe({
      next: ({ locations, floors }) => {
        this.locations = locations;
        this.floors = floors;
      },
      error: (err) => {
        console.error('Error loading dropdown data:', err);
      },
    });
  }

  onFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    console.log('📂 onFileChange picked:', file);

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

    console.log('✅ File accepted:', {
      name: file.name,
      type: file.type,
      size: file.size,
    });

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

    console.log('🚀 Submitting upload with:', {
      officeId,
      floorId,
      fileName,
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
    });

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
          console.log('📡 Upload state:', state);
          this.progress.set(state.progress);
          if (state.done && state.data) {
            console.log('✅ Upload complete, server response:', state.data);
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
}
