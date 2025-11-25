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
  const byId = rootSvg.querySelector(`#${CSS.escape(room.id)}`);
  if (byId) return byId;

  const variants = [
    room.name,
    room.name.replace(/\s+/g, ''),
    room.name.replace(/\s+/g, '-'),
    room.name.replace(/\s+/g, '_'),
  ];
  for (const v of variants) {
    const el = rootSvg.querySelector(`#${CSS.escape(v)}`);
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

