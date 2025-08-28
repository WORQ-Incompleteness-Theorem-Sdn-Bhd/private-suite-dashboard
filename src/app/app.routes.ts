import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  {
    path: 'floorplan',
    loadChildren: () =>
      import('./features/floorplan/features.routes').then(
        (m) => m.FLOORPLAN_ROUTES
      ),
  },
  { path: '**', redirectTo: 'login' },
];
