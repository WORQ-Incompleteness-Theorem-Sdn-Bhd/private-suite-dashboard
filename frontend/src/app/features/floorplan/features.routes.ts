import { Routes } from '@angular/router';

export const FLOORPLAN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./floorplan.component').then((m) => m.FloorplanComponent),
  },
];
