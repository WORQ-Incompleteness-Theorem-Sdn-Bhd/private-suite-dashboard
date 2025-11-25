import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { OfficeService } from '../../../core/services/office.service';
import { ColorPaxService } from './color-pax.service';
import { Filters } from './dropdown-filter.service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as FloorplanUtils from './floorplan-utils';

export interface PdfExportParams {
  svgHosts: any[];
  rooms: Room[];
  filteredRooms: Room[];
  selectedSuites: string[];
  filters: Filters;
  selectedStartDate: string;
  selectedEndDate: string;
  displayedSvgs: string[];
  availabilityByRoomId: Map<string, 'free' | 'occupied'>;
  paxPalette: readonly string[];
  paxBuckets: Array<{ max: number; label: string }>;
  paxBucketColorMap?: Map<number, string>;
  toStatusUnion: (status: string) => 'Available' | 'Occupied';
  getFloorLabel: (path: string) => string;
  findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null;
  hexToRgb: (hex: string) => { r: number; g: number; b: number } | null;
  pdfQuality: {
    scale: number;
    quality: number;
    dimensions: { width: number; height: number };
  };
}

@Injectable({
  providedIn: 'root'
})
export class PdfExportService {
  constructor(
    private officeService: OfficeService,
    private colorPaxService: ColorPaxService
  ) {}

  // HELPER: Determines the box color based on room capacity
  private getRoomColorForPdf(room: Room, params: PdfExportParams): string {
    const capacity = room.capacity || 1;

    for (let i = 0; i < params.paxBuckets.length; i++) {
      const bucket = params.paxBuckets[i];
      const prevMax = i === 0 ? 0 : params.paxBuckets[i - 1].max;

      if (capacity > prevMax && capacity <= bucket.max) {
        if (params.paxBucketColorMap && params.paxBucketColorMap.has(bucket.max)) {
          return params.paxBucketColorMap.get(bucket.max)!;
        }
        return params.paxPalette[i] || '#cccccc';
      }
    }
    return params.paxPalette[params.paxPalette.length - 1] || '#cccccc';
  }

  async exportFloorplanAsPdf(params: PdfExportParams): Promise<jsPDF> {
    const pdf = new jsPDF('landscape', 'mm', 'a4');

    pdf.setProperties({
      title: 'Private Suite Dashboard - Floorplan',
      subject: 'Floorplan Export',
      author: 'Private Suite Dashboard',
      creator: 'Private Suite Dashboard',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    // const pageHeight = pdf.internal.pageSize.getHeight(); // Unused

    const svgHosts = params.svgHosts;
    if (svgHosts.length === 0) {
      throw new Error('No floorplan data available for export');
    }

    let firstPageRendered = false;
    for (let idx = 0; idx < svgHosts.length; idx++) {
      const hostRef = svgHosts[idx];
      const hostEl = hostRef.nativeElement as HTMLDivElement;
      const rootSvg = hostEl.querySelector('svg') as SVGSVGElement | null;

      if (!rootSvg) {
        console.warn(`❌ No SVG found in host ${idx + 1}`);
        continue;
      }

      const shouldIncludeThisPage = (() => {
        if (!rootSvg) return false;
        if ((params.selectedSuites?.length ?? 0) === 0) return true;
        return params.selectedSuites.some((suiteName) => {
          const room = params.rooms.find(r => r.name === suiteName);
          if (!room) return false;
          const el = params.findRoomElementInline(rootSvg, room);
          return !!el;
        });
      })();

      if (!shouldIncludeThisPage) {
        continue;
      }

      if (firstPageRendered) {
        pdf.addPage('landscape');
      } else {
        firstPageRendered = true;
      }

      pdf.setFontSize(16);
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 20, 15);
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      let yPos = 25;

      if (params.filters.outlet !== 'Select Outlet') {
        const selectedOffice = this.officeService.getOffices().find(office => office.id === params.filters.outlet);
        const outletDisplayName = selectedOffice ? selectedOffice.displayName : params.filters.outlet;
        pdf.text(`Outlet: ${outletDisplayName}`, 20, yPos);
        yPos += 6;
      }

      const floorLabel = params.getFloorLabel(params.displayedSvgs[idx] || '');
      if (floorLabel) {
        pdf.text(`Floor: ${floorLabel}`, 20, yPos);
        yPos += 6;
      }

      if (params.filters.pax !== 'Select Pax') {
        pdf.text(`Pax: ${params.filters.pax}`, 20, yPos);
        yPos += 6;
      }

      // Determine Effective Status helper
      const effectiveStatus = (room: Room): 'Available' | 'Occupied' => {
        if (params.selectedStartDate) {
          const avail = params.availabilityByRoomId.get(room.id);
          if (avail) {
            const originalStatus = params.toStatusUnion(room.status);
            if (originalStatus === 'Occupied') {
              return 'Occupied';
            } else {
              return avail === 'free' ? 'Available' : 'Occupied';
            }
          }
        }
        return params.toStatusUnion(room.status);
      };

      // Suites Logic
      const suitesToShow = (() => {
        const pageRoomHasName = (name: string) => {
          const room = params.rooms.find(r => r.name === name);
          return room ? !!params.findRoomElementInline(rootSvg!, room) : false;
        };

        if (params.selectedSuites.length > 0) {
          return params.selectedSuites.filter(pageRoomHasName);
        }

        const availableOnThisPage = params.filteredRooms
          .filter(r => effectiveStatus(r) === 'Available' && pageRoomHasName(r.name))
          .map(r => r.name);
        return Array.from(new Set(availableOnThisPage))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      })();

      if (suitesToShow.length > 0) {
        const suitesLabel = 'Suites: ';
        const suitesText = suitesToShow.join(', ');
        const manySuites = suitesToShow.length > 6;
        const fontToUse = manySuites ? 7 : 10;

        pdf.setFontSize(fontToUse);
        const infoBlockWidth = pageWidth - 120;
        const wrapped = pdf.splitTextToSize(suitesText, infoBlockWidth - suitesLabel.length * (fontToUse / 2));
        if (wrapped.length > 0) {
          pdf.text(`${suitesLabel}${wrapped[0]}`, 20, yPos);
          let yy = yPos;
          for (let i = 1; i < wrapped.length; i++) {
            yy += manySuites ? 4 : 5;
            pdf.text(`        ${wrapped[i]}`, 20, yy);
          }
          yPos = yy + (manySuites ? 4 : 5);
        } else {
          pdf.text(`${suitesLabel}`, 20, yPos);
          yPos += manySuites ? 5 : 6;
        }
        pdf.setFontSize(12);
      }

      if (params.selectedStartDate) {
        pdf.setFontSize(10);
        if (params.selectedEndDate && params.selectedEndDate !== params.selectedStartDate) {
          pdf.text(`Date Range: ${params.selectedStartDate} to ${params.selectedEndDate}`, 20, yPos);
        } else {
          pdf.text(`Date: ${params.selectedStartDate}`, 20, yPos);
        }
        yPos += 6;
      }

      // Build Legend
      const buildPdfPaxLegend = (): Array<{label: string, color: string}> => {
        const legend: Array<{label: string, color: string}> = [];
        const usedPax = new Set<number>();
        params.filteredRooms.forEach(r => {
          if (effectiveStatus(r) === 'Available') usedPax.add(r.capacity);
        });
        if (usedPax.size === 0) return legend;
        
        params.paxBuckets.forEach((bucket, i) => {
          const has = Array.from(usedPax).some(p => {
            if (i === 0) return p >= 2 && p <= bucket.max;
            const prev = params.paxBuckets[i - 1];
            return p > prev.max && p <= bucket.max;
          });
          if (has) {
            const color = params.paxBucketColorMap?.get(bucket.max) || params.paxPalette[i];
            legend.push({ label: bucket.label, color: color });
          }
        });
        return legend;
      };

      const pdfLegend = buildPdfPaxLegend();
      if (pdfLegend.length > 0) {
        const rightMargin = 15;
        const legendAreaWidth = 75;
        const legendStartX = pageWidth - rightMargin - legendAreaWidth;
        let legendY = 25;

        pdf.setFontSize(9);
        pdf.setTextColor(0, 0, 0);
        pdf.text('Pax (Available):', legendStartX, legendY);
        legendY += 5;

        const legendItemWidth = 32;
        const legendItemHeight = 4;
        let currentX = legendStartX;
        let currentY = legendY;

        pdfLegend.forEach((item) => {
          if (currentX + legendItemWidth > legendStartX + legendAreaWidth) {
            currentX = legendStartX;
            currentY += legendItemHeight + 1;
          }
          pdf.setTextColor(0, 0, 0);
          pdf.text(item.label, currentX + 5, currentY);
          currentX += legendItemWidth;
        });

        yPos = currentY + 8;
      }

      // --- IMAGE GENERATION ---
      // We clone purely for html2canvas image capture
      const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;
      if (!svgClone.getAttribute('viewBox')) {
        const width = svgClone.getAttribute('width') || '1920';
        const height = svgClone.getAttribute('height') || '1018';
        svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }
      // NOTE: We DO NOT modify the SVG DOM for links/overlays anymore.

      try {
        let canvas = await this.svgToCanvas(svgClone, params.pdfQuality);
        canvas = this.downscaleCanvasIfNeeded(canvas);

        const margin = 12;
        const imgY = Math.max(yPos + 12, 36);
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - imgY - margin - 24;

        const aspect = canvas.width / canvas.height;
        let imgWidth = maxWidth * 0.82;
        let imgHeight = imgWidth / aspect;

        if (imgHeight > maxHeight) {
          imgHeight = maxHeight * 0.85;
          imgWidth = imgHeight * aspect;
        }

        const imgX = (pageWidth - imgWidth) / 2;
        const imgData = canvas.toDataURL('image/png');

        pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'MEDIUM');

        // --- DRAW OVERLAYS & LINKS ON PDF ---
        // We use the LIVE rootSvg to get screen coordinates, ensuring perfect alignment.
        this.addVideoOverlaysOnPdf(
          pdf,
          imgX, imgY, imgWidth, imgHeight,
          rootSvg, 
          params.filteredRooms,
          params
        );

      } catch (canvasError) {
        console.warn('Failed to convert SVG to canvas on page', idx + 1, canvasError);
        pdf.setFontSize(14);
        pdf.setTextColor(0, 0, 0);
        pdf.text('Floorplan SVG (could not render image)', 20, 20);
      }
    }

    // NOTE: Removed summary list call as requested.
    pdf.setPage(pdf.getNumberOfPages());
    return pdf;
  }

// 🟢 REPLACEMENT METHOD: Uses ViewBox mapping for perfect alignment
  private addVideoOverlaysOnPdf(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    svgElement: SVGSVGElement,
    filteredRooms: Room[],
    params: PdfExportParams
  ): void {
    const roomsWithVideos = filteredRooms.filter(room => room.video && room.video.trim() !== '');
    if (roomsWithVideos.length === 0) return;

    // 1. Get the SVG's internal definition (ViewBox)
    // This ensures we match the coordinate system of the image exactly.
    const vbAttr = svgElement.getAttribute('viewBox');
    if (!vbAttr) {
        console.warn('SVG missing viewBox, cannot calculate overlay positions.');
        return;
    }
    const [vbX, vbY, vbW, vbH] = vbAttr.split(' ').map(Number);

    // 2. Get the matrix to convert Screen Pixels -> SVG ViewBox Units
    const screenToSvgMatrix = svgElement.getScreenCTM()?.inverse();
    
    if (!screenToSvgMatrix) return;

    roomsWithVideos.forEach(room => {
      const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      if (!roomElement) return;

      // 3. Get Room Screen Coordinates
      const roomRect = roomElement.getBoundingClientRect();

      // 4. Convert Screen Coordinates -> SVG ViewBox Coordinates
      // Top-Left Corner
      let pt = svgElement.createSVGPoint();
      pt.x = roomRect.left;
      pt.y = roomRect.top;
      const svgPt = pt.matrixTransform(screenToSvgMatrix);

      // Bottom-Right Corner (to calculate width/height)
      let pt2 = svgElement.createSVGPoint();
      pt2.x = roomRect.right;
      pt2.y = roomRect.bottom;
      const svgPt2 = pt2.matrixTransform(screenToSvgMatrix);

      // 5. Calculate Position in ViewBox Units
      const roomVbX = svgPt.x;
      const roomVbY = svgPt.y;
      const roomVbW = svgPt2.x - svgPt.x;
      const roomVbH = svgPt2.y - svgPt.y;

      // 6. Map ViewBox Units -> PDF Image Coordinates
      // This aligns the overlay exactly with the image on the PDF
      const pdfX = imgX + ((roomVbX - vbX) / vbW) * imgWidth;
      const pdfY = imgY + ((roomVbY - vbY) / vbH) * imgHeight;
      const pdfW = (roomVbW / vbW) * imgWidth;
      const pdfH = (roomVbH / vbH) * imgHeight;

      // --- A. DRAW COLORED BOX ---
      const color = this.getRoomColorForPdf(room, params);
      const rgb = params.hexToRgb(color);

      pdf.saveGraphicsState();
      try {
        pdf.setGState(new (pdf as any).GState({ opacity: 0.6 }));
      } catch (e) { }

      if (rgb) pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      else pdf.setFillColor(200, 200, 200);

      pdf.rect(pdfX, pdfY, pdfW, pdfH, 'F'); // Fill
      pdf.restoreGraphicsState();

      // Border
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.1);
      pdf.rect(pdfX, pdfY, pdfW, pdfH, 'D'); // Stroke

      // --- B. DRAW TEXT ---
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      
      // Auto-size font: 30% of the box width, constrained between 2pt and 8pt
      const fontSize = Math.max(2, Math.min(8, pdfW * 0.30)); 
      pdf.setFontSize(fontSize);

      const cx = pdfX + (pdfW / 2);
      const cy = pdfY + (pdfH / 2);
      const lh = fontSize * 0.4;

      pdf.text('WATCH', cx, cy - lh, { align: 'center', baseline: 'middle' });
      pdf.text('TOUR', cx, cy + lh, { align: 'center', baseline: 'middle' });

      // --- C. ADD CLICKABLE LINK ---
      pdf.link(pdfX, pdfY, pdfW, pdfH, {
        url: room.video,
        target: '_blank'
      });
    });
  }

  private async svgToCanvas(
    svgElement: SVGSVGElement,
    pdfQuality: { scale: number; dimensions: { width: number; height: number } }
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        tempDiv.style.width = `${pdfQuality.dimensions.width}px`;
        tempDiv.style.height = `${pdfQuality.dimensions.height}px`;
        tempDiv.style.backgroundColor = '#ffffff';

        const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
        svgClone.style.width = '100%';
        svgClone.style.height = '100%';
        tempDiv.appendChild(svgClone);
        document.body.appendChild(tempDiv);

        html2canvas(tempDiv, {
          backgroundColor: '#ffffff',
          scale: pdfQuality.scale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: pdfQuality.dimensions.width,
          height: pdfQuality.dimensions.height,
          removeContainer: true,
          foreignObjectRendering: false,
          imageTimeout: 30000
        })
          .then((canvas) => {
            document.body.removeChild(tempDiv);
            resolve(canvas);
          })
          .catch((error) => {
            document.body.removeChild(tempDiv);
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  private downscaleCanvasIfNeeded(src: HTMLCanvasElement): HTMLCanvasElement {
    const MAX_PX = 8_000_000;
    const area = src.width * src.height;
    if (area <= MAX_PX) return src;

    const scale = Math.sqrt(MAX_PX / area);
    const dst = document.createElement('canvas');
    dst.width = Math.max(1, Math.floor(src.width * scale));
    dst.height = Math.max(1, Math.floor(src.height * scale));

    const ctx = dst.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  }

  savePdfSmart(pdf: jsPDF, fileName: string): void {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    if (FloorplanUtils.isIOSDevice()) {
      window.open(url, '_blank');
    } else {
      pdf.save(fileName);
    }
  }
}