import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { FloorplanManagementComponent } from './features/floorplan-management/floorplan-management.component';
//import { AuthGuard } from './core/guards/auth.guard'; for future use
//import { AdminGuard } from './core/guards/admin.guard';for future use

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'management', component: FloorplanManagementComponent },
  {
    path: 'floorplan',
    loadChildren: () =>
      import('./features/floorplan/features.routes').then(
        (m) => m.FLOORPLAN_ROUTES
      ),
  },

  { path: '**', redirectTo: 'login', pathMatch: 'full' },
];
