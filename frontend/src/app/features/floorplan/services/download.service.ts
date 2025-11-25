import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import * as FloorplanUtils from './floorplan-utils';

@Injectable({
  providedIn: 'root'
})
export class DownloadService {
  async downloadFloorplanWithDetails(
    format: 'svg' | 'png',
    svgObjects: any,
    selectedRoom: Room | null,
    objectToOriginalViewBox: WeakMap<HTMLObjectElement, string>,
    findRoomElementInDoc: (doc: Document, room: Room) => Element | null
  ): Promise<void> {
    const first = svgObjects?.first?.nativeElement as HTMLObjectElement | undefined;
    const doc = first?.contentDocument as Document | null;
    const rootSvg = doc?.querySelector('svg') as SVGSVGElement | null;
    if (!doc || !rootSvg) return;

    const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;

    const originalViewBox = first
      ? objectToOriginalViewBox.get(first)
      : null;
    if (originalViewBox) {
      svgClone.setAttribute('viewBox', originalViewBox);
    }

    if (selectedRoom) {
      const el = findRoomElementInDoc(doc, selectedRoom);
      if (el && (el as any).getBBox) {
        const bbox = (el as any).getBBox();
        const overlayGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
        const lines = [
          `${selectedRoom.name}`,
          `Status: ${selectedRoom.status}`,
          `Capacity: ${selectedRoom.capacity}`,
          `Type: ${selectedRoom.type}`,
          `Area: ${selectedRoom.area} sqft`,
          `Price: RM ${selectedRoom.price}`,
          `Deposit: RM ${selectedRoom.deposit}`,
        ];

        if (selectedRoom.video) {
          lines.push(`Video: ${selectedRoom.video}`);
        }

        const pad = 10;
        const lineHeight = 18;
        const boxWidth = 320;
        const boxHeight = lineHeight * (lines.length + 1) + pad * 2;
        let boxX = bbox.x + bbox.width + 10;
        let boxY = Math.max(0, bbox.y - 10);

        const vbAttr = svgClone.getAttribute('viewBox');
        if (vbAttr) {
          const [vx, vy, vw, vh] = vbAttr.split(/\s+/).map(Number);
          if (!Number.isNaN(vw) && !Number.isNaN(vh)) {
            if (boxX + boxWidth > vx + vw) boxX = vx + vw - boxWidth - 5;
            if (boxX < vx) boxX = vx + 5;
            if (boxY + boxHeight > vy + vh) boxY = vy + vh - boxHeight - 5;
            if (boxY < vy) boxY = vy + 5;
          }
        }

        rect.setAttribute('x', String(boxX));
        rect.setAttribute('y', String(boxY));
        rect.setAttribute('rx', '6');
        rect.setAttribute('ry', '6');
        rect.setAttribute('width', String(boxWidth));
        rect.setAttribute('height', String(boxHeight));
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#e5e7eb');
        rect.setAttribute('stroke-width', '1');

        text.setAttribute('x', String(boxX + pad));
        text.setAttribute('y', String(boxY + pad + lineHeight));
        text.setAttribute('fill', '#111827');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');

        lines.forEach((line, idx) => {
          const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(boxX + pad));
          tspan.setAttribute('dy', idx === 0 ? '0' : String(lineHeight));
          tspan.textContent = line;
          text.appendChild(tspan);
        });

        overlayGroup.appendChild(rect);
        overlayGroup.appendChild(text);
        svgClone.appendChild(overlayGroup);
      }
    }

    if (format === 'svg') {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);
      const blob = new Blob([svgString], {
        type: 'image/svg+xml;charset=utf-8',
      });
      FloorplanUtils.downloadBlob('floorplan-with-details.svg', blob);
      return;
    }

    const vb = svgClone.getAttribute('viewBox') || '0 0 1000 1000';
    const [, , vwStr, vhStr] = vb.split(/\s+/);
    const vw = Number(vwStr) || 1000;
    const vh = Number(vhStr) || 1000;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vw * scale));
    canvas.height = Math.max(1, Math.floor(vh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const img = new Image();
    const svgBlob = new Blob([svgData], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const svgUrl = URL.createObjectURL(svgBlob);
    await new Promise<void>((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);
        resolve();
      };
      img.src = svgUrl;
    });

    if (format === 'png') {
      const pngBlob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res as any, 'image/png')
      );
      if (pngBlob) FloorplanUtils.downloadBlob('floorplan-with-details.png', pngBlob);
    }
  }

  downloadFloorplan(selectedOutletSvgs: string[], sanitizer: any): void {
    if (!selectedOutletSvgs || selectedOutletSvgs.length === 0) {
      console.warn('No floorplan to download.');
      return;
    }

    const svgUrl = selectedOutletSvgs[0];
    const sanitizedUrl = sanitizer.sanitize(
      4,
      sanitizer.bypassSecurityTrustResourceUrl(svgUrl)
    );

    if (!sanitizedUrl) {
      console.error('SVG URL could not be sanitized.');
      return;
    }

    const link = document.createElement('a');
    link.href = sanitizedUrl;
    link.download = 'floorplan.svg';
    link.click();
  }
}


