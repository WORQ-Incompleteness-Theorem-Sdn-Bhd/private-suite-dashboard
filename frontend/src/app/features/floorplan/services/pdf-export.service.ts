import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { OfficeService } from '../../../core/services/office.service';
import { FloorService } from '../../../core/services/floor.service';
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
  floorIdToFloorMap: Map<string, any>;
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
    private floorService: FloorService,
    // private colorPaxService: ColorPaxService /* no dependencies for now */
  ) {}

  /**
   * Helper: Format date from YYYY-MM-DD to DD/MM/YYYY
   */
  private formatDateToDDMMYYYY(dateString: string): string {
    if (!dateString) return '';

    // Check if date is in YYYY-MM-DD format
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }

    // Return as-is if format is unexpected
    return dateString;
  }

  // HELPER: Determines the box color based on room capacity
  // private getRoomColorForPdf(room: Room, params: PdfExportParams): string {
  //   const capacity = room.capacity || 1;

  //   for (let i = 0; i < params.paxBuckets.length; i++) {
  //     const bucket = params.paxBuckets[i];
  //     const prevMax = i === 0 ? 0 : params.paxBuckets[i - 1].max;

  //     if (capacity > prevMax && capacity <= bucket.max) {
  //       if (params.paxBucketColorMap && params.paxBucketColorMap.has(bucket.max)) {
  //         return params.paxBucketColorMap.get(bucket.max)!;
  //       }
  //       return params.paxPalette[i] || '#cccccc';
  //     }
  //   }
  //   return params.paxPalette[params.paxPalette.length - 1] || '#cccccc';
  // }

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

      pdf.setFontSize(16); // Larger header font
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 15, 10);
      pdf.setFontSize(12); // Increased label font to 12pt to match image
      pdf.setTextColor(0, 0, 0);
      let yPos = 20; // Starting position for labels

      // Outlet - Always show
      const selectedOffice = this.officeService.getOffices().find(office => office.id === params.filters.outlet);
      const outletDisplayName = params.filters.outlet !== 'Select Outlet' && selectedOffice
        ? selectedOffice.displayName
        : params.filters.outlet;
      pdf.text(`Outlet: ${outletDisplayName}`, 15, yPos);
      yPos += 6; // Increased line spacing to match image

      // Floor - Get floor_id from rooms visible on this SVG page
      let floorLabel = 'N/A';

      // Strategy 1: Try to get floor_id from the first visible room on this page
      const visibleRooms = params.filteredRooms.filter(room => {
        const el = params.findRoomElementInline(rootSvg, room);
        return !!el && room.floor_id;
      });

      if (visibleRooms.length > 0 && visibleRooms[0].floor_id) {
        // Get the floor label using the centralized floor service method
        const floorId = visibleRooms[0].floor_id;
        floorLabel = this.floorService.getFloorLabelFromMap(floorId, params.floorIdToFloorMap);
      } else {
        // Strategy 2: Fallback to using the displayedSvgs URL
        const currentFloorplan = params.displayedSvgs[idx];
        if (currentFloorplan) {
          floorLabel = params.getFloorLabel(currentFloorplan);
        }
      }

      pdf.text(`Floor: ${floorLabel}`, 15, yPos);
      yPos += 6; // Increased line spacing to match image

      // Pax - Get from selected suites if available, otherwise from filter
      const paxValue = (() => {
        if (params.selectedSuites.length > 0) {
          const selectedRooms = params.rooms.filter(r => params.selectedSuites.includes(r.name));
          const paxCapacities = Array.from(new Set(selectedRooms.map(r => r.capacity)))
            .sort((a, b) => a - b);

          if (paxCapacities.length === 1) {
            return paxCapacities[0].toString();
          } else if (paxCapacities.length > 1) {
            return paxCapacities.join(', ');
          }
        }
        return params.filters.pax !== 'Select Pax' ? params.filters.pax : 'All';
      })();
      pdf.text(`Pax: ${paxValue}`, 15, yPos);
      yPos += 6; // Increased line spacing to match image

      // Date - Always show
      if (params.selectedStartDate) {
        const formattedStartDate = this.formatDateToDDMMYYYY(params.selectedStartDate);
        if (params.selectedEndDate && params.selectedEndDate !== params.selectedStartDate) {
          const formattedEndDate = this.formatDateToDDMMYYYY(params.selectedEndDate);
          pdf.text(`Date: ${formattedStartDate} to ${formattedEndDate}`, 15, yPos);
        } else {
          pdf.text(`Date: ${formattedStartDate}`, 15, yPos);
        }
      } else {
        const today = new Date();
        const formattedToday = this.formatDateToDDMMYYYY(
          `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        );
        pdf.text(`Date: ${formattedToday}`, 15, yPos);
      }
      yPos += 6; // Increased line spacing to match image

      // Suites Logic - Show all filtered suites on the page
      const suitesToShow = (() => {
        const pageRoomHasName = (name: string) => {
          const room = params.rooms.find(r => r.name === name);
          return room ? !!params.findRoomElementInline(rootSvg!, room) : false;
        };

        if (params.selectedSuites.length > 0) {
          return params.selectedSuites.filter(pageRoomHasName);
        }

        // Show ALL filtered rooms on this page
        const roomsOnThisPage = params.filteredRooms
          .filter(r => pageRoomHasName(r.name))
          .map(r => r.name);
        return Array.from(new Set(roomsOnThisPage))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      })();

      // Always show Suites label
      pdf.setFontSize(12); // Match the other labels font size
      if (suitesToShow.length > 0) {
        const suitesLabel = 'Suite: ';
        const suitesText = suitesToShow.join(', ');
        const manySuites = suitesToShow.length > 6;
        const fontToUse = manySuites ? 9 : 11; // Slightly larger fonts to match

        pdf.setFontSize(fontToUse);
        const infoBlockWidth = pageWidth - 100;
        const wrapped = pdf.splitTextToSize(suitesText, infoBlockWidth - suitesLabel.length * (fontToUse / 2));
        if (wrapped.length > 0) {
          pdf.text(`${suitesLabel}${wrapped[0]}`, 15, yPos);
          let yy = yPos;
          for (let i = 1; i < wrapped.length; i++) {
            yy += manySuites ? 5 : 5.5; // Increased spacing to match
            pdf.text(`        ${wrapped[i]}`, 15, yy);
          }
          yPos = yy + (manySuites ? 5 : 5.5); // Increased spacing to match
        } else {
          pdf.text(`${suitesLabel}`, 15, yPos);
          yPos += 5.5;
        }
        pdf.setFontSize(12);
      } else {
        // Show "Suite: None" when no suites match the filter
        pdf.text('Suite: None', 15, yPos);
        yPos += 5;
      }

      // --- IMAGE GENERATION ---

      // 1. FORCE AUTO-CROP (ALWAYS RUN THIS)
      // We calculate the BBox of the actual drawing content and set the viewBox to match it.
      // This removes empty whitespace and makes the floorplan appear much larger/zoomed-in.
      try {
        const bbox = rootSvg.getBBox();

        // Sanity check: only crop if bbox has valid dimensions
        if (bbox.width > 0 && bbox.height > 0) {
          // Add a small padding (e.g. 10 units) so lines aren't cut off at the very edge
          const padding = 10;
          const newViewBox = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + (padding * 2)} ${bbox.height + (padding * 2)}`;

          rootSvg.setAttribute('viewBox', newViewBox);
        }
      } catch (e) {
        // Only set default if absolutely nothing exists
        if (!rootSvg.getAttribute('viewBox')) {
           rootSvg.setAttribute('viewBox', '0 0 1920 1018');
        }
      }

      try {
        // ============================================================
        // PIXEL-PERFECT PDF EXPORT WITH EXACT TARGET METRICS
        // ============================================================

        // A4 Landscape dimensions
        const pageWidth = pdf.internal.pageSize.getWidth();   // 297.04mm
        const pageHeight = pdf.internal.pageSize.getHeight(); // 210.08mm

        // Step 1: Capture canvas at high quality
        let canvas = await this.captureHostElement(hostEl, params.pdfQuality);
        canvas = this.downscaleCanvasIfNeeded(canvas);

        const canvasAspectRatio = canvas.width / canvas.height;

        // Calculate floorplan space - maximize available area
        const imgY = yPos + 5; // Start below the labels with small margin
        const availableWidth = pageWidth - 60; // Leave 30mm margin on each side (reduced from 50mm)
        const availableHeight = pageHeight - imgY - 15; // Leave 10mm margin at bottom (reduced from 15mm)
        const maxWidth = availableWidth * 1.0;
        const maxHeight = availableHeight * 1.0;

        // Calculate actual dimensions while maintaining aspect ratio
        let imgWidth = maxWidth;
        let imgHeight = imgWidth / canvasAspectRatio;

        // If height exceeds available space, constrain by height instead
        if (imgHeight > maxHeight) {
          imgHeight = maxHeight;
          imgWidth = imgHeight * canvasAspectRatio;
        }

        // Center horizontally within the available area
        const leftMargin = 40;
        const availableSpace = pageWidth - (leftMargin * 2);
        const imgX = leftMargin + (availableSpace - imgWidth) / 2;

        // Render floorplan image
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');

        // Add interactive overlays for selected suites
        this.addSelectedSuiteIndicators(
          pdf,
          imgX, imgY, imgWidth, imgHeight,
          rootSvg,
          params.filteredRooms,
          params
        );

      } catch (canvasError) {
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

    // Skip text elements - we only want room shapes (path, polygon, rect, etc.)
    const elementType = roomElement.tagName.toLowerCase();
    if (elementType === 'text' || elementType === 'tspan') {
      console.warn(`⚠️ ${room.name}: Found text element instead of room shape. Skipping.`);
      return null;
    }

    const bbox = roomElement.getBBox();

    // Validate bbox is within reasonable bounds
    if (bbox.width <= 0 || bbox.height <= 0) {
      return null;
    }

    // Map SVG ViewBox Units -> PDF Image Coordinates
    const pdfX = imgX + ((bbox.x - vbX) / vbW) * imgWidth;
    const pdfY = imgY + ((bbox.y - vbY) / vbH) * imgHeight;
    const pdfW = (bbox.width / vbW) * imgWidth;
    const pdfH = (bbox.height / vbH) * imgHeight;

    return { pdfX, pdfY, pdfW, pdfH };
  }

  /**
   * Add clickable links for ALL colored suites and visual labels for selected suites on the PDF
   * Uses SVG Matrix Math with getCTM() for accurate positioning
   *
   * Algorithm:
   * 1. Get Map Boundaries (ViewBox)
   * 2. Find room element by ID
   * 3. Get BBox and transform using Matrix Math (getCTM + matrixTransform)
   * 4. Map Global SVG coordinates to PDF coordinates
   * 5. Add clickable link to ALL filtered rooms (all colored suites)
   * 6. Draw blue border and "SELECTED" badge only for selected suites
   */
  private addSelectedSuiteIndicators(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    svgElement: SVGSVGElement,
    filteredRooms: Room[],
    params: PdfExportParams
  ): void {
    if (filteredRooms.length === 0) return;

    // Get the SVG's ViewBox for coordinate mapping
    const vbAttr = svgElement.getAttribute('viewBox');
    if (!vbAttr) {
      console.warn('SVG missing viewBox, cannot calculate suite positions.');
      return;
    }
    const [vbX, vbY, vbW, vbH] = vbAttr.split(' ').map(Number);

    // Separate selected and non-selected rooms, and filter only those with video links
    const selectedRooms = filteredRooms.filter(room =>
      params.selectedSuites.includes(room.name) && room.video && room.video.trim() !== ''
    );
    const nonSelectedRooms = filteredRooms.filter(room =>
      !params.selectedSuites.includes(room.name) && room.video && room.video.trim() !== ''
    );

    // Add clickable links to ALL non-selected colored rooms with videos
    nonSelectedRooms.forEach(room => {
      const roomElement = svgElement.getElementById(room.id);
      if (!roomElement) return;

      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight
      );
      if (!coords) return;

      const { pdfX, pdfY, pdfW, pdfH } = coords;

      // More strict validation: Skip if box is outside OR suspiciously positioned
      // Check if box is completely outside the floorplan area
      const isOutsideLeft = pdfX + pdfW < imgX;
      const isOutsideRight = pdfX > imgX + imgWidth;
      const isOutsideTop = pdfY + pdfH < imgY;
      const isOutsideBottom = pdfY > imgY + imgHeight;

      // Check if box starts too far from floorplan (likely mapping error)
      const isTooFarLeft = pdfX < imgX - 10; // More than 10mm outside
      const isTooFarUp = pdfY < imgY - 10; // More than 10mm outside

      if (isOutsideLeft || isOutsideRight || isOutsideTop || isOutsideBottom ||
          isTooFarLeft || isTooFarUp) {
        return;
      }

      // Make box smaller (60% of original size) and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;

      // Add blue border and suite label
      pdf.setDrawColor(0, 0, 255);
      pdf.setLineWidth(0.4);
      pdf.rect(boxX, boxY, smallerW, smallerH, 'S');

      pdf.setFontSize(8);
      pdf.setTextColor(0, 0, 255);
      pdf.text(room.name, boxX + smallerW / 2, boxY + smallerH / 2, { align: 'center', baseline: 'middle' });

      // Add clickable area
      pdf.link(boxX, boxY, smallerW, smallerH, {
        url: room.video,
        target: '_blank'
      });
    });

    // Add clickable links with visual indicators for selected rooms // sini clickable area
    selectedRooms.forEach(room => {
      const roomElement = svgElement.getElementById(room.id);
      if (!roomElement) return;

      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight
      );
      if (!coords) return;

      const { pdfX, pdfY, pdfW, pdfH } = coords;

      // Validate position
      const isOutsideLeft = pdfX + pdfW < imgX; //off to the left side of the image
      const isOutsideRight = pdfX > imgX + imgWidth; //off to the right side of the image
      const isOutsideTop = pdfY + pdfH < imgY; //off above the image
      const isOutsideBottom = pdfY > imgY + imgHeight; //off below the image
      const isTooFarLeft = pdfX < imgX - 10; //more than 10mm outside to the left
      const isTooFarUp = pdfY < imgY - 10; //more than 10mm outside above

      if (isOutsideLeft || isOutsideRight || isOutsideTop || isOutsideBottom ||
          isTooFarLeft || isTooFarUp) {
        return;
      }

      // Make box smaller (60% of original size) and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;

      // Add orange border and suite label for selected rooms
      pdf.setDrawColor(255, 102, 0);
      pdf.setLineWidth(0.8);
      pdf.rect(boxX, boxY, smallerW, smallerH, 'S');

      pdf.setFontSize(8);
      pdf.setTextColor(255, 102, 0);
      pdf.text(room.name, boxX + smallerW / 2, boxY + smallerH / 2, { align: 'center', baseline: 'middle' });

      // Add clickable area
      pdf.link(boxX, boxY, smallerW, smallerH, {
        url: room.video!,
        target: '_blank'
      });
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

        // Temporarily remove background from svg-host container
        const svgHostElement = hostElement.classList.contains('svg-host')
          ? hostElement
          : hostElement.querySelector('.svg-host') as HTMLElement;

        const originalBackground = svgHostElement ? svgHostElement.style.background : '';
        if (svgHostElement) {
          svgHostElement.style.background = 'transparent';
        }

        // Temporarily hide background elements in SVG
        const svg = hostElement.querySelector('svg');
        const hiddenElements: Array<{ element: SVGElement; originalDisplay: string }> = [];

        if (svg) {
          // Find and hide background rectangles (common in SVGs)
          const backgroundRects = svg.querySelectorAll('rect[fill="#ffffff"], rect[fill="white"], rect[fill="#f0f0f0"], rect[fill="#e5e5e5"], rect[fill="rgb(255,255,255)"]');
          backgroundRects.forEach((rect) => {
            const element = rect as SVGElement;
            const originalDisplay = element.style.display;
            hiddenElements.push({ element, originalDisplay });
            element.style.display = 'none';
          });
        }

        html2canvas(hostElement, {
          backgroundColor: null, // Transparent background - removes gray floorplan container background
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
            // Restore background
            if (svgHostElement) {
              svgHostElement.style.background = originalBackground;
            }
            // Restore hidden elements
            hiddenElements.forEach(({ element, originalDisplay }) => {
              element.style.display = originalDisplay;
            });
            resolve(canvas);
          })
          .catch((error) => {
            // Restore background even on error
            if (svgHostElement) {
              svgHostElement.style.background = originalBackground;
            }
            // Restore hidden elements even on error
            hiddenElements.forEach(({ element, originalDisplay }) => {
              element.style.display = originalDisplay;
            });
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