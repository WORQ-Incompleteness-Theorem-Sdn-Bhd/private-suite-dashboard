import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment.dev';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const allowedDomains = [environment.baseUrl];
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

  return next(req);
};
