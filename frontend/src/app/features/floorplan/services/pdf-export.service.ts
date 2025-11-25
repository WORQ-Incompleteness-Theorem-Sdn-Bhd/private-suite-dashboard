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
    private colorPaxService: ColorPaxService /* no dependencies for now */
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

      pdf.setFontSize(14);
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 15, 12);
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      let yPos = 20;

      if (params.filters.outlet !== 'Select Outlet') {
        const selectedOffice = this.officeService.getOffices().find(office => office.id === params.filters.outlet);
        const outletDisplayName = selectedOffice ? selectedOffice.displayName : params.filters.outlet;
        pdf.text(`Outlet: ${outletDisplayName}`, 15, yPos);
        yPos += 4.5;
      }

      const floorLabel = params.getFloorLabel(params.displayedSvgs[idx] || '');
      if (floorLabel) {
        pdf.text(`Floor: ${floorLabel}`, 15, yPos);
        yPos += 4.5;
      }

      if (params.filters.pax !== 'Select Pax') {
        pdf.text(`Pax: ${params.filters.pax}`, 15, yPos);
        yPos += 4.5;
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
        const infoBlockWidth = pageWidth - 100;
        const wrapped = pdf.splitTextToSize(suitesText, infoBlockWidth - suitesLabel.length * (fontToUse / 2));
        if (wrapped.length > 0) {
          pdf.text(`${suitesLabel}${wrapped[0]}`, 15, yPos);
          let yy = yPos;
          for (let i = 1; i < wrapped.length; i++) {
            yy += manySuites ? 3 : 4;
            pdf.text(`        ${wrapped[i]}`, 15, yy);
          }
          yPos = yy + (manySuites ? 3.5 : 4.5);
        } else {
          pdf.text(`${suitesLabel}`, 15, yPos);
          yPos += manySuites ? 4 : 4.5;
        }
        pdf.setFontSize(10);
      }

      if (params.selectedStartDate) {
        pdf.setFontSize(9);
        if (params.selectedEndDate && params.selectedEndDate !== params.selectedStartDate) {
          pdf.text(`Date Range: ${params.selectedStartDate} to ${params.selectedEndDate}`, 15, yPos);
        } else {
          pdf.text(`Date: ${params.selectedStartDate}`, 15, yPos);
        }
        yPos += 4.5;
      }

      // --- IMAGE GENERATION ---
      // Ensure viewBox is set on the live SVG for proper scaling
      if (!rootSvg.getAttribute('viewBox')) {
        const width = rootSvg.getAttribute('width') || '1920';
        const height = rootSvg.getAttribute('height') || '1018';
        rootSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      try {
        // Capture the live host element directly - this captures the exact rendered state with all colors
        let canvas = await this.captureHostElement(hostEl, params.pdfQuality);
        canvas = this.downscaleCanvasIfNeeded(canvas);

        const margin = 8;
        const imgY = Math.max(yPos + 6, 30);
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - imgY - margin - 8;

        const aspect = canvas.width / canvas.height;
        let imgWidth = maxWidth * 0.95;
        let imgHeight = imgWidth / aspect;

        if (imgHeight > maxHeight) {
          imgHeight = maxHeight * 0.95;
          imgWidth = imgHeight * aspect;
        }

        const imgX = (pageWidth - imgWidth) / 2;
        const imgData = canvas.toDataURL('image/png');

        pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'MEDIUM');

        // --- DRAW OVERLAYS & LINKS ON PDF ---
        // We use the LIVE rootSvg to get coordinates, ensuring perfect alignment with captured image
        console.log('🎯 Adding video overlays to PDF:', {
          imgX, imgY, imgWidth, imgHeight,
          viewBox: rootSvg.getAttribute('viewBox'),
          roomsWithVideos: params.filteredRooms.filter(r => r.video).length
        });

        this.addVideoOverlaysOnPdf(
          pdf,
          imgX, imgY, imgWidth, imgHeight,
          rootSvg,
          params.filteredRooms,
          params
        );

        // Add visual indicators for selected suites
        this.addSelectedSuiteIndicators(
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

  /**
   * Helper method: Calculate PDF coordinates for a room element
   * Uses getBBox() - same approach as the color feature
   *
   * @returns PDF coordinates {pdfX, pdfY, pdfW, pdfH} or null if room not found
   */
  private getRoomPdfCoordinates(
    room: Room,
    svgElement: SVGSVGElement,
    vbX: number, vbY: number, vbW: number, vbH: number,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number
  ): { pdfX: number; pdfY: number; pdfW: number; pdfH: number } | null {
    const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
    if (!roomElement) return null;

    // Get Room Position Directly in SVG Coordinates
    const bbox = roomElement.getBBox();

    // Map SVG ViewBox Units -> PDF Image Coordinates
    const pdfX = imgX + ((bbox.x - vbX) / vbW) * imgWidth;
    const pdfY = imgY + ((bbox.y - vbY) / vbH) * imgHeight;
    const pdfW = (bbox.width / vbW) * imgWidth;
    const pdfH = (bbox.height / vbH) * imgHeight;

    return { pdfX, pdfY, pdfW, pdfH };
  }

  /**
   * 🎯 Add 'Watch Tour' video overlays on PDF
   * Uses SVG-native geometry (getBBox) - same logic as the color feature
   *
   * Algorithm:
   * 1. Find room element by ID (just like color feature: getElementById(room.id))
   * 2. Get room geometry in SVG coordinates using getBBox() (not screen pixels)
   * 3. Map SVG coordinates → PDF coordinates using ViewBox scaling
   * 4. Draw centered 'Watch Tour' box with proportional sizing
   */
  private addVideoOverlaysOnPdf(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    svgElement: SVGSVGElement,
    filteredRooms: Room[],
    params: PdfExportParams
  ): void {
    const roomsWithVideos = filteredRooms.filter(room => room.video && room.video.trim() !== '');
    if (roomsWithVideos.length === 0) return;

    // Get the SVG's ViewBox for coordinate mapping
    const vbAttr = svgElement.getAttribute('viewBox');
    if (!vbAttr) {
        console.warn('SVG missing viewBox, cannot calculate overlay positions.');
        return;
    }
    const [vbX, vbY, vbW, vbH] = vbAttr.split(' ').map(Number);

    roomsWithVideos.forEach((room, index) => {
      // 1. Find room element by ID (same as color feature)
      const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      if (!roomElement) {
        console.warn(`❌ Room element not found for ID: ${room.id}`);
        return;
      }

      // 2. Get room geometry in SVG coordinates (not screen pixels)
      // getBBox() returns the tight bounding box in SVG coordinate space
      // This handles nested groups, transformations, etc. automatically
      const bbox = roomElement.getBBox();

      // 3. Map SVG ViewBox coordinates → PDF image coordinates
      // Formula: pdfCoord = imgStart + ((svgCoord - viewBoxStart) / viewBoxSize) * imgSize
      const pdfX = imgX + ((bbox.x - vbX) / vbW) * imgWidth;
      const pdfY = imgY + ((bbox.y - vbY) / vbH) * imgHeight;
      const pdfW = (bbox.width / vbW) * imgWidth;
      const pdfH = (bbox.height / vbH) * imgHeight;

      // Debug logging for first few rooms
      if (index < 2) {
        console.log(`📍 Room ${room.name} (${room.id}) overlay:`, {
          svgBBox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
          viewBox: { vbX, vbY, vbW, vbH },
          pdfCoords: { pdfX, pdfY, pdfW, pdfH },
          pdfImageBounds: { imgX, imgY, imgWidth, imgHeight }
        });
      }

      // --- A. DRAW SEMI-TRANSPARENT COLORED BOX ---
      // Note: The captured image already has room colors, but we add a semi-transparent overlay
      // to make the "WATCH TOUR" text more visible
      // const color = this.getRoomColorForPdf(room, params);
      // const rgb = params.hexToRgb(color);

      pdf.saveGraphicsState();
      // try {
      //   // Use 70% opacity for better visibility of text
      //   pdf.setGState(new (pdf as any).GState({ opacity: 0.7 }));
      // } catch (e) {
      //   console.warn('Failed to set opacity for overlay');
      // }

      // if (rgb) {
      //   pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      // } else {
      //   pdf.setFillColor(200, 200, 200);
      // }

      // pdf.rect(pdfX, pdfY, pdfW, pdfH, 'F'); // Fill
      // pdf.restoreGraphicsState();

      // Border
      // pdf.setDrawColor(0, 0, 0);
      // pdf.setLineWidth(0.1);
      // pdf.rect(pdfX, pdfY, pdfW, pdfH, 'D'); // Stroke

      // --- B. DRAW "WATCH TOUR" TEXT ---
      pdf.setTextColor(0, 0, 0); // White text for better contrast
      pdf.setFont('helvetica', 'bold');

      // Auto-size font based on box dimensions
      // Use the smaller dimension (width or height) for better fit
      const minDimension = Math.min(pdfW, pdfH);
      const fontSize = Math.max(3, Math.min(10, minDimension * 0.35));
      pdf.setFontSize(fontSize);

      const cx = pdfX + (pdfW / 2);
      const cy = pdfY + (pdfH / 2);
      const lh = fontSize * 0.4;

      // Draw with white color and add a subtle shadow for readability
      pdf.setTextColor(0, 0, 0);
      pdf.text('WATCH', cx, cy - lh, { align: 'center', baseline: 'middle' });
      pdf.text('TOUR', cx, cy + lh, { align: 'center', baseline: 'middle' });

      // --- C. ADD CLICKABLE LINK ---
      // Make the entire box clickable with the video URL
      try {
        (pdf as any).link(pdfX, pdfY, pdfW, pdfH, { url: room.video });

        // Set NewWindow flag in the link annotation to force opening in new tab
        const annotations = (pdf as any).internal.getCurrentPageInfo().pageContext.annotations || [];
        if (annotations.length > 0) {
          const lastAnnotation = annotations[annotations.length - 1];
          // Add NewWindow flag to annotation dictionary
          if (lastAnnotation && lastAnnotation.options) {
            lastAnnotation.options.NewWindow = true;
          }
        }

        if (index < 2) {
          console.log(`✅ Added clickable link for room ${room.name} to ${room.video}`);
        }
      } catch (e) {
        console.warn(`Failed to add link for room ${room.id}:`, e);
      }
    });

    console.log(`✅ Added ${roomsWithVideos.length} video overlays to PDF`);
  }

  /**
   * Add visual indicators (checkmarks/stars) for selected suites on the PDF
   */
  private addSelectedSuiteIndicators(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    svgElement: SVGSVGElement,
    filteredRooms: Room[],
    params: PdfExportParams
  ): void {
    // Filter for selected suites
    const selectedRooms = filteredRooms.filter(room =>
      params.selectedSuites.includes(room.name)
    );

    if (selectedRooms.length === 0) return;

    // Get the SVG's ViewBox for coordinate mapping
    const vbAttr = svgElement.getAttribute('viewBox');
    if (!vbAttr) {
      console.warn('SVG missing viewBox, cannot calculate selected suite positions.');
      return;
    }
    const [vbX, vbY, vbW, vbH] = vbAttr.split(' ').map(Number);

    selectedRooms.forEach(room => {
      // Use helper method to get PDF coordinates
      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight
      );
      if (!coords) return;

      const { pdfW  } = coords;

      // Draw a semi-transparent border around selected suites
      pdf.saveGraphicsState();
      try {
        pdf.setGState(new (pdf as any).GState({ opacity: 0.8 }));
      } catch (e) { }

      // Draw a colored border 
      // pdf.setDrawColor(0, 0, 0); // Black color
      // pdf.setLineWidth(0.2);
      // pdf.rect(pdfX, pdfY, pdfW, pdfH, 'S'); // Stroke only

      pdf.restoreGraphicsState();

      // Add a checkmark or "SELECTED" text indicator
      pdf.setTextColor(0, 0, 0); // Orange color
      pdf.setFont('helvetica', 'bold');

      // Auto-size font: 25% of the box width, constrained between 3pt and 10pt
      const fontSize = Math.max(3, Math.min(10, pdfW * 0.25));
      pdf.setFontSize(fontSize);
    });
  }

  /**
   * Capture the live host element directly - preserves all rendered colors and styles
   * This captures exactly what the user sees in the dashboard
   */
  private async captureHostElement(
    hostElement: HTMLElement,
    pdfQuality: { scale: number; dimensions: { width: number; height: number } }
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        // Get the actual bounding box of the element
        const rect = hostElement.getBoundingClientRect();

        html2canvas(hostElement, {
          backgroundColor: '#ffffff',
          scale: pdfQuality.scale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: rect.width || pdfQuality.dimensions.width,
          height: rect.height || pdfQuality.dimensions.height,
          foreignObjectRendering: false,
          imageTimeout: 30000,
          // Capture scrolled content
          scrollX: 0,
          scrollY: 0,
          windowWidth: rect.width,
          windowHeight: rect.height
        })
          .then((canvas) => {
            resolve(canvas);
          })
          .catch((error) => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Legacy method for cloning SVG - kept for reference
   * Note: captureHostElement is preferred as it captures the live rendered state
   */
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