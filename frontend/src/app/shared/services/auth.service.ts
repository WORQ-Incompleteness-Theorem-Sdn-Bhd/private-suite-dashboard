import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
  getAuth,
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);
  private http = inject(HttpClient);

  constructor(private router: Router) {
    this.auth = getAuth();
  }

  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const credential: any = await signInWithPopup(this.auth, provider);
      const user = credential.user;
      const tokenResponse = credential._tokenResponse;

      sessionStorage.setItem('accessToken', tokenResponse.oauthAccessToken);
      sessionStorage.setItem('refreshToken', tokenResponse.refreshToken);

      const userEmail = user.email;
      const allowedDomain = '@worq.space';

      if (!userEmail.endsWith(allowedDomain)) {
        alert('You are not part of WORQ!');
      } else {
        this.router.navigate(['/floorplan']);
      }
    } catch (error: any) {
      console.error('An error occured while signing in');
    }
  }

  // private async handleNonInternalUser(userDetail: Users) {
  //   sessionStorage.removeItem('accessToken');
  //   sessionStorage.removeItem('refreshToken');

  //   try {
  //     const tokenResponse = await this.getUserToken(
  //       userDetail.uid,
  //       userDetail.email
  //     ).toPromise();
  //     sessionStorage.setItem('userAccessToken', tokenResponse.token);
  //     await this.http
  //       .delete(environment.userUrl + `/${userDetail.uid}`)
  //       .toPromise();
  //     sessionStorage.removeItem('userAccessToken');
  //     await this.logout();
  //     this.toast.show('warning', 'You are not a Worq employee');
  //   } catch (err) {
  //     this.toast.show('error', 'Error processing user');
  //   }
  // }

  // private async handleInternalUser(user: object, uid: string, email: string) {
  //   try {
  //     // Step 1: Get JWT token first
  //     const tokenResponse = await this.getUserToken(uid, email).toPromise();

  //     if (!tokenResponse?.token) {
  //       await this.router.navigate(['/unauthorized']);
  //       return;
  //     }

  //     // Step 2: Store token securely
  //     sessionStorage.setItem('userAccessToken', tokenResponse.token);

  //     // Step 3: Use the token to fetch user details securely
  //     const userDetail = await this.userService.getUserById(uid).toPromise();

  //     if (!userDetail) {
  //       await this.router.navigate(['/unauthorized']);
  //       return;
  //     }

  //     sessionStorage.setItem('user', JSON.stringify(userDetail));

  //     this.toast.show('success', `Welcome ${userDetail.name}`);
  //     await this.router.navigate(['/dashboard']);
  //   } catch (error) {
  //     console.error('Error in handleInternalUser:', error);
  //     this.toast.show('error', 'Login failed');
  //     throw error;
  //   }
  // }

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
      await this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error during logout:', error);
      //  this.toast.show('error', 'Logout failed');
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

  // getUserToken(uid: any, email: any): Observable<any> {
  //   const headers = new HttpHeaders({ 'Content-Type': 'application/json' });

  //   const body = {
  //     uid: uid,
  //     email: email,
  //   };

  //   return this.http.post<any>(`${environment.userUrl}/token`, body, {
  //     headers,
  //   });
  // }

  // getLoggedInUserId(): string | null {
  //   const userData = sessionStorage.getItem('user');
  //   if (userData) {
  //     const user = JSON.parse(userData);
  //     return user?.uid || null;
  //   }
  //   return null;
  // }
}
