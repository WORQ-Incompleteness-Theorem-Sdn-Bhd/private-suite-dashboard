import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment.dev';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const allowedDomains = [
    environment.baseUrl,
    environment.floorplanUrl,
    environment.bqUrl
  ];

  const userAccessToken = sessionStorage.getItem('userAccessToken');

  if (
    allowedDomains.some((domain) => req.url.startsWith(domain)) &&
    userAccessToken
  ) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });
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
