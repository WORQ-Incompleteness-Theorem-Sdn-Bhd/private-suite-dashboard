import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { ToastComponent } from '../../shared/components/toast.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ToastComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  buttonDisabled = false;

  constructor(
    private auth: AuthService,
    private toastService: ToastService
  ) {}

  async signInWithGoogle(): Promise<void> {
    this.buttonDisabled = true;
    try {
      await this.auth.signInWithGoogle();
      this.toastService.success('Successfully signed in!');
    } catch (err: any) {
      console.error('[Login] Sign-in failed:', err);
      
      // Handle specific error cases
      if (err?.code === 'auth/popup-closed-by-user') {
        this.toastService.info('Sign-in cancelled');
      } else if (err?.code === 'auth/popup-blocked') {
        this.toastService.error('Pop-up blocked by browser. Please enable pop-ups and try again.');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        this.toastService.info('Sign-in cancelled');
      } else {
        this.toastService.error('Sign-in failed. Please try again.');
      }
    } finally {
      this.buttonDisabled = false;
    }
  }
}
