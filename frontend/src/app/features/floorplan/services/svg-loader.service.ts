import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { FloorService } from '../../../core/services/floor.service';
import { OfficeService } from '../../../core/services/office.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Room } from '../../../core/models/room.model';
import { Floor } from '../../../core/models/floor.model';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { environment } from '../../../environments/environment.dev';

@Injectable({
  providedIn: 'root'
})
export class SvgLoaderService {
  private safeUrlCache = new Map<string, SafeResourceUrl>();
  private svgContentCache = new Map<string, string>(); // Cache raw SVG content to avoid duplicate HTTP requests

  constructor(
    private floorService: FloorService,
    private officeService: OfficeService,
    private toastService: ToastService,
    private sanitizer: DomSanitizer,
    private http: HttpClient
  ) {}

  normalizeUrlKey(url: string | null): string {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return url.split('?')[0].split('#')[0];
    }
  }

  getSafeUrl(url: string): SafeResourceUrl {
    const cached = this.safeUrlCache.get(url);
    if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.safeUrlCache.set(url, safe);
    return safe;
  }

  basename(path: string): string {
    return (path || '').split(/[\\/]/).pop() || path;
  }

  detectSvgSource(url: string): 'firebase' | 'unknown' {
    if (!url) return 'unknown';
    const u = String(url).toLowerCase().trim();

    if (u.includes(environment.apiBaseUrl.toLowerCase()) || u.includes('/api/floorplans')) {
      return 'firebase';
    }

    if (
      u.includes('firebasestorage.googleapis.com') ||
      u.includes('storage.googleapis.com') ||
      u.includes('firebase') ||
      (u.startsWith('https://') && u.includes('googleapis.com'))
    ) {
      return 'firebase';
    }

    if (u.startsWith('http://') || u.startsWith('https://')) {
      return 'firebase';
    }

    if (u.startsWith('gs://')) {
      return 'firebase';
    }

    return 'unknown';
  }

  async updateSelectedOutletSvgs(
    outletId: string,
    rooms: Room[],
    floors: Floor[],
    floorIdToFloorMap: Map<string, Floor>
  ): Promise<{
    selectedOutletSvgs: string[];
    floorOptions: string[];
    noSvgsFromFirebase: boolean;
  }> {
    const selectedOffice = this.officeService.getOffices().find(office => office.id === outletId);
    if (!selectedOffice) {
      return {
        selectedOutletSvgs: [],
        floorOptions: [],
        noSvgsFromFirebase: false
      };
    }

    const outletRooms = rooms.filter((r) => r.outlet === selectedOffice.displayName);

    const floorIds = new Set<string>();
    outletRooms.forEach(room => {
      if (room.floor_id) {
        floorIds.add(room.floor_id);
      }
    });

    const floorOptions = Array.from(floorIds)
      .map(floorId => {
        const floor = floorIdToFloorMap.get(floorId);
        if (floor) {
          const floorLabel = this.floorService.getFloorDisplayLabel(floorId, floors);
          return `${floorLabel}|${floorId}`;
        } else {

          return `${floorId}|${floorId}`;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aLabel = a!.split('|')[0];
        const bLabel = b!.split('|')[0];

        if (aLabel === 'Sibelco Office') return -1;
        if (bLabel === 'Sibelco Office') return 1;

        const aNum = parseInt(aLabel) || 999;
        const bNum = parseInt(bLabel) || 999;
        return aNum - bNum;
      }) as string[];

    return new Promise((resolve) => {
      this.floorService.getAllSvgFilesForOutlet(outletId).pipe(
        catchError(error => {

          this.toastService.error('Failed to load floorplan SVGs');
          return of([]);
        })
      ).subscribe((svgs: string[]) => {
        if (svgs && svgs.length > 0) {
          resolve({
            selectedOutletSvgs: svgs,
            floorOptions,
            noSvgsFromFirebase: false
          });
          return;
        }

        // Fallback to office-level cloud SVGs
        const officeSvgs = selectedOffice?.svg;
        const normalizeArray = (value: string | string[] | undefined): string[] => 
          Array.isArray(value) ? value : (value ? [value] : []);
        const isCloudUrl = (u: string) => 
          typeof u === 'string' && (u.startsWith('https://') || u.startsWith('http://'));

        const cloudSvgs = normalizeArray(officeSvgs).filter(isCloudUrl);
        
        if (cloudSvgs.length > 0) {
          resolve({
            selectedOutletSvgs: cloudSvgs,
            floorOptions,
            noSvgsFromFirebase: false
          });
        } else {
          resolve({
            selectedOutletSvgs: [],
            floorOptions,
            noSvgsFromFirebase: true
          });
        }
      });
    });
  }

  async loadInlineSvgs(
    urls: string[],
    svgHtmlMap: Map<string, SafeHtml>,
    onComplete: () => void
  ): Promise<void> {
    const urlToKeyMap = new Map<string, string>();
    urls.forEach(url => {
      const key = this.normalizeUrlKey(url);
      urlToKeyMap.set(url, key);
    });
    
    const toFetch = urls.filter(u => {
      const key = urlToKeyMap.get(u)!;
      return !svgHtmlMap.has(key);
    });
    
    if (toFetch.length === 0) {
      onComplete();
      return;
    }

    let completed = 0;
    let failed = 0;
    const total = toFetch.length;

    const checkComplete = () => {
      if (completed + failed >= total) {
        if (failed > 0) {

        }
        onComplete();
      }
    };

    const normalizedUrls = await Promise.all(
      toFetch.map(async url => {
        try {
          const normalizedUrl = await this.normalizeToDownloadUrl(url);
          return { originalUrl: url, normalizedUrl };
        } catch (err) {

          return { originalUrl: url, normalizedUrl: url };
        }
      })
    );

    normalizedUrls.forEach(({ originalUrl, normalizedUrl }) => {
      const key = this.normalizeUrlKey(originalUrl);

      // Check cache first to avoid duplicate HTTP requests
      const cachedContent = this.svgContentCache.get(key);
      if (cachedContent) {
        const processedSvgText = this.processSvgForCompactDisplay(cachedContent);
        const safe = this.sanitizer.bypassSecurityTrustHtml(processedSvgText);
        svgHtmlMap.set(key, safe);
        completed++;
        checkComplete();
        return;
      }

      // Fetch from server if not cached
      const token = sessionStorage.getItem('userAccessToken') || '';
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      this.http.get(normalizedUrl, { responseType: 'text', headers }).subscribe({
        next: (svgText) => {
          // Cache the raw SVG content
          this.svgContentCache.set(key, svgText);

          const processedSvgText = this.processSvgForCompactDisplay(svgText);
          const safe = this.sanitizer.bypassSecurityTrustHtml(processedSvgText);
          svgHtmlMap.set(key, safe);
          completed++;
          checkComplete();
        },
        error: (err) => {

          const fallbackSvg = `<svg width="100%" height="200" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f3f4f6"/>
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="14" fill="#6b7280">
              SVG load failed (${err.status || 'Network Error'})
            </text>
          </svg>`;
          svgHtmlMap.set(key, this.sanitizer.bypassSecurityTrustHtml(fallbackSvg));
          failed++;
          checkComplete();
          if (failed === total) {
            this.toastService.error('Failed to load floorplan SVGs');
          }
        }
      });
    });
  }

  processSvgForCompactDisplay(svgText: string): string {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svgText;
    const svgElement = tempDiv.querySelector('svg');

    if (!svgElement) return svgText;

    svgElement.setAttribute('width', '100%');
    svgElement.removeAttribute('height');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    if (!svgElement.getAttribute('xmlns')) {
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!svgElement.getAttribute('xmlns:xlink')) {
      svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    const existingStyle = svgElement.getAttribute('style') || '';
    const cleanedStyle = existingStyle
      .replace(/display\s*:\s*none\s*;?/gi, '')
      .replace(/visibility\s*:\s*hidden\s*;?/gi, '');
    svgElement.setAttribute(
      'style',
      `${cleanedStyle};max-width: 100%; height: auto; display: block;`.replace(/^;+/,'')
    );
    
    if (!svgElement.getAttribute('viewBox')) {
      const widthAttr = svgElement.getAttribute('width') || '';
      const heightAttr = svgElement.getAttribute('height') || '';
      const widthNum = parseFloat(widthAttr) || 1000;
      const heightNum = parseFloat(heightAttr) || 1000;
      svgElement.setAttribute('viewBox', `0 0 ${widthNum} ${heightNum}`);
    }

    return tempDiv.innerHTML;
  }

  private async normalizeToDownloadUrl(url: string): Promise<string> {
    try {
      if (!url) return url;

      // If it's already a backend API URL, return as-is
      if (url.includes(environment.apiBaseUrl) || url.includes('/api/floorplans')) {
        return url;
      }

      // Convert Firebase Storage URLs (signed or unsigned) to backend proxy URLs to avoid CORS
      // Signed URLs from storage.googleapis.com cause CORS errors when fetched directly from Angular
      // Backend proxy at /api/floorplans/:officeId/:floorId?raw=1 streams SVG without CORS issues

      // Match signed URLs: https://storage.googleapis.com/bucket/officeId%2FfloorId%2Ffile.svg?X-Goog-Algorithm=...
      const signedUrlMatch = url.match(/https:\/\/storage\.googleapis\.com\/[^/]+\/([^?]+)(\?|$)/);
      if (signedUrlMatch) {
        const encodedPath = signedUrlMatch[1];
        // Decode URL-encoded path (e.g., "officeId%2FfloorId%2Ffile.svg" -> "officeId/floorId/file.svg")
        const decodedPath = decodeURIComponent(encodedPath);
        const pathParts = decodedPath.split('/');

        if (pathParts.length >= 2) {
          const officeId = pathParts[0];
          const floorId = pathParts[1];
          // Use backend proxy to avoid CORS
          const proxyUrl = `${environment.apiBaseUrl}/api/floorplans/${officeId}/${floorId}?raw=1`;
          return proxyUrl;
        }
      }

      // Match firebasestorage.googleapis.com URLs
      if (url.includes('firebasestorage.googleapis.com/v0/b/')) {
        const pathMatch = url.match(/\/o\/([^?]+)/);
        if (pathMatch) {
          const encodedPath = pathMatch[1];
          const decodedPath = decodeURIComponent(encodedPath);
          const pathParts = decodedPath.split('/');

          if (pathParts.length >= 2) {
            const officeId = pathParts[0];
            const floorId = pathParts[1];
            const proxyUrl = `${environment.apiBaseUrl}/api/floorplans/${officeId}/${floorId}?raw=1`;
            return proxyUrl;
          }
        }
        // If we can't parse the path, return original URL
        return url;
      }

      // Handle gs:// URLs
      if (url.startsWith('gs://')) {
        const withoutScheme = url.slice(5);
        const firstSlash = withoutScheme.indexOf('/');
        const objectPath = withoutScheme.slice(firstSlash + 1);
        const pathParts = objectPath.split('/');

        if (pathParts.length >= 2) {
          const officeId = pathParts[0];
          const floorId = pathParts[1];
          const proxyUrl = `${environment.apiBaseUrl}/api/floorplans/${officeId}/${floorId}?raw=1`;
          return proxyUrl;
        }
      }

      return url;
    } catch (err) {

      return url;
    }
  }

  private ensureFloorplansPrefix(path: string): string {
    if (path.startsWith('floorplans/')) return path;
    return path;
  }

  /**
   * Clear SVG cache - useful when floorplans are uploaded/deleted
   * @param url Optional specific URL to clear. If not provided, clears entire cache.
   */
  clearCache(url?: string): void {
    if (url) {
      const key = this.normalizeUrlKey(url);
      this.svgContentCache.delete(key);
      this.safeUrlCache.delete(url);
    } else {
      this.svgContentCache.clear();
      this.safeUrlCache.clear();
    }
  }
}

