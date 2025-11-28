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

      // Floor - Always show
      const currentFloorplan = params.displayedSvgs[idx];
      const floorLabel = params.getFloorLabel(currentFloorplan || '');
      if (floorLabel) {
        const floorNumber = floorLabel.replace(/^Level\s*/i, '').trim();
        pdf.text(`Floor: ${floorNumber}`, 15, yPos);
      } else {
        pdf.text(`Floor: N/A`, 15, yPos);
      }
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
      // Ensure viewBox is set on the live SVG for proper scaling
// 1. Ensure ViewBox exists and fits the content perfectly
      // if (!rootSvg.getAttribute('viewBox')) {
      //   try {
      //     // Measure the actual drawing content
      //     const bbox = rootSvg.getBBox();
          
      //     // Set viewBox to the exact boundaries of the drawing
      //     // bbox.x/y handles the offset if the drawing isn't at 0,0
      //     rootSvg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
      //   } catch (e) {
      //     // Only use this fallback if getBBox fails (rare)
      //     // Ensure these numbers match your SVG's width/height attributes if possible
      //     const width = rootSvg.getAttribute('width') || '1920';
      //     const height = rootSvg.getAttribute('height') || '1018';
      //     rootSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      //   }
      // }
  // 1. Ensure ViewBox is set (do NOT auto-crop to avoid coordinate mismatch)
      // We need the ViewBox to match what's actually rendered in the canvas
      if (!rootSvg.getAttribute('viewBox')) {
        const width = rootSvg.getAttribute('width') || '1920';
        const height = rootSvg.getAttribute('height') || '1018';
        rootSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

try {
        // Capture the live host element directly
        let canvas = await this.captureHostElement(hostEl, params.pdfQuality);
        canvas = this.downscaleCanvasIfNeeded(canvas);

        // 1. MINIMIZE TOP GAP
        // Move image closer to the header text
        const imgY = yPos + 2;

        // 2. MAXIMIZE PAGE USAGE - MAKE FLOORPLAN BIGGER
        // A4 Landscape is approx 297mm x 210mm.
        // Use almost the ENTIRE page for the floorplan
        const pageHeight = pdf.internal.pageSize.getHeight(); // ~210mm
        const pageWidth = pdf.internal.pageSize.getWidth();   // ~297mm
        const maxWidth = pageWidth - 6; // Only 3mm margin on each side (291mm - BIGGER!)
        const maxHeight = pageHeight - imgY - 3; // Only 3mm bottom margin - BIGGER!

        // 3. CALCULATE DIMENSIONS
        const aspect = canvas.width / canvas.height;
        let imgWidth = maxWidth;
        let imgHeight = imgWidth / aspect;

        // If the floorplan is very "tall" (square-ish), constrain by height so it doesn't get cut off
        if (imgHeight > maxHeight) {
          imgHeight = maxHeight;
          imgWidth = imgHeight * aspect;
        }

        // 4. CENTER HORIZONTALLY
        const imgX = (pageWidth - imgWidth) / 2;
        const imgData = canvas.toDataURL('image/png');

        // Draw Image
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
   * Uses SVG Matrix Math with getCTM() for accurate positioning
   *
   * Algorithm:
   * 1. Get Map Boundaries (ViewBox)
   * 2. Find room element by ID
   * 3. Get BBox and transform using Matrix Math (getCTM + matrixTransform)
   * 4. Map Global SVG coordinates to PDF coordinates
   * 5. Draw Box & Text with clickable link
   */
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
private addVideoOverlaysOnPdf(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    svgElement: SVGSVGElement,
    filteredRooms: Room[],
    params: PdfExportParams
  ): void {
    const roomsWithVideos = filteredRooms.filter(room => room.video && room.video.trim() !== '');
    if (roomsWithVideos.length === 0) {
      console.log('⚠️ No rooms with videos found in filtered rooms');
      return;
    }

    // 1. Get the Map's Internal Coordinate System (ViewBox)
    const vbAttr = svgElement.getAttribute('viewBox');
    if (!vbAttr) {
      console.error('❌ No viewBox attribute found on SVG element');
      return;
    }
    const [vbX, vbY, vbW, vbH] = vbAttr.split(' ').map(Number);

    console.log(`🎯 Processing ${roomsWithVideos.length} rooms with videos from ${filteredRooms.length} filtered rooms`);
    console.log(`📏 ViewBox: ${vbX}, ${vbY}, ${vbW}, ${vbH}`);
    console.log(`📄 PDF Image: x=${imgX.toFixed(2)}, y=${imgY.toFixed(2)}, w=${imgWidth.toFixed(2)}, h=${imgHeight.toFixed(2)}`);
    console.log(`🏠 Rooms with videos:`, roomsWithVideos.map(r => `${r.name} (cap: ${r.capacity})`).join(', '));

    roomsWithVideos.forEach(room => {
      console.log(`\n🔍 Looking for room: "${room.name}" (ID: ${room.id}, Video: ${room.video?.substring(0, 50)}...)`);

      // 2. Find the Room Element by ID (with fallbacks)
      let roomElement = svgElement.getElementById(room.id) as SVGGraphicsElement;
      let foundBy = roomElement ? 'by ID' : null;

      // Fallback: try finding by name if ID doesn't work
      if (!roomElement) {
        roomElement = svgElement.getElementById(room.name) as SVGGraphicsElement;
        foundBy = roomElement ? 'by name' : null;
      }

      // Last resort: use helper function to try variants
      if (!roomElement && params.findRoomElementInline) {
        roomElement = params.findRoomElementInline(svgElement, room) as SVGGraphicsElement;
        foundBy = roomElement ? 'by helper function' : null;
      }

      if (!roomElement) {
        console.warn(`❌ Room element not found for ${room.name} (ID: ${room.id})`);
        return;
      }

      console.log(`   Found element ${foundBy}:`, {
        elementId: roomElement.id || roomElement.getAttribute('id'),
        tagName: roomElement.tagName
      });

      // CRITICAL FIX: The element we found might be a small label/icon
      // We need to find the LARGEST polygon/path/rect that represents the actual visible room
      // Strategy: Search up the DOM tree and within siblings to find the room polygon
      const initialBBox = roomElement.getBBox();
      const isSmall = initialBBox.width < 200 || initialBBox.height < 200;

      if (isSmall) {
        console.log(`🔍 Element is small (${initialBBox.width.toFixed(0)}×${initialBBox.height.toFixed(0)}), searching for actual room polygon...`);

        // Strategy 1: Search in parent's children for the largest shape
        let searchParent: Element | null = roomElement.parentElement;
        let largestShape = roomElement;
        let largestArea = initialBBox.width * initialBBox.height;

        // Try up to 3 levels up to find a group containing the room polygon
        for (let level = 0; level < 3 && searchParent; level++) {
          const allShapes = Array.from(searchParent.querySelectorAll('polygon, path, rect, polyline')) as SVGGraphicsElement[];

          console.log(`   Level ${level}: Found ${allShapes.length} shapes in parent <${(searchParent as Element).tagName}>`);

          for (const shape of allShapes) {
            try {
              const shapeBBox = shape.getBBox();
              const area = shapeBBox.width * shapeBBox.height;

              // Only consider shapes that are significantly larger
              if (area > largestArea * 2) {
                largestArea = area;
                largestShape = shape;
                console.log(`   ✓ Found larger <${shape.tagName}> at level ${level}: ${shapeBBox.width.toFixed(0)}×${shapeBBox.height.toFixed(0)} (area: ${area.toFixed(0)})`);
              }
            } catch (e) {
              // Skip shapes that can't get BBox
            }
          }

          if (largestShape !== roomElement) {
            break; // Found a larger shape, stop searching
          }

          searchParent = searchParent.parentElement;
        }

        if (largestShape !== roomElement) {
          console.log(`   ✅ Using LARGEST shape (area: ${largestArea.toFixed(0)})`);
          roomElement = largestShape;
        } else {
          console.warn(`   ⚠️ Could not find larger polygon for ${room.name}. Using original element.`);
        }
      }

      const finalBBox = roomElement.getBBox();
      console.log(`✅ Final room element for ${room.name}`, {
        id: roomElement.id || roomElement.getAttribute('id'),
        tagName: roomElement.tagName,
        bboxSize: `${finalBBox.width.toFixed(0)}×${finalBBox.height.toFixed(0)}`,
        transform: roomElement.getAttribute('transform'),
        parentTransform: roomElement.parentElement?.getAttribute('transform')
      });

      // 3. Get the Matrix (CTM)
      const ctm = roomElement.getCTM();
      if (!ctm) {
        console.error(`❌ No CTM for ${room.name}`);
        return;
      }
      const bbox = roomElement.getBBox();

      // Check if this element looks too small
      const expectedMinSize = 50; // SVG units - rooms should be at least this big in local coords
      if (bbox.width < expectedMinSize || bbox.height < expectedMinSize) {
        console.warn(`⚠️ ${room.name} BBox seems small (w=${bbox.width.toFixed(1)}, h=${bbox.height.toFixed(1)}). Checking parent elements...`);
      }

      // Debug: Log CTM matrix values
      console.log(`   Matrix for ${room.name}:`, {
        a: ctm.a.toFixed(3), b: ctm.b.toFixed(3), c: ctm.c.toFixed(3),
        d: ctm.d.toFixed(3), e: ctm.e.toFixed(3), f: ctm.f.toFixed(3)
      });

      // --- STEP 4: Calculate True Corners in Global SVG Space ---
      let pt = svgElement.createSVGPoint();

      // Top-Left Corner
      pt.x = bbox.x;
      pt.y = bbox.y;
      const globalTL = pt.matrixTransform(ctm);

      // Bottom-Right Corner
      pt.x = bbox.x + bbox.width;
      pt.y = bbox.y + bbox.height;
      const globalBR = pt.matrixTransform(ctm);

      // --- STEP 5: Convert "Map Units" to "PDF Pixels" ---
      // Formula: ImageStart + ((GlobalPos - ViewBoxStart) / ViewBoxSize) * ImageSize
      
      // NOTICE: We subtract vbX and vbY. This is critical for maps that don't start at 0,0.
      const pdfLeft = imgX + ((globalTL.x - vbX) / vbW) * imgWidth;
      const pdfTop = imgY + ((globalTL.y - vbY) / vbH) * imgHeight;
      
      const pdfRight = imgX + ((globalBR.x - vbX) / vbW) * imgWidth;
      const pdfBottom = imgY + ((globalBR.y - vbY) / vbH) * imgHeight;

      // --- STEP 6: Calculate Center & Size ---
      // We use Math.abs to ensure positive width/height regardless of rotation
      const roomPdfW = Math.abs(pdfRight - pdfLeft);
      const roomPdfH = Math.abs(pdfBottom - pdfTop);

      const centerX = (pdfLeft + pdfRight) / 2;
      const centerY = (pdfTop + pdfBottom) / 2;

      // Scale the box to be smaller than the room (65% of smallest side)
      const minDim = Math.min(roomPdfW, roomPdfH);
      const boxSize = minDim * 0.65;

      const boxX = centerX - (boxSize / 2);
      const boxY = centerY - (boxSize / 2);

      // Validate coordinates are within ViewBox bounds
      const isWithinBounds =
        globalTL.x >= vbX && globalTL.x <= (vbX + vbW) &&
        globalTL.y >= vbY && globalTL.y <= (vbY + vbH) &&
        globalBR.x >= vbX && globalBR.x <= (vbX + vbW) &&
        globalBR.y >= vbY && globalBR.y <= (vbY + vbH);

      console.log(`📦 ${room.name}:`, {
        svgBBox: `x=${bbox.x.toFixed(1)}, y=${bbox.y.toFixed(1)}, w=${bbox.width.toFixed(1)}, h=${bbox.height.toFixed(1)}`,
        globalTL: `x=${globalTL.x.toFixed(1)}, y=${globalTL.y.toFixed(1)}`,
        globalBR: `x=${globalBR.x.toFixed(1)}, y=${globalBR.y.toFixed(1)}`,
        pdfBox: `x=${boxX.toFixed(1)}, y=${boxY.toFixed(1)}, size=${boxSize.toFixed(1)}`,
        withinBounds: isWithinBounds ? '✅' : '❌ OUT OF BOUNDS!'
      });

      if (!isWithinBounds) {
        console.warn(`⚠️ ${room.name} coordinates are outside ViewBox bounds!`);
      }

      // --- STEP 7: Draw the Box ---
      const color = this.getRoomColorForPdf(room, params);
      const rgb = params.hexToRgb(color);

      pdf.saveGraphicsState();
      try { pdf.setGState(new (pdf as any).GState({ opacity: 0.8 })); } catch (e) {}

      if (rgb) pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      else pdf.setFillColor(200, 200, 200);

      pdf.rect(boxX, boxY, boxSize, boxSize, 'F'); // Fill box
      pdf.restoreGraphicsState();

      // Border
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.1);
      pdf.rect(boxX, boxY, boxSize, boxSize, 'D');

      // Text
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');

      // Dynamic font size: fits 30% of box width (min 2pt, max 8pt)
      const fontSize = Math.max(2, Math.min(8, boxSize * 0.3));
      pdf.setFontSize(fontSize);

      const lh = fontSize * 0.45;

      // Suite name at top (smaller)
      const suiteNameFontSize = Math.max(2, fontSize * 0.5 );
      pdf.setFontSize(suiteNameFontSize);
      pdf.text(room.name, centerX, centerY - lh * 2.5, {
        align: 'center',
        baseline: 'middle'
      });

      // "WATCH TOUR" text
      pdf.setFontSize(fontSize);
      pdf.text('WATCH', centerX, centerY - lh, { align: 'center', baseline: 'middle' });
      pdf.text('TOUR', centerX, centerY + lh, { align: 'center', baseline: 'middle' });

      // Link
      pdf.link(boxX, boxY, boxSize, boxSize, {
        url: room.video,
        target: '_blank'
      });
    });
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