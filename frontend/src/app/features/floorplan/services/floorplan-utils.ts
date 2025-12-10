import { Room } from '../../../core/models/room.model';

export function getFloorLabel(
  path: string,
  filtersOutlet: string,
  floorLabelOverrides: Record<string, Record<string, string>> = {}
): string {
  if (!path) return '';

//Rename floors for Sibelco Office
if (path.includes('6348ba804d92f2ab589dc7e3')){
    return 'Sibelco Office';
}

  if (path.includes('|')) {
    const floorId = path.split('|')[1];
    const floorLabel = path.split('|')[0];

if (floorId === '6348ba804d92f2ab589dc7e3') {
      return 'Sibelco Office';
    }

    if (/^\d+[A-Za-z]?$/.test(floorLabel)) {
      return `Level ${floorLabel}`;
    }

    return floorLabel;
  }

  const outlet = filtersOutlet;
  const baseWithExt = basename(path);
  const base = baseWithExt.replace(/\.(svg)$/i, '');

  const override = outlet && floorLabelOverrides[outlet]?.[baseWithExt];
  if (override) return override;

  const m = base.match(/(?:^|[_\-\s])(?:level|lvl|l)[_\-\s]?(\d+[A-Za-z]?)/i);
  if (m) return `Level ${m[1].toUpperCase()}`;

  const token = base.match(/(\d+[A-Za-z]?)/);
  if (token) return `Level ${token[1].toUpperCase()}`;

  return base.replace(/[_\-]/g, ' ').trim();
}

export function basename(path: string): string {
  return (path || '').split(/[\\/]/).pop() || path;
}

export function normalizeId(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function buildRoomIdIndex(rooms: Room[], normalizeIdFn: (val: string | undefined | null) => string): Map<string, Room> {
  const index = new Map<string, Room>();
  rooms.forEach((room) => {
    const candidates = [
      room.id,
      room.name,
      room.name?.replace(/\s+/g, ''),
      room.name?.replace(/\s+/g, '-'),
      room.name?.replace(/\s+/g, '_'),
    ];
    candidates.forEach((c) => {
      const key = normalizeIdFn(c);
      if (key) {
        index.set(key, room);
      }
    });
  });
  return index;
}

export function findRoomElementInDoc(doc: Document, room: Room): Element | null {
  const byId = doc.getElementById(room.id);
  if (byId) return byId;
  const variants = [
    room.name,
    room.name.replace(/\s+/g, ''),
    room.name.replace(/\s+/g, '-'),
    room.name.replace(/\s+/g, '_'),
  ];
  for (const v of variants) {
    const el = doc.getElementById(v);
    if (el) return el;
  }
  return null;
}

export function findRoomElementInline(rootSvg: SVGSVGElement, room: Room): Element | null {
  // Helper function to check if element is an actual shape (not text or group)
  const isShapeElement = (el: Element | null): boolean => {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    // Only accept actual shape elements
    return tag === 'path' || tag === 'polygon' || tag === 'rect' ||
           tag === 'circle' || tag === 'ellipse' || tag === 'line' || tag === 'polyline';
  };

  // Helper function to find shape element from a selector
  const findShapeElement = (selector: string): Element | null => {
    const elements = rootSvg.querySelectorAll(selector);

  // console.log(`🔍 findRoomElementInline: ${room.name} with selector "${selector}" found ${elements.length} elements`);

    // Log all elements found for debugging
    for (let i = 0; i < elements.length; i++) {
      const tag = elements[i].tagName.toLowerCase();
      const isShape = isShapeElement(elements[i]);
      const inDefs = !!elements[i].closest('defs');
      console.log(`  [${i}] <${tag}> ${isShape ? '✅ SHAPE' : '❌ ' + tag}${inDefs ? ' [IN <defs>]' : ''}`);

      // If it's a shape element, log its bbox
      if (isShape) {
        try {
          const bbox = (elements[i] as SVGGraphicsElement).getBBox();
          console.log(`       bbox: (${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)}, ${bbox.width.toFixed(1)}x${bbox.height.toFixed(1)})`);
        } catch (e) {
          console.log(`       bbox: error getting bbox`);
        }
      }
    }

    // First pass: look for shape elements NOT in <defs>
    for (let i = 0; i < elements.length; i++) {
      if (isShapeElement(elements[i]) && !elements[i].closest('defs')) {
        console.log(`  ✅ Selected element [${i}] <${elements[i].tagName.toLowerCase()}> (not in <defs>)`);
        return elements[i];
      }
    }
    return null;
  };

  // Try room.id first
  const byId = findShapeElement(`#${CSS.escape(room.id)}`);
  if (byId) return byId;

  // Try name variants
  const variants = [
    room.name,
    room.name.replace(/\s+/g, ''),
    room.name.replace(/\s+/g, '-'),
    room.name.replace(/\s+/g, '_'),
  ];
  for (const v of variants) {
    const el = findShapeElement(`#${CSS.escape(v)}`);
    if (el) return el;
  }

  return null;
}

export function getSvgViewBox(rootSvg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
  const vb = rootSvg.getAttribute('viewBox');
  if (!vb) return null;
  const [x, y, w, h] = vb.split(/\s+/).map(Number);
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
  return { x, y, w, h };
}

export function isIOSDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Extract floor_id from a floorplan URL
 * URLs can be in formats like:
 * - Firebase Storage: https://firebasestorage.googleapis.com/v0/b/bucket/o/officeId%2FfloorId%2Ffilename.svg?alt=media&token=...
 * - Backend API: /api/floorplans/officeId/floorId?raw=1
 * - Signed URLs with encoded paths
 *
 * @param url The URL to extract floor_id from
 * @param rooms Optional array of rooms to match URL against room SVG paths (fallback method)
 * @returns The extracted floor_id or null if not found
 */
export function extractFloorIdFromUrl(url: string, rooms?: any[]): string | null {
  if (!url) return null;

  try {
    // Decode URL-encoded paths
    let decodedUrl = url;
    try {
      decodedUrl = decodeURIComponent(url);
    } catch (e) {
      // If decoding fails, use original URL
    }

    // Try to extract from URL path structure: officeId/floorId/filename
    // Check for backend API format: /api/floorplans/officeId/floorId
    const apiMatch = decodedUrl.match(/\/api\/floorplans\/[^\/]+\/([0-9a-f]{24})(?:\/|\?|$)/i);
    if (apiMatch && apiMatch[1]) {
      return apiMatch[1];
    }

    // Check for Firebase Storage URL format with encoded path
    // Format: /o/officeId%2FfloorId%2Ffilename.svg or /o/officeId/floorId/filename.svg
    const firebaseEncodedMatch = decodedUrl.match(/\/o\/([^\/\?]+)/);
    if (firebaseEncodedMatch && firebaseEncodedMatch[1]) {
      const path = firebaseEncodedMatch[1];
      const parts = path.split(/[\/%2F]/).filter(p => p.length > 0);
      if (parts.length >= 2) {
        // parts[0] = officeId, parts[1] = floorId
        // Check if parts[1] looks like a floor_id (MongoDB ObjectId format)
        const potentialFloorId = parts[1];
        if (/^[0-9a-f]{24}$/i.test(potentialFloorId)) {
          return potentialFloorId;
        }
      }
    }

    // Check for direct path format (if URL contains the path directly)
    // Pattern: /officeId/floorId/ or officeId/floorId/
    const pathMatch = decodedUrl.match(/\/([0-9a-f]{24})\/([0-9a-f]{24})(?:\/|\?|$)/i);
    if (pathMatch && pathMatch[2]) {
      return pathMatch[2];
    }

    // Try to match floor_id from rooms that have this URL in their SVG
    // This is a fallback if URL structure doesn't contain floor_id directly
    if (rooms && rooms.length > 0) {
      // Normalize URLs for comparison (remove query params, decode)
      const normalizeForComparison = (u: string) => {
        try {
          return decodeURIComponent(u.split('?')[0].toLowerCase());
        } catch {
          return u.split('?')[0].toLowerCase();
        }
      };

      const normalizedUrl = normalizeForComparison(url);

      // Check if any room's SVG matches this URL
      for (const room of rooms) {
        if (room.svg && room.floor_id) {
          const svgArray = Array.isArray(room.svg) ? room.svg : [room.svg];
          for (const svg of svgArray) {
            const normalizedSvg = normalizeForComparison(svg);
            // Check if URLs match (either exact or one contains the other)
            if (normalizedUrl === normalizedSvg ||
                normalizedUrl.includes(normalizedSvg) ||
                normalizedSvg.includes(normalizedUrl)) {
              return room.floor_id;
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Error extracting floor_id from URL:', url, error);
  }

  return null;
}

