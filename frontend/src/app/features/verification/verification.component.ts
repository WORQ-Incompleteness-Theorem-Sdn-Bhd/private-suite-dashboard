import { Component, OnInit } from '@angular/core';
import { FloorService } from '../../core/services/floor.service';
import { FirebaseSvgService } from '../../core/services/firebase.service';
import { OfficeService } from '../../core/services/office.service';
import { Floor } from '../../core/models/floor.model';

@Component({
  selector: 'app-verification',
  template: `
    <div class="p-6 bg-white rounded-lg shadow-lg">
      <h2 class="text-2xl font-bold mb-4 text-blue-600">🔍 Cloud vs Local Asset Verification</h2>
      
      <!-- Current Mode Display -->
      <div class="mb-6 p-4 rounded-lg" [class]="isUsingCloud ? 'bg-green-100 border-green-300' : 'bg-yellow-100 border-yellow-300'">
        <h3 class="text-lg font-semibold mb-2">
          {{ isUsingCloud ? '☁️ Using Firebase Cloud Storage' : '📁 Using Local Assets' }}
        </h3>
        <p class="text-sm text-gray-600">
          Current mode: {{ isUsingCloud ? 'Cloud Storage' : 'Local Assets' }}
        </p>
      </div>

      <!-- Test Buttons -->
      <div class="space-y-4">
        <button 
          (click)="testFloorsFromCloud()" 
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          🌐 Test Floors from Cloud API
        </button>
        
        <button 
          (click)="testSvgsFromCloud()" 
          class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
          🔥 Test SVGs from Firebase Cloud
        </button>
        
        <button 
          (click)="toggleMode()" 
          class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
          🔄 Toggle Cloud/Local Mode
        </button>
      </div>

      <!-- Results Display -->
      <div class="mt-6">
        <h3 class="text-lg font-semibold mb-2">📊 Test Results:</h3>
        <div class="bg-gray-100 p-4 rounded-lg">
          <pre class="text-sm overflow-auto max-h-96">{{ testResults }}</pre>
        </div>
      </div>
    </div>
  `,
  standalone: true
})
export class VerificationComponent implements OnInit {
  isUsingCloud = false;
  testResults = 'Click the buttons above to test...\n';

  constructor(
    private floorService: FloorService,
    private firebaseSvgService: FirebaseSvgService,
    private officeService: OfficeService
  ) {}

  ngOnInit() {
    this.checkCurrentMode();
  }

  checkCurrentMode() {
    // Access the private property through any casting (for testing purposes)
    this.isUsingCloud = !(this.floorService as any).useLocalAssets;
    this.log(`Current mode: ${this.isUsingCloud ? 'Cloud Storage' : 'Local Assets'}`);
  }

  testFloorsFromCloud() {
    this.log('🌐 Testing floors from cloud API...');
    this.floorService.getFloors().subscribe({
      next: (floors) => {
        this.log(`✅ Floors loaded: ${floors.length} floors`);
        floors.forEach((floor, index) => {
          this.log(`  ${index + 1}. ${floor.floor_name} (ID: ${floor.floor_id})`);
        });
      },
      error: (error) => {
        this.log(`❌ Error loading floors: ${error.message}`);
      }
    });
  }

  testSvgsFromCloud() {
    this.log('🔥 Testing SVGs from Firebase Cloud...');
    
    // Get first office for testing
    this.officeService.loadOffices().subscribe({
      next: (response) => {
        if (response.success && response.data && response.data.length > 0) {
          const office = response.data[0];
          this.log(`Testing with office: ${office.displayName} (${office.id})`);
          
          // Test getting all floorplans
          this.firebaseSvgService.getAllFloorplans().subscribe({
            next: (floorplans) => {
              this.log(`✅ All floorplans loaded: ${floorplans.length} offices`);
              floorplans.forEach(office => {
                this.log(`  Office: ${office.officeId}`);
                this.log(`    Office SVG: ${office.officeSvg ? 'Yes' : 'No'}`);
                this.log(`    Floors: ${office.floors.length}`);
              });
            },
            error: (error) => {
              this.log(`❌ Error loading all floorplans: ${error.message}`);
            }
          });
        } else {
          this.log('❌ No offices available for testing');
        }
      },
      error: (error) => {
        this.log(`❌ Error loading offices: ${error.message}`);
      }
    });
  }

  toggleMode() {
    // Toggle the mode (for testing purposes)
    (this.floorService as any).useLocalAssets = !(this.floorService as any).useLocalAssets;
    this.checkCurrentMode();
    this.log(`Mode toggled to: ${this.isUsingCloud ? 'Cloud Storage' : 'Local Assets'}`);
  }

  private log(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.testResults += `[${timestamp}] ${message}\n`;
  }
}

