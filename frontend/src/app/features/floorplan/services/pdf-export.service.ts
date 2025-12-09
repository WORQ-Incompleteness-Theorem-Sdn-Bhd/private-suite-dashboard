import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { OfficeService } from '../../../core/services/office.service';
import { FloorService } from '../../../core/services/floor.service';
import { ColorPaxService } from './color-pax.service';
import { Filters } from './dropdown-filter.service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { svg2pdf } from 'svg2pdf.js';
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
    private colorPaxService: ColorPaxService
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
  /**
   * Helper: Convert hex color to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
  /**
   * Add legend to PDF showing suite status indicators and capacity colors
   * Logic:
   * - If user selected date/date range (without status dropdown) -> Show STATUS colors (Available/Occupied)
   * - If user selected status dropdown -> Show PAX capacity colors
   */
  private addLegendToPdf(
    pdf: jsPDF,
    pageWidth: number,
    yPos: number,
    params: PdfExportParams
  ): number {
    // Determine which legend to show
    // Status filter values: "Available", "Occupied", "Select Status" (default)
    const hasDateFilter = params.selectedStartDate && params.selectedStartDate.trim() !== '';
    const hasStatusFilter = params.filters.status &&
                           params.filters.status !== 'Select Status' &&
                           (params.filters.status === 'Available' || params.filters.status === 'Occupied');
    // Decision logic:
    // - Show STATUS colors ONLY if date is selected AND status is NOT selected (status = "Select Status")
    const showStatusColors = hasDateFilter && !hasStatusFilter;
    // If no date selected or status is selected, don't show legend
    if (!showStatusColors) {
      return yPos;
    }
    // 1. Setup Legend Position (Right side, aligned with metadata labels)
    const legendWidth = 32; // Compact width
    const startX = pageWidth - legendWidth - 35; // 25mm from right edge (moved 10mm to the left)
    let currentY = 20; // Start at same Y position as metadata labels
    // Calculate legend height dynamically based on content
    const titleHeight = 4.5; // Title line height
    const sectionTitleHeight = 3.5; // "Status Colors:" height
    const itemHeight = 3.5; // Each status item (Available, Occupied)
    const topPadding = 3; // Top padding inside box
    const bottomPadding = 1.5; // Bottom padding inside box (reduced)

    let legendHeight = titleHeight + topPadding; // Start with title + top padding
    if (showStatusColors) {
      legendHeight += sectionTitleHeight + (2 * itemHeight) + bottomPadding; // Section title + 2 items + bottom padding
    }

    // Draw Legend Box (Optional background)
    pdf.setFillColor(250, 250, 250); // Very light gray
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.rect(startX - 2, currentY - 2, legendWidth, legendHeight, 'FD');

    // Calculate vertical center offset to center content in box
    const boxStartY = currentY - 2; // Box top position
    const contentHeight = titleHeight + (showStatusColors ? sectionTitleHeight + (2 * itemHeight) : 0);
    const verticalOffset = (legendHeight - contentHeight) / 2;

    // Title (centered vertically in box)
    currentY = boxStartY + verticalOffset + 2; // Start from box top + offset + baseline adjustment
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Legend', startX, currentY);
    currentY += 4.5;
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    // Show STATUS COLORS (Available = Green, Occupied = Red)
    if (showStatusColors) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Status Colors:', startX, currentY);
      currentY += 3.5;
      pdf.setFont('helvetica', 'normal');
      // Available (Green)
      pdf.setFillColor(34, 197, 94); // Light green
      pdf.setDrawColor(100, 100, 100);
      pdf.rect(startX, currentY - 2.5, 3, 3, 'FD');
      pdf.setTextColor(0, 0, 0);
      pdf.text('Available', startX + 4.5, currentY);
      currentY += 3.5;
      // Occupied (Red)
      pdf.setFillColor(239, 68, 68); // Light red/pink
      pdf.setDrawColor(100, 100, 100);
      pdf.rect(startX, currentY - 2.5, 3, 3, 'FD');
      pdf.setTextColor(0, 0, 0);
      pdf.text('Occupied', startX + 4.5, currentY);
      currentY += 3.5;
    }
    return yPos; // Return original yPos so main layout isn't affected
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
      pdf.setFontSize(16); // Larger header font
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 15, 10);
      // Add helpful note on top-right
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100); // Gray color
      const noteText = 'Click the suite name or click directly on the suite in the floorplan to watch the tour.';
      const noteWidth = pdf.getTextWidth(noteText);
      pdf.text(noteText, pageWidth - noteWidth - 15, 10, { align: 'left' });
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      let yPos = 20;
      // Add metadata labels (Outlet, Floor, Pax, Date, Suites)
      yPos = this.addMetadataLabels(pdf, params, rootSvg, idx, yPos, pageWidth);
      // Add legend (Status colors or Pax capacity colors)
      this.addLegendToPdf(pdf, pageWidth, yPos, params);
      // --- IMAGE GENERATION ---
      // Clone SVG to avoid modifying the original DOM element
      const svgForRender = rootSvg.cloneNode(true) as SVGSVGElement;
      // Smart auto-crop based on actual room elements
      this.applySmartAutoCrop(svgForRender, params, 'Raster ');
      // Temporarily append to DOM for rendering (html2canvas needs it in DOM)
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '-9999px';
      tempContainer.appendChild(svgForRender);
      document.body.appendChild(tempContainer);
      try {
        // ============================================================
        // PIXEL-PERFECT PDF EXPORT WITH EXACT TARGET METRICS
        // ============================================================
        // A4 Landscape dimensions
        const pageWidth = pdf.internal.pageSize.getWidth();   // 297.04mm
        const pageHeight = pdf.internal.pageSize.getHeight(); // 210.08mm
        // Step 1: Capture canvas at high quality (use the cloned SVG)
        let canvas = await this.captureHostElement(tempContainer, params.pdfQuality);
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
        // IMPORTANT: Use svgForRender (cloned/cropped) not rootSvg (original)
        this.addSelectedSuiteIndicators(
          pdf,
          imgX, imgY, imgWidth, imgHeight,
          svgForRender,
          params.filteredRooms,
          params
        );
      } catch (canvasError) {
        pdf.setFontSize(14);
        pdf.setTextColor(0, 0, 0);
        pdf.text('Floorplan SVG (could not render image)', 20, 20);
      } finally {
        // Clean up: Remove temporary container from DOM
        if (tempContainer && tempContainer.parentNode) {
          document.body.removeChild(tempContainer);
        }
      }
    }
    // NOTE: Removed summary list call as requested.
    pdf.setPage(pdf.getNumberOfPages());
    return pdf;
  }
  /**
   * Helper method: Calculate PDF coordinates for a room element
   * Uses getBBox() and getCTM() for accurate positioning, avoiding <defs> templates
   *
   * @returns PDF coordinates {pdfX, pdfY, pdfW, pdfH} or null if room not found
   */
  private getRoomPdfCoordinates(
    room: Room,
    svgElement: SVGSVGElement,
    vbX: number, vbY: number, vbW: number, vbH: number,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    params: PdfExportParams
  ): { pdfX: number; pdfY: number; pdfW: number; pdfH: number } | null {
    // Find room element (automatically prefers shapes over text)
    let roomElement = params.findRoomElementInline(svgElement, room) as SVGGraphicsElement;
    if (!roomElement) {
      console.warn(`⚠️ ${room.name}: Element not found in SVG`);
      return null;
    }
    // Skip elements inside <defs> - these are just templates, not the actual rooms
    if (roomElement.closest('defs')) {
      console.warn(`⚠️ ${room.name}: Found element inside <defs> (template definition), skipping`);
      // Fallback: try to find element NOT in <defs>
      const candidates = [
        room.id,
        room.name,
        room.name.replace(/\s+/g, ''),
        room.name.replace(/\s+/g, '-'),
        room.name.replace(/\s+/g, '_'),
      ];
      for (const candidate of candidates) {
        const escaped = CSS.escape(candidate);
        const elements = svgElement.querySelectorAll(`#${escaped}`);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!el.closest('defs')) {
            roomElement = el as SVGGraphicsElement;
            console.log(`✅ ${room.name}: Found visible instance (not in <defs>)`);
            break;
          }
        }
        if (roomElement && !roomElement.closest('defs')) break;
      }
      // If still in <defs>, give up
      if (roomElement.closest('defs')) {
        console.warn(`❌ ${room.name}: All elements found are in <defs>, cannot position`);
        return null;
      }
    }
    // Verify we got a shape element, not text
    const elementType = roomElement.tagName.toLowerCase();
    if (elementType === 'text' || elementType === 'tspan') {
      console.warn(`❌ ${room.name}: Only text element found, no shape. Skipping.`);
      return null;
    }
    const bbox = roomElement.getBBox();
    // Validate bbox dimensions
    if (bbox.width <= 0 || bbox.height <= 0) {
      console.warn(`⚠️ ${room.name}: Invalid bbox dimensions (${bbox.width}x${bbox.height})`);
      return null;
    }
    // Map SVG ViewBox Units -> PDF Image Coordinates
    // getBBox() returns coordinates in the element's local coordinate system
    // We need to map these to PDF coordinates using the viewBox
    const pdfX = imgX + ((bbox.x - vbX) / vbW) * imgWidth;
    const pdfY = imgY + ((bbox.y - vbY) / vbH) * imgHeight;
    const pdfW = (bbox.width / vbW) * imgWidth;
    const pdfH = (bbox.height / vbH) * imgHeight;
    // Safety check: if the box is exactly at the top-left corner, something is wrong
    if (Math.abs(pdfX - imgX) < 1 && Math.abs(pdfY - imgY) < 1) {
      console.warn(`❌ ${room.name}: Box positioned at top-left corner (likely still finding <defs>), skipping`);
      return null;
    }
    console.log(`📍 ${room.name}: Position calculated`, {
      elementType,
      svgCoords: { x: bbox.x.toFixed(1), y: bbox.y.toFixed(1), w: bbox.width.toFixed(1), h: bbox.height.toFixed(1) },
      viewBox: { x: vbX, y: vbY, w: vbW, h: vbH },
      pdfCoords: { x: pdfX.toFixed(2), y: pdfY.toFixed(2), w: pdfW.toFixed(2), h: pdfH.toFixed(2) }
    });
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
      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight,
        params
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
      // Draw YouTube icon at top of box
      const iconSize = Math.min(smallerW, smallerH) * 0.25;
      const iconY = boxY + iconSize * 0.8;
      this.drawYouTubeIcon(pdf, boxX + smallerW / 2, iconY, iconSize);
      // Add suite label directly below icon (tight spacing)
      pdf.setFontSize(6);
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      const totalSelectedWithVideo = selectedRooms.length + nonSelectedRooms.length;
      const labelText = totalSelectedWithVideo > 1 && room.capacity
        ? `${room.name}`
        : room.name;
      const suiteNameY = iconY + iconSize * 0.7 + 1; // Tight spacing below icon
      pdf.text(labelText, boxX + smallerW / 2, suiteNameY, { align: 'center', baseline: 'middle' });
      // "WATCH TOUR" text directly below suite name (tight spacing)
      pdf.setFontSize(4);
      const watchTourY = suiteNameY + 1.5; // Tight spacing below suite name
      pdf.text('WATCH TOUR', boxX + smallerW / 2, watchTourY, { align: 'center', baseline: 'middle' });
      // Add clickable area
      pdf.link(boxX, boxY, smallerW, smallerH, {
        url: room.video,
        target: '_blank'
      });
    });
    // Add clickable links with visual indicators for selected rooms // sini clickable area
    selectedRooms.forEach(room => {
      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight,
        params
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
      // Draw YouTube icon at top of box
      const iconSize = Math.min(smallerW, smallerH) * 0.25;
      const iconY = boxY + iconSize * 0.8;
      this.drawYouTubeIcon(pdf, boxX + smallerW / 2, iconY, iconSize);
      // Add suite label for selected rooms directly below icon (tight spacing)
      pdf.setFontSize(5);
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      const totalSelectedWithVideo = selectedRooms.length + nonSelectedRooms.length;
      const labelText = totalSelectedWithVideo > 1 && room.capacity
        ? `${room.name}`
        : room.name;
      const suiteNameY = iconY + iconSize * 0.7 + 1; // Tight spacing below icon
      pdf.text(labelText, boxX + smallerW / 2, suiteNameY, { align: 'center', baseline: 'middle' });
      // "WATCH TOUR" text directly below suite name (tight spacing)
      pdf.setFontSize(4);
      const watchTourY = suiteNameY + 1.5; // Tight spacing below suite name
      pdf.text('WATCH TOUR', boxX + smallerW / 2, watchTourY, { align: 'center', baseline: 'middle' });
      // Add clickable area
      pdf.link(boxX, boxY, smallerW, smallerH, {
        url: room.video!,
        target: '_blank'
      });
    });
    // Add "Suite" labels for rooms WITHOUT videos (selected and non-selected)
    const roomsWithoutVideo = filteredRooms.filter(room => !room.video || room.video.trim() === '');
    roomsWithoutVideo.forEach(room => {
      const coords = this.getRoomPdfCoordinates(
        room, svgElement,
        vbX, vbY, vbW, vbH,
        imgX, imgY, imgWidth, imgHeight,
        params
      );
      if (!coords) return;
      const { pdfX, pdfY, pdfW, pdfH } = coords;
      // Validation
      const isOutsideLeft = pdfX + pdfW < imgX;
      const isOutsideRight = pdfX > imgX + imgWidth;
      const isOutsideTop = pdfY + pdfH < imgY;
      const isOutsideBottom = pdfY > imgY + imgHeight;
      const isTooFarLeft = pdfX < imgX - 10;
      const isTooFarUp = pdfY < imgY - 10;
      if (isOutsideLeft || isOutsideRight || isOutsideTop || isOutsideBottom ||
          isTooFarLeft || isTooFarUp) {
        return;
      }
      // Make box smaller and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;
      // Add suite name in center (gray color for non-video suites)
      pdf.setFontSize(6);
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'bold');
      pdf.text(room.name, boxX + smallerW / 2, boxY + smallerH / 2, { align: 'center', baseline: 'middle' });
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
  /**
   * NEW: Vector-based PDF export using svg2pdf.js
   * Renders SVG directly to PDF for crisp, scalable output
   * Includes clickable links and labels for selected suites
   */
  async exportFloorplanAsPdfVector(params: PdfExportParams): Promise<jsPDF> {
    const pdf = new jsPDF('landscape', 'mm', 'a4');
    pdf.setProperties({
      title: 'Private Suite Dashboard - Floorplan',
      subject: 'Floorplan Export',
      author: 'Private Suite Dashboard',
      creator: 'Private Suite Dashboard',
    });
    const pageWidth = pdf.internal.pageSize.getWidth();   // 297mm
    const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm
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
      // Check if this page should be included
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
      // Add header and labels
      pdf.setFontSize(16);
      pdf.setTextColor(255, 102, 0);
      pdf.text('Private Suite Dashboard - Floorplan', 15, 10);
      // Add helpful note on top-right
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100); // Gray color
      const noteText = 'Click the suite name or click directly on the suite in the floorplan to watch the tour.';
      const noteWidth = pdf.getTextWidth(noteText);
      pdf.text(noteText, pageWidth - noteWidth - 15, 10, { align: 'left' });
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      let yPos = 20;
      // Add metadata labels (Outlet, Floor, Pax, Date, Suites)
      yPos = this.addMetadataLabels(pdf, params, rootSvg, idx, yPos, pageWidth);
      // CALL THE LEGEND HERE
      this.addLegendToPdf(pdf, pageWidth, yPos, params);
      // Clone SVG for manipulation
      const svgClone = rootSvg.cloneNode(true) as SVGSVGElement;
      // Smart auto-crop based on actual room elements
      this.applySmartAutoCrop(svgClone, params, 'Vector ');
      // Get viewBox for coordinate mapping
      const vbAttr = svgClone.getAttribute('viewBox');
      if (!vbAttr) {
        console.warn('SVG missing viewBox, using defaults');
        svgClone.setAttribute('viewBox', '0 0 1920 1018');
      }
      const [vbX, vbY, vbW, vbH] = (svgClone.getAttribute('viewBox') || '0 0 1920 1018').split(' ').map(Number);
      // Calculate available space for SVG
      const imgY = yPos + 5;
      const availableWidth = pageWidth - 80;  // 40mm margins
      const availableHeight = pageHeight - imgY - 15;
      // Calculate aspect ratios
      const svgAspectRatio = vbW / vbH;
      const availableAspectRatio = availableWidth / availableHeight;
      let imgWidth: number, imgHeight: number;
      if (svgAspectRatio > availableAspectRatio) {
        // SVG is wider - constrain by width
        imgWidth = availableWidth;
        imgHeight = imgWidth / svgAspectRatio;
      } else {
        // SVG is taller - constrain by height
        imgHeight = availableHeight;
        imgWidth = imgHeight * svgAspectRatio;
      }
      // Center horizontally
      const leftMargin = 40;
      const imgX = leftMargin + (availableWidth - imgWidth) / 2;
      // Store transformation parameters for coordinate mapping
      const scaleX = imgWidth / vbW;
      const scaleY = imgHeight / vbH;
      console.log(`📐 SVG Transformation:`, {
        viewBox: { x: vbX, y: vbY, w: vbW, h: vbH },
        pdfPosition: { x: imgX, y: imgY, w: imgWidth, h: imgHeight },
        scale: { x: scaleX, y: scaleY }
      });
      // Render SVG to PDF using svg2pdf.js
      try {
        await svg2pdf(svgClone, pdf, {
          x: imgX,
          y: imgY,
          width: imgWidth,
          height: imgHeight
        });
        console.log(`✅ SVG rendered to PDF at position (${imgX}, ${imgY}) with size ${imgWidth}x${imgHeight}mm`);
        // Add clickable links and labels overlay
        // IMPORTANT: Use svgClone (not rootSvg) because that's what was rendered
        this.addClickableLinksVector(
          pdf,
          imgX, imgY, imgWidth, imgHeight,
          vbX, vbY, vbW, vbH,
          scaleX, scaleY,
          svgClone,  // Use the cloned/cropped SVG, not the original
          params
        );
      } catch (error) {
        console.error('Error rendering SVG to PDF:', error);
        pdf.setFontSize(14);
        pdf.setTextColor(255, 0, 0);
        pdf.text('Error rendering floorplan', 20, imgY + 20);
      }
    }
    pdf.setPage(pdf.getNumberOfPages());
    return pdf;
  }
  /**
   * Smart auto-crop SVG to focus on rooms with videos
   * Calculates bounding box from room elements and applies padding
   */
  private applySmartAutoCrop(
    svgElement: SVGSVGElement,
    params: PdfExportParams,
    logPrefix: string = ''
  ): void {
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let foundRooms = 0;
      // Calculate bounds from ALL rooms with videos (not just filtered)
      // This ensures clickable boxes don't get clipped on the right side
      const roomsToInclude = params.filteredRooms.filter(r => r.video && r.video.trim() !== '');
      roomsToInclude.forEach(room => {
        const el = params.findRoomElementInline(svgElement, room) as SVGGraphicsElement;
        if (el && el.tagName.toLowerCase() !== 'text' && el.tagName.toLowerCase() !== 'tspan') {
          try {
            const bbox = el.getBBox();
            if (bbox.width > 0 && bbox.height > 0) {
              minX = Math.min(minX, bbox.x);
              minY = Math.min(minY, bbox.y);
              maxX = Math.max(maxX, bbox.x + bbox.width);
              maxY = Math.max(maxY, bbox.y + bbox.height);
              foundRooms++;
              console.log(`📏 ${room.name}: bbox = (${bbox.x.toFixed(0)}, ${bbox.y.toFixed(0)}, ${bbox.width.toFixed(0)}x${bbox.height.toFixed(0)})`);
            }
          } catch (e) {
            // Skip elements that can't provide bbox
          }
        }
      });
      // If we found room bounds, use them; otherwise fall back to full SVG bbox
      if (foundRooms > 0 && isFinite(minX)) {
        const padding = 50; // Larger padding to ensure no clipping
        const newViewBox = `${minX - padding} ${minY - padding} ${(maxX - minX) + (padding * 2)} ${(maxY - minY) + (padding * 2)}`;
        svgElement.setAttribute('viewBox', newViewBox);
        console.log(`📦 ${logPrefix}Auto-crop: Found ${foundRooms} rooms with videos`);
        console.log(`📦 ${logPrefix}Bounds: minX=${minX.toFixed(0)}, minY=${minY.toFixed(0)}, maxX=${maxX.toFixed(0)}, maxY=${maxY.toFixed(0)}`);
        console.log(`📦 ${logPrefix}ViewBox: ${newViewBox}`);
      } else {
        // Fallback to entire SVG bbox
        const bbox = svgElement.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          const padding = 10;
          const newViewBox = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + (padding * 2)} ${bbox.height + (padding * 2)}`;
          svgElement.setAttribute('viewBox', newViewBox);
          console.log(`📦 ${logPrefix}Auto-crop: Using full SVG bbox, viewBox: ${newViewBox}`);
        }
      }
    } catch (e) {
      console.warn(`${logPrefix}Auto-crop failed, using existing viewBox:`, e);
      // Only set default if absolutely nothing exists
      if (!svgElement.getAttribute('viewBox')) {
        svgElement.setAttribute('viewBox', '0 0 1920 1018');
      }
    }
  }
  /**
   * Add metadata labels to PDF (Outlet, Floor, Pax, Date, Suites)
   * Returns the final Y position after labels
   */
  private addMetadataLabels(
    pdf: jsPDF,
    params: PdfExportParams,
    rootSvg: SVGSVGElement,
    pageIdx: number,
    startY: number,
    pageWidth: number
  ): number {
    let yPos = startY;
    // Outlet
    const selectedOffice = this.officeService.getOffices().find(office => office.id === params.filters.outlet);
    const outletDisplayName = params.filters.outlet !== 'Select Outlet' && selectedOffice
      ? selectedOffice.displayName
      : params.filters.outlet;
    pdf.text(`Outlet: ${outletDisplayName}`, 15, yPos);
    yPos += 6;
    // Floor
    let floorLabel = 'N/A';
    const visibleRooms = params.filteredRooms.filter(room => {
      const el = params.findRoomElementInline(rootSvg, room);
      return !!el && room.floor_id;
    });
    if (visibleRooms.length > 0 && visibleRooms[0].floor_id) {
      const floorId = visibleRooms[0].floor_id;
      floorLabel = this.floorService.getFloorLabelFromMap(floorId, params.floorIdToFloorMap);
    } else {
      const currentFloorplan = params.displayedSvgs[pageIdx];
      if (currentFloorplan) {
        floorLabel = params.getFloorLabel(currentFloorplan);
      }
    }
    pdf.text(`Floor: ${floorLabel}`, 15, yPos);
    yPos += 6;
    // Pax
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
    yPos += 6;
    // Date
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
    yPos += 6;
    // Suites
    const suitesToShow = (() => {
      const pageRoomHasName = (name: string) => {
        const room = params.rooms.find(r => r.name === name);
        return room ? !!params.findRoomElementInline(rootSvg, room) : false;
      };
      if (params.selectedSuites.length > 0) {
        return params.selectedSuites.filter(pageRoomHasName);
      }
      const roomsOnThisPage = params.filteredRooms
        .filter(r => pageRoomHasName(r.name))
        .map(r => r.name);
      return Array.from(new Set(roomsOnThisPage))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    })();
    pdf.setFontSize(12);
    if (suitesToShow.length > 0) {
      const suitesLabel = 'Suite: ';
      const manySuites = suitesToShow.length > 6;
      const fontToUse = manySuites ? 9 : 11;
      pdf.setFontSize(fontToUse);
      // Render "Suite: " label
      pdf.text(suitesLabel, 15, yPos);
      // Calculate starting X position after "Suite: " label
      const labelWidth = pdf.getTextWidth(suitesLabel);
      let currentX = 15 + labelWidth;
      let currentY = yPos;
      const maxWidth = pageWidth - 100;
      const lineHeight = manySuites ? 5 : 5.5;
      // Render each suite with clickable link
      suitesToShow.forEach((suiteName, index) => {
        const room = params.rooms.find(r => r.name === suiteName);
        const hasVideo = room && room.video && room.video.trim() !== '';
        // Build suite text with pax (no icon)
        const suiteText = (suitesToShow.length > 1 && room && room.capacity)
          ? `${suiteName} (Pax: ${room.capacity})`
          : suiteName;
        const iconSize = fontToUse * 0.35; // Icon size based on font size
        const iconSpacing = hasVideo ? iconSize + 1 : 0; // Space for icon + gap
        // Check if we need to wrap to next line
        if (index > 0) {
          const commaText = ', ';
          const commaWidth = pdf.getTextWidth(commaText);
          const wrappedWidth = pdf.getTextWidth(suiteText);
          if (currentX + commaWidth + iconSpacing + wrappedWidth > maxWidth) {
            // Wrap to next line
            currentY += lineHeight;
            currentX = 15 + 8; // Indent wrapped lines
            // Draw YouTube icon if has video
            if (hasVideo) {
              this.drawYouTubeIcon(pdf, currentX + iconSize / 2, currentY - iconSize * 0.4, iconSize);
              currentX += iconSize + 1; // Move past icon
            }
            pdf.text(suiteText, currentX, currentY);
            // Add clickable link if suite has video
            if (hasVideo) {
              pdf.link(currentX - iconSize - 1, currentY - 3, wrappedWidth + iconSize + 1, 4, { url: room.video, target: '_blank' });
            }
            currentX += wrappedWidth;
          } else {
            // Same line - add comma, then icon, then text
            pdf.text(commaText, currentX, currentY);
            currentX += commaWidth;
            // Draw YouTube icon after comma if has video
            if (hasVideo) {
              this.drawYouTubeIcon(pdf, currentX + iconSize / 2, currentY - iconSize * 0.4, iconSize);
              currentX += iconSize + 1; // Move past icon
            }
            pdf.text(suiteText, currentX, currentY);
            // Add clickable link if suite has video (only over icon + text, not comma)
            if (hasVideo) {
              pdf.link(currentX - iconSpacing, currentY - 3, wrappedWidth + iconSpacing, 4, { url: room.video, target: '_blank' });
            }
            currentX += wrappedWidth;
          }
        } else {
          // First item - draw icon before text if has video
          if (hasVideo) {
            this.drawYouTubeIcon(pdf, currentX + iconSize / 2, currentY - iconSize * 0.4, iconSize);
            currentX += iconSize + 1; // Move past icon
          }
          pdf.text(suiteText, currentX, currentY);
          const textWidth = pdf.getTextWidth(suiteText);
          // Add clickable link if suite has video
          if (hasVideo) {
            pdf.link(currentX - iconSpacing, currentY - 3, textWidth + iconSpacing, 4, { url: room.video, target: '_blank' });
          }
          currentX += textWidth;
        }
      });
      yPos = currentY + lineHeight;
      pdf.setFontSize(12);
    } else {
      pdf.text('Suite: None', 15, yPos);
      yPos += 5;
    }
    return yPos;
  }
  /**
   * Add clickable links and labels for suites with video URLs
   * Uses the transformation parameters from svg2pdf rendering
   */
  private addClickableLinksVector(
    pdf: jsPDF,
    imgX: number, imgY: number, imgWidth: number, imgHeight: number,
    vbX: number, vbY: number, vbW: number, vbH: number,
    scaleX: number, scaleY: number,
    rootSvg: SVGSVGElement,
    params: PdfExportParams
  ): void {
    const filteredRooms = params.filteredRooms;
    // Separate selected and non-selected rooms with video links
    const selectedRooms = filteredRooms.filter(room =>
      params.selectedSuites.includes(room.name) && room.video && room.video.trim() !== ''
    );
    const nonSelectedRooms = filteredRooms.filter(room =>
      !params.selectedSuites.includes(room.name) && room.video && room.video.trim() !== ''
    );
    console.log(`🔗 Adding clickable links: ${selectedRooms.length} selected, ${nonSelectedRooms.length} non-selected`);
    // Add blue boxes for non-selected suites
    nonSelectedRooms.forEach(room => {
      const coords = this.getRoomPdfCoordinatesVector(
        room, rootSvg,
        imgX, imgY, vbX, vbY, scaleX, scaleY,
        params
      );
      if (!coords) return;
      const { pdfX, pdfY, pdfW, pdfH } = coords;
      // Make box smaller (60% of original size) and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;
      // Blue border
      pdf.setDrawColor(0, 0, 255);
      pdf.setLineWidth(0.4);
      pdf.rect(boxX, boxY, smallerW, smallerH, 'S');
      // Draw YouTube icon at top
      const iconSize = Math.min(smallerW, smallerH) * 0.3;
      const iconY = boxY + iconSize * 0.7;
      this.drawYouTubeIcon(pdf, boxX + smallerW / 2, iconY, iconSize);
      // Add suite label directly below icon (tight spacing)
      pdf.setFontSize(5);
      pdf.setTextColor(0, 0, 255);
      const suiteNameY = iconY + iconSize * 0.7 + 0.8; // Tight spacing
      pdf.text(room.name, boxX + smallerW / 2, suiteNameY, { align: 'center', baseline: 'middle' });
      // Add clickable link
      pdf.link(boxX, boxY, smallerW, smallerH, { url: room.video, target: '_blank' });
      console.log(`🔵 ${room.name}: Blue box at (${boxX.toFixed(1)}, ${boxY.toFixed(1)})`);
    });
    // Add orange boxes for selected suites
    selectedRooms.forEach(room => {
      const coords = this.getRoomPdfCoordinatesVector(
        room, rootSvg,
        imgX, imgY, vbX, vbY, scaleX, scaleY,
        params
      );
      if (!coords) return;
      const { pdfX, pdfY, pdfW, pdfH } = coords;
      // Make box smaller (60% of original size) and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;
      // Orange border
      pdf.setDrawColor(255, 102, 0);
      pdf.setLineWidth(0.8);
      pdf.rect(boxX, boxY, smallerW, smallerH, 'S');
      // Draw YouTube icon at top
      const iconSize = Math.min(smallerW, smallerH) * 0.3;
      const iconY = boxY + iconSize * 0.7;
      this.drawYouTubeIcon(pdf, boxX + smallerW / 2, iconY, iconSize);
      // Add suite label directly below icon (tight spacing)
      pdf.setFontSize(5);
      pdf.setTextColor(255, 102, 0);
      const suiteNameY = iconY + iconSize * 0.7 + 0.8; // Tight spacing
      pdf.text(room.name, boxX + smallerW / 2, suiteNameY, { align: 'center', baseline: 'middle' });
      // Add clickable link
      pdf.link(boxX, boxY, smallerW, smallerH, { url: room.video!, target: '_blank' });
      console.log(`🟠 ${room.name}: Orange box at (${boxX.toFixed(1)}, ${boxY.toFixed(1)})`);
    });
    // Add "Suite" labels for rooms WITHOUT videos (gray labels)
    const roomsWithoutVideo = filteredRooms.filter(room => !room.video || room.video.trim() === '');
    roomsWithoutVideo.forEach(room => {
      const coords = this.getRoomPdfCoordinatesVector(
        room, rootSvg,
        imgX, imgY, vbX, vbY, scaleX, scaleY,
        params
      );
      if (!coords) return;
      const { pdfX, pdfY, pdfW, pdfH } = coords;
      // Make box smaller and center it
      const smallerW = pdfW * 0.6;
      const smallerH = pdfH * 0.6;
      const boxX = pdfX + (pdfW - smallerW) / 2;
      const boxY = pdfY + (pdfH - smallerH) / 2;
      // Add suite name in center (gray color for non-video suites)
      pdf.setFontSize(6);
      pdf.setTextColor(100, 100, 100);
      pdf.setFont('helvetica', 'bold');
      pdf.text(room.name, boxX + smallerW / 2, boxY + smallerH / 2, { align: 'center', baseline: 'middle' });
      console.log(`⚫ ${room.name}: Gray label at (${boxX.toFixed(1)}, ${boxY.toFixed(1)})`);
    });
  }
  /**
   * Draw YouTube icon in PDF
   * @param pdf - jsPDF instance
   * @param x - X coordinate (center)
   * @param y - Y coordinate (center)
   * @param size - Icon size (width/height in mm)
   */
  private drawYouTubeIcon(pdf: jsPDF, x: number, y: number, size: number): void {
    const halfSize = size / 2;
    const cornerRadius = size * 0.15;

    // Save current state
    pdf.saveGraphicsState();

    // Draw rounded rectangle (YouTube background)
    pdf.setFillColor(255, 0, 0); // YouTube red
    pdf.roundedRect(x - halfSize, y - halfSize, size, size, cornerRadius, cornerRadius, 'F');

    // Draw play triangle (white)
    pdf.setFillColor(255, 255, 255);
    const triangleSize = size * 0.35;
    const triangleX = x - triangleSize * 0.15; // Slightly offset to right
    const triangleY = y;

    // Create triangle path
    const x1 = triangleX - triangleSize / 2;
    const y1 = triangleY - triangleSize / 2;
    const x2 = triangleX - triangleSize / 2;
    const y2 = triangleY + triangleSize / 2;
    const x3 = triangleX + triangleSize / 2;
    const y3 = triangleY;

    pdf.triangle(x1, y1, x2, y2, x3, y3, 'F');

    // Restore state
    pdf.restoreGraphicsState();
  }

  private getRoomPdfCoordinatesVector(
    room: Room,
    svgElement: SVGSVGElement,
    imgX: number, imgY: number,
    vbX: number, vbY: number,
    scaleX: number, scaleY: number,
    params: PdfExportParams
  ): { pdfX: number; pdfY: number; pdfW: number; pdfH: number } | null {
    // Find room element (automatically prefers shapes over text)
    const roomElement = params.findRoomElementInline(svgElement, room) as SVGGraphicsElement;
    if (!roomElement) {
      console.warn(`⚠️ ${room.name}: Element not found in SVG`);
      return null;
    }
    // Verify we got a shape element, not text
    const elementType = roomElement.tagName.toLowerCase();
    if (elementType === 'text' || elementType === 'tspan') {
      console.warn(`❌ ${room.name}: Only text element found, no shape. Skipping.`);
      return null;
    }
    // Get bounding box in SVG coordinates
    const bbox = roomElement.getBBox();
    if (bbox.width <= 0 || bbox.height <= 0) {
      console.warn(`⚠️ ${room.name}: Invalid bbox dimensions (${bbox.width}x${bbox.height})`);
      return null;
    }
    // COORDINATE MAPPING FORMULA:
    // Convert SVG coordinates → PDF coordinates using the transformation parameters
    const pdfX = imgX + (bbox.x - vbX) * scaleX;
    const pdfY = imgY + (bbox.y - vbY) * scaleY;
    const pdfW = bbox.width * scaleX;
    const pdfH = bbox.height * scaleY;
    console.log(`📍 ${room.name}: Vector coordinate mapping`, {
      elementType,
      svgCoords: { x: bbox.x.toFixed(1), y: bbox.y.toFixed(1), w: bbox.width.toFixed(1), h: bbox.height.toFixed(1) },
      viewBox: { x: vbX, y: vbY },
      scale: { x: scaleX.toFixed(3), y: scaleY.toFixed(3) },
      pdfCoords: { x: pdfX.toFixed(2), y: pdfY.toFixed(2), w: pdfW.toFixed(2), h: pdfH.toFixed(2) }
    });
    return { pdfX, pdfY, pdfW, pdfH };
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