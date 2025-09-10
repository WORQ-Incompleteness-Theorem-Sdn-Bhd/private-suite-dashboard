import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
  getAuth,
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
} from '@angular/fire/auth';
import { environment } from '../../environments/environment.dev';
import { Observable } from 'rxjs';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);
  private http = inject(HttpClient);

  constructor(
    private router: Router,
    private toastService: ToastService
  ) {
    this.auth = getAuth();
  }

  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      // Add additional parameters to help with COOP issues
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      const credential: any = await signInWithPopup(this.auth, provider);
      const user = credential.user;
      const tokenResponse = credential._tokenResponse;

      sessionStorage.setItem('accessToken', tokenResponse.oauthAccessToken);
      sessionStorage.setItem('refreshToken', tokenResponse.refreshToken);

      const userEmail = user.email;
      const allowedDomain = '@worq.space';

      if (!userEmail.endsWith(allowedDomain)) {
        this.toastService.error('You are not part of WORQ!');
        this.handleNonInternalUser(user);
      } else {
        this.handleInternalUser(user, user.uid);
      }
    } catch (error: any) {
      console.error('An error occured while signing in:', error);
      
      // Handle specific error cases
      if (error?.code === 'auth/popup-closed-by-user') {
        this.toastService.info('Sign-in cancelled');
      } else if (error?.code === 'auth/popup-blocked') {
        this.toastService.error('Pop-up blocked by browser. Please enable pop-ups and try again.');
      } else if (error?.code === 'auth/cancelled-popup-request') {
        this.toastService.info('Sign-in cancelled');
      } else if (error?.code === 'auth/network-request-failed') {
        this.toastService.error('Network error. Please check your connection and try again.');
      } else {
        this.toastService.error('Sign-in failed. Please try again.');
      }
      throw error; // Re-throw so login component can handle it
    }
  }

  private async handleNonInternalUser(userDetail: any) {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');

    try {
      const tokenResponse = await this.getUserToken(userDetail.uid).toPromise();
      sessionStorage.setItem('userAccessToken', tokenResponse.token);
      // await this.http
      //   .delete(environment.userUrl + `/${userDetail.uid}`)
      //   .toPromise();
      sessionStorage.removeItem('userAccessToken');
      await this.logout();
      this.toastService.warning('You are not a Worq employee');
    } catch (err) {
      this.toastService.error('Error processing user');
    }
  }

  private async handleInternalUser(user: object, uid: string) {
    try {
      const tokenResponse = await this.getUserToken(uid).toPromise();

      if (!tokenResponse?.token) {
        this.toastService.error('Authentication failed. Access denied.');
        await this.router.navigate(['/unauthorized']);
        return;
      }

      sessionStorage.setItem('userAccessToken', tokenResponse.token);

      // Step 3: Use the token to fetch user details securely
      // const userDetail = await this.userService.getUserById(uid).toPromise();

      // if (!userDetail) {
      //   await this.router.navigate(['/unauthorized']);
      //   return;
      // }

      // sessionStorage.setItem('user', JSON.stringify(userDetail));

      this.toastService.success('Welcome to WORQ Floorplan Dashboard!');
      await this.router.navigate(['/floorplan']);
    } catch (error: any) {
      console.error('Error in handleInternalUser:', error);
      
      // Handle specific backend connection errors
      if (error?.status === 0 || error?.message?.includes('ERR_CONNECTION_REFUSED')) {
        this.toastService.error('Backend server is not running. Please contact your administrator.');
      } else if (error?.status === 500) {
        this.toastService.error('Server error. Please try again later.');
      } else if (error?.status === 401) {
        this.toastService.error('Authentication failed. Please try again.');
      } else {
        this.toastService.error('Login failed. Please try again.');
      }
      throw error;
    }
  }

  // private handleSignInError(error: any) {
  //   console.error('Sign-in error:', error);

  //   if (error.code === 'auth/popup-closed-by-user') {
  //     this.toast.show('info', 'Sign-in cancelled');
  //   } else if (error.code === 'auth/popup-blocked') {
  //     this.toast.show(
  //       'warning',
  //       'Pop-up blocked by browser. Please enable pop-ups and try again.'
  //     );
  //   } else if (error.code === 'auth/cancelled-popup-request') {
  //     this.toast.show('info', 'Sign-in cancelled');
  //   } else {
  //     this.toast.show('error', 'Sign-in failed. Please try again.');
  //   }

  //   sessionStorage.removeItem('accessToken');
  //   sessionStorage.removeItem('refreshToken');
  // }

  async logout() {
    try {
      const user = this.auth.currentUser;
      if (user) {
        const accessToken = sessionStorage.getItem('accessToken');
        if (accessToken) {
          try {
            await fetch(
              `https://accounts.google.com/o/oauth2/revoke?token=${accessToken}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              }
            );
          } catch (revokeError) {
            console.warn('Token revocation failed:', revokeError);
          }
        }
      }

      await this.auth.signOut();
      sessionStorage.clear();
      this.toastService.info('Successfully logged out');
      await this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error during logout:', error);
      this.toastService.error('Logout failed');
    } finally {
      //  this.loadingService.hide();
    }
  }

  // getUserProfile(uid: string): Observable<any> {
  //   const token = sessionStorage.getItem('userAccessToken');
  //   if (!token) {
  //     console.error('User not authenticated');
  //     return new Observable((observer) =>
  //       observer.error('User not authenticated')
  //     );
  //   }

  //   return this.http.get<Users>(`${this.userUrl}/${uid}`);
  // }

  getUserToken(uid: any): Observable<any> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });

    const body = {
      uid: uid,
    };

    return this.http.post<any>(`${environment.authUrl}`, body, {
      headers,
    });
  }

  // getLoggedInUserId(): string | null {
  //   const userData = sessionStorage.getItem('user');
  //   if (userData) {
  //     const user = JSON.parse(userData);
  //     return user?.uid || null;
  //   }
  //   return null;
  // }
}
