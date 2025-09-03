import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { FormsModule } from '@angular/forms'; // 👈 Add this
import { AuthService } from './shared/services/auth.service';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FormsModule, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'private-suite-dashboard';

  constructor(private auth: AuthService, private router: Router) {}

  logout() {
    this.auth.logout();
  }

  isLoginPage(): boolean {
    return this.router.url === '/login';
  }
}
