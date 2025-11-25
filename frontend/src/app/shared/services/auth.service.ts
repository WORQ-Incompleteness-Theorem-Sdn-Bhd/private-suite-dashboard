import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {
  getAuth,
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
} from '@angular/fire/auth';
import { environment } from '../../environments/environment';
import { Observable, firstValueFrom, Subscription, interval, BehaviorSubject } from 'rxjs';
import { ToastService } from './toast.service';
import { filter, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private auth = inject(Auth);
  private http = inject(HttpClient);
  private refreshSubscription: Subscription | null = null;

  // NEW: A signal to tell components when Auth is done loading
  private authReadySubject = new BehaviorSubject<boolean>(false);
  public authReady$ = this.authReadySubject.asObservable();

  constructor(
    private router: Router,
    private toastService: ToastService
  ) {
    this.auth = getAuth();

    // 1. REMOVED the setPersistence block (Fixes the TypeError)

    // 2. Listen for Firebase User
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        console.log('🔄 Session restored. Refreshing backend token...');
        // Wait for the token refresh to complete BEFORE letting the app proceed
        await this.refreshBackendToken(user.uid);
        this.startAutoRefresh(user.uid);
        
        // Signal that auth is ready
        this.authReadySubject.next(true);
      } else {
        this.stopAutoRefresh();
        // Even if no user, auth initialization is "done" (state is known)
        this.authReadySubject.next(true);
      }
    });
  }

  // Helper to wait for auth before making requests
  ensureAuthReady(): Observable<boolean> {
    return this.authReady$.pipe(
      filter(ready => ready), // Wait until ready becomes true
      take(1)
    );
  }

  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const credential: any = await signInWithPopup(this.auth, provider);
      const user = credential.user;
      const tokenResponse = credential._tokenResponse;

      sessionStorage.setItem('accessToken', tokenResponse.oauthAccessToken);
      sessionStorage.setItem('refreshToken', tokenResponse.refreshToken);

      const userEmail = user.email;
      const allowedDomain = '@worq.space';

      if (!userEmail || !userEmail.endsWith(allowedDomain)) {
        this.handleNonInternalUser(user);
      } else {
        this.handleInternalUser(user, user.uid);
      }
    } catch (error: any) {
      console.error('Sign-in error:', error);
      // ... (Your error handling logic remains here)
      this.toastService.error('Sign-in failed');
    }
  }

  private async handleNonInternalUser(userDetail: any) {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    try {
      const tokenResponse = await firstValueFrom(this.getUserToken(userDetail.uid));
      sessionStorage.setItem('userAccessToken', tokenResponse.token);
      sessionStorage.removeItem('userAccessToken');
      await this.logout();
      this.toastService.warning('You are not a Worq employee', 5000);
    } catch (err) {
      this.toastService.error('Error processing user');
    }
  }

  private async handleInternalUser(user: any, uid: string) {
    try {
      await this.refreshBackendToken(uid);
      this.startAutoRefresh(uid);
      const userName = user.displayName || user.email?.split('@')[0] || 'User';
      this.toastService.success(`Welcome to WORQ Floorplan Dashboard ${userName}!`, 5000);
      await this.router.navigate(['/floorplan']);
    } catch (error: any) {
      console.error('Error in handleInternalUser:', error);
      this.toastService.error('Login failed.');
    }
  }

  private async refreshBackendToken(uid: string): Promise<void> {
    try {
      const tokenResponse = await firstValueFrom(this.getUserToken(uid));
      if (tokenResponse?.token) {
        sessionStorage.setItem('userAccessToken', tokenResponse.token);
        // console.log('✅ Backend token refreshed');
      }
    } catch (error) {
      console.error('❌ Failed to refresh backend token:', error);
    }
  }

  private startAutoRefresh(uid: string) {
    this.stopAutoRefresh(); 
    const refreshInterval = 50 * 60 * 1000; // 50 mins
    this.refreshSubscription = interval(refreshInterval).subscribe(() => {
      console.log('⏰ Auto-refreshing token...');
      this.refreshBackendToken(uid);
    });
  }

  private stopAutoRefresh() {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
      this.refreshSubscription = null;
    }
  }

  ngOnDestroy() {
    this.stopAutoRefresh();
  }

  async logout() {
    this.stopAutoRefresh();
    await this.auth.signOut();
    sessionStorage.clear();
    this.router.navigate(['/login']);
  }

  getUserToken(uid: any): Observable<any> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    return this.http.post<any>(`${environment.apiBaseUrl}/api/token`, { uid }, { headers });
  }
}