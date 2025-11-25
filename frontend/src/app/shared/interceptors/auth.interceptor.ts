import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment'; // Verify this path matches your project structure
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // 1. Define allowed domains (security)
  const allowedDomains = [
    environment.apiBaseUrl, 
  ].filter(Boolean);

  // 2. Get the token from Session Storage (where AuthService puts it)
  const userAccessToken = sessionStorage.getItem('userAccessToken');

  // 3. Check if we should attach the token
  const isAllowedDomain = allowedDomains.some((domain) => 
    typeof domain === 'string' && domain.length && req.url.startsWith(domain)
  );

  if (userAccessToken && isAllowedDomain) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });
  }

  // 4. Handle errors (Optional: clear token on 401)
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Only clear if it was actually set
        if (sessionStorage.getItem('userAccessToken')) {
          console.warn('Token expired or invalid. Clearing session.');
          sessionStorage.removeItem('userAccessToken');
        }
      }
      return throwError(() => error);
    })
  );
};