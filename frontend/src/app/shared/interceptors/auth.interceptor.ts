import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // All API endpoints are under apiBaseUrl
  const allowedDomains = [
    environment.apiBaseUrl, // All API endpoints (auth, bigquery, floorplans)
  ].filter(Boolean);

  const userAccessToken = sessionStorage.getItem('userAccessToken');

  console.log('🔐 Auth Interceptor - URL:', req.url);
  console.log('🔐 Auth Interceptor - Token exists:', !!userAccessToken);
  console.log('🔐 Auth Interceptor - Token preview:', userAccessToken ? `${userAccessToken.substring(0, 20)}...` : 'No token');

  if (
    userAccessToken &&
    allowedDomains.some((domain) => typeof domain === 'string' && domain.length && req.url.startsWith(domain))
  ) {
    console.log('🔐 Auth Interceptor - Adding Authorization header');
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });
  } else {
    console.log('🔐 Auth Interceptor - No token or URL not in allowed domains');
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Only clear token if it exists (meaning it was sent but rejected)
        const hadToken = !!sessionStorage.getItem('userAccessToken');
        if (hadToken) {
          sessionStorage.removeItem('userAccessToken');
          console.error('Authentication failed - token expired or invalid');
        } else {
          console.error('Authentication failed - no token found');
        }
      }
      return throwError(() => error);
    })
  );
};