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

      pdf.setFontSize(13); // Larger header font
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 15, 9);
      pdf.setFontSize(10); // Larger label font (10pt)
      pdf.setTextColor(0, 0, 0);
      let yPos = 17; // Starting position for labels

      // Outlet - Always show
      const selectedOffice = this.officeService.getOffices().find(office => office.id === params.filters.outlet);
      const outletDisplayName = params.filters.outlet !== 'Select Outlet' && selectedOffice
        ? selectedOffice.displayName
        : params.filters.outlet;
      pdf.text(`Outlet: ${outletDisplayName}`, 15, yPos);
      yPos += 4;

      // Floor - Always show
      const currentFloorplan = params.displayedSvgs[idx];
      const floorLabel = params.getFloorLabel(currentFloorplan || '');
      if (floorLabel) {
        const floorNumber = floorLabel.replace(/^Level\s*/i, '').trim();
        pdf.text(`Floor: ${floorNumber}`, 15, yPos);
      } else {
        pdf.text(`Floor: N/A`, 15, yPos);
      }
      yPos += 4;

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
      yPos += 4;

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
      yPos += 4;

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
      pdf.setFontSize(10); // Larger font
      if (suitesToShow.length > 0) {
        const suitesLabel = 'Suites: ';
        const suitesText = suitesToShow.join(', ');
        const manySuites = suitesToShow.length > 6;
        const fontToUse = manySuites ? 7 : 9; // Larger fonts

        pdf.setFontSize(fontToUse);
        const infoBlockWidth = pageWidth - 100;
        const wrapped = pdf.splitTextToSize(suitesText, infoBlockWidth - suitesLabel.length * (fontToUse / 2));
        if (wrapped.length > 0) {
          pdf.text(`${suitesLabel}${wrapped[0]}`, 15, yPos);
          let yy = yPos;
          for (let i = 1; i < wrapped.length; i++) {
            yy += manySuites ? 3 : 3.5; // Proper spacing
            pdf.text(`        ${wrapped[i]}`, 15, yy);
          }
          yPos = yy + (manySuites ? 3 : 3.5); // Proper spacing
        } else {
          pdf.text(`${suitesLabel}`, 15, yPos);
          yPos += 3.5;
        }
        pdf.setFontSize(10);
      } else {
        // Show "Suites: None" when no suites match the filter
        pdf.text('Suites: None', 15, yPos);
        yPos += 3;
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

        const margin = 1; // Small margin for floorplan
        const imgY = yPos + 1; // Small gap between labels and image
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - imgY - margin; // Minimal bottom margin

        const aspect = canvas.width / canvas.height;
        let imgWidth = maxWidth; // Use full available width
        let imgHeight = imgWidth / aspect;

        if (imgHeight > maxHeight) {
          imgHeight = maxHeight; // Use full available height
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
   * Uses CLIENT coordinates (actual rendered size on dashboard) for accurate positioning
   *
   * Algorithm:
   * 1. Find room element by ID
   * 2. Get room's CLIENT bounding rect (actual rendered position/size on screen)
   * 3. Get SVG's CLIENT bounding rect (actual rendered size on screen)
   * 4. Calculate room's position RELATIVE to SVG (in pixels)
   * 5. Map those relative pixel coordinates to PDF coordinates
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

    // Get SVG's actual CLIENT size (how it's rendered on screen)
    // This is what html2canvas captures!
    const svgClientRect = svgElement.getBoundingClientRect();
    const svgClientW = svgClientRect.width;
    const svgClientH = svgClientRect.height;

    console.log('🎯 SVG Client Size (rendered on dashboard):', {
      width: svgClientW.toFixed(2),
      height: svgClientH.toFixed(2),
      aspectRatio: (svgClientW / svgClientH).toFixed(2)
    });
    console.log('📄 PDF Image Size:', {
      width: imgWidth.toFixed(2),
      height: imgHeight.toFixed(2),
      aspectRatio: (imgWidth / imgHeight).toFixed(2)
    });

    roomsWithVideos.forEach((room, index) => {
      // 1. Find room element by ID
      const roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      if (!roomElement) {
        console.warn(`❌ Room element not found for ID: ${room.id}`);
        return;
      }

      // 2. Get room's CLIENT bounding rect (actual position/size on screen)
      const roomClientRect = roomElement.getBoundingClientRect();

      // 3. Calculate room's position RELATIVE to SVG (in client pixels)
      // This gives us the room's position within the SVG in the same coordinate system
      // that html2canvas uses
      const relativeX = roomClientRect.left - svgClientRect.left;
      const relativeY = roomClientRect.top - svgClientRect.top;
      const relativeW = roomClientRect.width;
      const relativeH = roomClientRect.height;

      // 4. Map relative client coordinates → PDF coordinates
      // Formula: pdfCoord = imgStart + (clientCoord / svgClientSize) * imgSize
      const fullPdfX = imgX + (relativeX / svgClientW) * imgWidth;
      const fullPdfY = imgY + (relativeY / svgClientH) * imgHeight;
      const fullPdfW = (relativeW / svgClientW) * imgWidth;
      const fullPdfH = (relativeH / svgClientH) * imgHeight;

      // Make the box smaller (70% of room size) and positioned slightly above center
      const boxScale = 0.7; // Box is 70% of the room size
      const pdfW = fullPdfW * boxScale;
      const pdfH = fullPdfH * boxScale;
      const pdfX = fullPdfX + (fullPdfW - pdfW) / 2; // Center horizontally
      const pdfY = fullPdfY + (fullPdfH - pdfH) / 2 - (fullPdfH * 0.15); // Moved up 10%

      // Debug logging
      console.log(`📍 Room ${room.name} (${room.id}) overlay:`, {
        clientRect: {
          x: roomClientRect.left.toFixed(2),
          y: roomClientRect.top.toFixed(2),
          w: roomClientRect.width.toFixed(2),
          h: roomClientRect.height.toFixed(2)
        },
        relativeToSvg: {
          x: relativeX.toFixed(2),
          y: relativeY.toFixed(2),
          w: relativeW.toFixed(2),
          h: relativeH.toFixed(2)
        },
        fullRoomPdfCoords: {
          x: fullPdfX.toFixed(2),
          y: fullPdfY.toFixed(2),
          w: fullPdfW.toFixed(2),
          h: fullPdfH.toFixed(2)
        },
        smallerBoxPdfCoords: {
          x: pdfX.toFixed(2),
          y: pdfY.toFixed(2),
          w: pdfW.toFixed(2),
          h: pdfH.toFixed(2)
        }
      });

      pdf.saveGraphicsState();

      // --- DRAW "WATCH TOUR" TEXT ---
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');

      // Auto-size font based on box dimensions
      // Minimum font size increased to 8 for better readability
      const minDimension = Math.min(pdfW, pdfH);
      const fontSize = Math.max(7, Math.min(17, minDimension * 0.5));
      pdf.setFontSize(fontSize);

      // Calculate absolute center of the smaller box
      const centerX = pdfX + (pdfW / 2);  // Horizontal center
      const centerY = pdfY + (pdfH / 2);  // Vertical center

      // // --- DEBUG: Draw suite boundary box to verify positioning ---
      pdf.setDrawColor(255, 0, 0); // Red border
      pdf.setLineWidth(0.5);
      pdf.rect(pdfX, pdfY, pdfW, pdfH);

      // For two-line text centered around centerY:
      // No gap between lines for compact appearance
      const halfGap = fontSize * 0.2; // Minimal gap for tight spacing

      // Suite name label - positioned above WATCH TOUR text
      const suiteNameFontSize = Math.max(4, fontSize * 0.4); // Smaller than main text
      pdf.setFontSize(suiteNameFontSize);
      pdf.setTextColor(0, 0, 0);
      const suiteNameY = centerY - halfGap - fontSize * 0.4; // Above WATCH text
      pdf.text(room.name, centerX, suiteNameY, { align: 'center', baseline: 'middle' });

      // Position text lines symmetrically around the center point
      pdf.setFontSize(fontSize); // Reset to main font size
      pdf.setTextColor(0, 0, 0);
      pdf.text('WATCH', centerX, centerY - halfGap, { align: 'center', baseline: 'middle' });
      pdf.text('TOUR', centerX, centerY + halfGap, { align: 'center', baseline: 'middle' });

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

  /**
   * Legacy method for cloning SVG - kept for reference
   * Note: captureHostElement is preferred as it captures the live rendered state
   */
  // private async svgToCanvas(
  //   svgElement: SVGSVGElement,
  //   pdfQuality: { scale: number; dimensions: { width: number; height: number } }
  // ): Promise<HTMLCanvasElement> {
  //   return new Promise((resolve, reject) => {
  //     try {
  //       const tempDiv = document.createElement('div');
  //       tempDiv.style.position = 'absolute';
  //       tempDiv.style.left = '-9999px';
  //       tempDiv.style.top = '-9999px';
  //       tempDiv.style.width = `${pdfQuality.dimensions.width}px`;
  //       tempDiv.style.height = `${pdfQuality.dimensions.height}px`;
  //       // tempDiv.style.backgroundColor = '#ffffff';

  //       const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  //       svgClone.style.width = '100%';
  //       svgClone.style.height = '100%';
  //       tempDiv.appendChild(svgClone);
  //       document.body.appendChild(tempDiv);

  //       html2canvas(tempDiv, {
  //         // backgroundColor: '#ffffff',
  //         scale: pdfQuality.scale,
  //         useCORS: true,
  //         allowTaint: true,
  //         logging: false,
  //         width: pdfQuality.dimensions.width,
  //         height: pdfQuality.dimensions.height,
  //         removeContainer: true,
  //         foreignObjectRendering: false,
  //         imageTimeout: 30000
  //       })
  //         .then((canvas) => {
  //           document.body.removeChild(tempDiv);
  //           resolve(canvas);
  //         })
  //         .catch((error) => {
  //           document.body.removeChild(tempDiv);
  //           reject(error);
  //         });
  //     } catch (error) {
  //       reject(error);
  //     }
  //   });
  // }

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