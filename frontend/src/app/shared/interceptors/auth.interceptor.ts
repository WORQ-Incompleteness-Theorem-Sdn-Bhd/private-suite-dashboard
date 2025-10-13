import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment.prod';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const allowedDomains = [
    environment.baseUrl 
  ];

  const userAccessToken = sessionStorage.getItem('userAccessToken');

  console.log('🔐 Auth Interceptor - URL:', req.url);
  console.log('🔐 Auth Interceptor - Token exists:', !!userAccessToken);
  console.log('🔐 Auth Interceptor - Token preview:', userAccessToken ? `${userAccessToken.substring(0, 20)}...` : 'No token');

  if (
    allowedDomains.some((domain) => req.url.startsWith(domain)) &&
    userAccessToken
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
        // Token expired or invalid - clear it and redirect to login
        sessionStorage.removeItem('userAccessToken');
        console.error('Authentication failed - token expired or invalid');
      }
      return throwError(() => error);
    })
  );
};
