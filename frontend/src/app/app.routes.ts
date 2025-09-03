import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'floorplan', pathMatch: 'full' },
  {
    path: 'floorplan',
    loadChildren: () =>
      import('./features/floorplan/features.routes').then((m) => m.FLOORPLAN_ROUTES),
  },
  { path: '**', redirectTo: 'floorplan' },
];
