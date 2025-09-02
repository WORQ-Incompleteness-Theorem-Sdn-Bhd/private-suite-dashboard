import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  buttonDisabled = false;

  constructor(private auth: AuthService) {}

  async signInWithGoogle(): Promise<void> {
    this.buttonDisabled = true;
    try {
      await this.auth.signInWithGoogle();
    } catch (err) {
      console.error('[Login] Sign-in failed:', err);
    } finally {
      this.buttonDisabled = false;
    }
  }
}
