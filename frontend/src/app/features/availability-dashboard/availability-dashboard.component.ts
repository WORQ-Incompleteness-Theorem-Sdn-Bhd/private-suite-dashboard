import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../../shared/services/auth.service';
import { OfficeService } from '../../core/services/office.service';
import { Office } from '../../core/models/office.model';

export interface AvailabilityData {
  range: {
    start: string;
    end: string;
    tz: string;
  };
  office_id: string | null;
  resource_type: string;
  resources: Array<{
    resource_id: string;
    name: string;
    days: Array<{
      date: string;
      status: 'free' | 'occupied';
    }>;
  }>;
}

@Component({
  selector: 'app-availability-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="availability-dashboard">
      <h2>Room Availability Dashboard</h2>
      
      <!-- Date Range Selector -->
      <div class="date-range-selector">
        <div class="form-group">
          <label for="startDate">Start Date:</label>
          <input 
            type="date" 
            id="startDate" 
            [(ngModel)]="startDate" 
            (change)="onDateChange()"
            class="form-control"
          >
        </div>
        
        <div class="form-group">
          <label for="endDate">End Date:</label>
          <input 
            type="date" 
            id="endDate" 
            [(ngModel)]="endDate" 
            (change)="onDateChange()"
            class="form-control"
          >
        </div>
        
        <div class="form-group">
          <label for="officeSelect">Office:</label>
          <select 
            id="officeSelect" 
            [(ngModel)]="selectedOfficeId" 
            (change)="onOfficeChange()"
            class="form-control"
          >
            <option value="">All Offices</option>
            <option *ngFor="let office of offices" [value]="office.id">
              {{ office.displayName }}
            </option>
          </select>
        </div>
        
        <button (click)="loadAvailability()" class="btn btn-primary" [disabled]="loading">
          {{ loading ? 'Loading...' : 'Load Availability' }}
        </button>
      </div>

      <!-- Availability Results -->
      <div class="availability-results" *ngIf="availabilityData">
        <h3>Availability Results</h3>
        <div class="date-range-info">
          <p><strong>Date Range:</strong> {{ availabilityData.range.start }} to {{ availabilityData.range.end }}</p>
          <p><strong>Office:</strong> {{ getOfficeName(availabilityData.office_id) || 'All Offices' }}</p>
        </div>
        
        <div class="resources-grid">
          <div *ngFor="let resource of availabilityData.resources" class="resource-card">
            <h4>{{ resource.name }}</h4>
            <div class="days-calendar">
              <div 
                *ngFor="let day of resource.days" 
                class="day-cell"
                [class.free]="day.status === 'free'"
                [class.occupied]="day.status === 'occupied'"
                [title]="day.date + ': ' + day.status"
              >
                {{ formatDate(day.date) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div *ngIf="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  `,
  styles: [`
    .availability-dashboard {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .date-range-selector {
      display: flex;
      gap: 15px;
      margin-bottom: 30px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      flex-wrap: wrap;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      min-width: 150px;
    }

    .form-group label {
      font-weight: 600;
      margin-bottom: 5px;
      color: #333;
    }

    .form-control {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      align-self: flex-end;
    }

    .btn-primary {
      background: #007bff;
      color: white;
    }

    .btn:disabled {
      background: #6c757d;
      cursor: not-allowed;
    }

    .availability-results {
      margin-top: 20px;
    }

    .date-range-info {
      background: #e9ecef;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .resources-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    .resource-card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      background: white;
    }

    .resource-card h4 {
      margin: 0 0 15px 0;
      color: #333;
    }

    .days-calendar {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }

    .day-cell {
      padding: 8px;
      text-align: center;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }

    .day-cell.free {
      background: #d4edda;
      color: #155724;
    }

    .day-cell.occupied {
      background: #f8d7da;
      color: #721c24;
    }

    .error-message {
      background: #f8d7da;
      color: #721c24;
      padding: 15px;
      border-radius: 4px;
      margin-top: 20px;
    }
  `]
})
export class AvailabilityDashboardComponent implements OnInit {
  startDate: string = '';
  endDate: string = '';
  selectedOfficeId: string = '';
  availabilityData: AvailabilityData | null = null;
  loading = false;
  errorMessage = '';
  
  offices: Office[] = [];
  private availabilitySubject = new BehaviorSubject<AvailabilityData | null>(null);
  availability$ = this.availabilitySubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private officeService: OfficeService
  ) {
    // Set default date range (next 7 days)
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = nextWeek.toISOString().split('T')[0];
  }

  ngOnInit(): void {
    // Load offices for dropdown
    this.officeService.loadOffices().subscribe();
    this.officeService.offices$.subscribe(offices => {
      this.offices = offices;
    });
  }

  onDateChange(): void {
    // Validate date range
    if (this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      
      if (end < start) {
        this.errorMessage = 'End date must be after start date';
        return;
      }
      
      const dayDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (dayDiff > 31) {
        this.errorMessage = 'Date range cannot exceed 31 days';
        return;
      }
      
      this.errorMessage = '';
    }
  }

  onOfficeChange(): void {
    // Office selection changed
  }

  loadAvailability(): void {
    if (!this.startDate || !this.endDate) {
      this.errorMessage = 'Please select both start and end dates';
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    let params = new HttpParams()
      .set('start', this.startDate)
      .set('end', this.endDate);

    if (this.selectedOfficeId) {
      params = params.set('office_id', this.selectedOfficeId);
    }

    this.http.get<AvailabilityData>(`${environment.apiBaseUrl}/api/bigquery/availability`, { 
      params
    }).subscribe({
      next: (data) => {
        this.availabilityData = data;
        this.availabilitySubject.next(data);
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading availability:', error);
        this.errorMessage = error.error?.error || 'Failed to load availability data';
        this.loading = false;
      }
    });
  }

  getOfficeName(officeId: string | null): string {
    if (!officeId) return '';
    const office = this.offices.find(o => o.id === officeId);
    return office?.displayName || office?.name || officeId;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.getDate().toString();
  }
}

