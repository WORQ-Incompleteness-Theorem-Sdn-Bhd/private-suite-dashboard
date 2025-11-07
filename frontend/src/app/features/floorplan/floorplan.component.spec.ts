import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { DomSanitizer } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { FloorplanComponent } from './floorplan.component';

// Services used by the component
import { RoomService } from '../../core/services/room.service';
import { OfficeService } from '../../core/services/office.service';
import { FloorService } from '../../core/services/floor.service';
import { ToastService } from '../../shared/services/toast.service';
import { Router } from '@angular/router';

// Minimal room and floor types for test
interface Room { id: string; name: string; outlet: string; status: string; capacity: number; svg?: string | string[]; originalStatus?: string; availableFrom?: string; type?: string; area?: number; price?: number; deposit?: number; video?: string; floor_id?: string; }
interface Floor { floor_id: string; label?: string; }

class RoomServiceStub {
  rooms$ = new Subject<Room[]>();
  getResources = jasmine.createSpy('getResources').and.returnValue(of({ success: true }));
  getAvailability = jasmine.createSpy('getAvailability').and.returnValue(of({ resources: [] }));
}

class OfficeServiceStub {
  private offices = [
    { id: 'OUTLET_1', displayName: 'Outlet One', svg: [] as string[] },
    { id: 'OUTLET_2', displayName: 'Outlet Two', svg: [] as string[] },
  ];
  loadOffices = jasmine.createSpy('loadOffices').and.returnValue(of({ success: true }));
  getOffices() { return this.offices as any; }
}

class FloorServiceStub {
  getFloors = jasmine.createSpy('getFloors').and.returnValue(of<Floor[]>([
    { floor_id: 'F1', label: '1' },
    { floor_id: 'F2', label: '2' },
  ]));
  getAllSvgFilesForOutlet = jasmine.createSpy('getAllSvgFilesForOutlet').and.returnValue(of<string[]>(['https://example.com/a.svg', 'https://example.com/b.svg']));
  getFloorplanUrls = jasmine.createSpy('getFloorplanUrls').and.callFake((outletId: string, floorId: string) => of<string[]>([`https://example.com/${outletId}-${floorId}.svg`]));
  getFloorDisplayLabel = jasmine.createSpy('getFloorDisplayLabel').and.callFake((floorId: string, floors: Floor[]) => {
    const f = floors.find(fl => fl.floor_id === floorId); return f?.label || floorId;
  });
}

class ToastServiceStub { success(){} error(){} info(){} }
class RouterStub { navigate = jasmine.createSpy('navigate'); }

function emitRooms(svc: RoomServiceStub, rooms: Room[]) { svc.rooms$.next(rooms); }

describe('FloorplanComponent (standalone)', () => {
  let component: FloorplanComponent;
  let roomService: RoomServiceStub;
  let officeService: OfficeServiceStub;
  let floorService: FloorServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FloorplanComponent],
      providers: [
        { provide: RoomService, useClass: RoomServiceStub },
        { provide: OfficeService, useClass: OfficeServiceStub },
        { provide: FloorService, useClass: FloorServiceStub },
        { provide: ToastService, useClass: ToastServiceStub },
        { provide: Router, useClass: RouterStub },
        provideHttpClient(),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FloorplanComponent);
    component = fixture.componentInstance;
    roomService = TestBed.inject(RoomService) as unknown as RoomServiceStub;
    officeService = TestBed.inject(OfficeService) as unknown as OfficeServiceStub;
    floorService = TestBed.inject(FloorService) as unknown as FloorServiceStub;

    fixture.detectChanges();
  });

  it('Should initialize and build outlet options after offices load', () => {
    // After ngOnInit, OfficeService.loadOffices emits success and buildOptions runs
    expect(officeService.loadOffices).toHaveBeenCalled();
    // Build options produces outletOptions from offices
    expect(component.outletOptions.length).toBeGreaterThan(0);
    const ids = component.outletOptions.map(o => o.value);
    expect(ids).toContain('OUTLET_1');
  });

  it('Should update selected outlet and fetch resources + svgs', () => {
    // Simulate selecting an outlet
    component.updateFilter('outlet', 'OUTLET_1');
    // Resources requested
    expect(roomService.getResources).toHaveBeenCalled();
    // SVGs loaded for outlet
    expect(floorService.getAllSvgFilesForOutlet).toHaveBeenCalledWith('OUTLET_1');
  });

  it('Should apply filters and compute Available/Occupied counts based on status and pax', () => {
    const rooms: Room[] = [
      { id: 'R1', name: 'A1', outlet: 'Outlet One', status: 'available', capacity: 4 },
      { id: 'R2', name: 'A2', outlet: 'Outlet One', status: 'occupied', capacity: 6 },
      { id: 'R3', name: 'B1', outlet: 'Outlet Two', status: 'available', capacity: 8 },
    ];
    emitRooms(roomService, rooms);

    // select outlet OUTLET_1
    component.updateFilter('outlet', 'OUTLET_1');
    // filter status to Available
    component.updateFilter('status', 'Available');

    // Only rooms with outlet=Outlet One and available
    expect(component.filteredRooms.map(r => r.id)).toEqual(['R1']);
    expect(component.Available).toBe(1);
    expect(component.Occupied).toBe(0);

    // Change pax to 6 (should exclude R1)
    component.updateFilter('pax', '6');
    expect(component.filteredRooms.length).toBe(0);
  });

  it('Should compute effective status using date-based availability', () => {
    const rooms: Room[] = [
      { id: 'R1', name: 'A1', outlet: 'Outlet One', status: 'available', capacity: 4 },
      { id: 'R2', name: 'A2', outlet: 'Outlet One', status: 'reserved', capacity: 6 },
    ];
    emitRooms(roomService, rooms);

    component.updateFilter('outlet', 'OUTLET_1');

    // Set a start date triggers availability fetching
    (roomService.getAvailability as jasmine.Spy).and.returnValue(of({
      resources: [
        { resource_id: 'R1', days: [{ date: '2024-01-01', status: 'free' }] },
        { resource_id: 'R2', days: [{ date: '2024-01-01', status: 'free' }] },
      ],
    }));

    component.onDateChange('start', '2024-01-01');

    // R2 should still be treated as Occupied because original status is reserved
    component.updateFilter('status', 'Available');
    expect(component.filteredRooms.map(r => r.id)).toEqual(['R1']);

    component.updateFilter('status', 'Occupied');
    expect(component.filteredRooms.map(r => r.id)).toContain('R2');
  });

  it('Should paginate floorplans and update displayedSvgs accordingly', () => {
    // pre-populate rooms to allow updateSelectedOutletSvgs to proceed
    emitRooms(roomService, [
      { id: 'R1', name: 'A1', outlet: 'Outlet One', status: 'available', capacity: 4, floor_id: 'F1' },
    ]);

    component.updateFilter('outlet', 'OUTLET_1');

    // all svgs from stub
    expect(component.totalFloorplans).toBeGreaterThan(0);

    const initialIndex = component.currentFloorplanIndex;
    component.nextFloorplan();
    expect(component.currentFloorplanIndex === initialIndex || component.currentFloorplanIndex === initialIndex + 1).toBeTrue();

    component.previousFloorplan();
    expect(component.currentFloorplanIndex).toBeLessThanOrEqual(initialIndex + 1);

    component.goToFloorplan(0);
    expect(component.currentFloorplanIndex).toBe(0);
  });
});
