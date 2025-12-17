import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';

@Injectable({
  providedIn: 'root'
})
export class SvgColorService {
  updateSvgColors(
    svgDoc: Document,
    rooms: Room[],
    filteredRooms: Room[],
    selectedStartDate: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    filtersStatus: string,
    toStatusUnion: (status: string) => 'Available' | 'Occupied',
    getPaxColor: (capacity: number) => string,
  ): void {
    // 🔍 DEBUG: Log when updateSvgColors is called

    let elementsFound = 0;
    let elementsColored = 0;

    rooms.forEach((room) => {
      const el = svgDoc.getElementById(room.id);
      if (el) {
        elementsFound++;
        if (filteredRooms.includes(room)) {
          const avail = selectedStartDate ? availabilityByRoomId.get(room.id) : undefined;
          let effectiveStatus: 'Occupied' | 'Available';
          if (avail !== undefined) {
            // ✅ FIX: When date is selected, ALWAYS use date-based availability
            // Don't check room.status - that's today's status, not the selected date
            effectiveStatus = (avail === 'free') ? 'Available' : 'Occupied';
          } else {
            // No date selected OR no availability data - use room's base status
            effectiveStatus = toStatusUnion(room.status);
          }

          // 🔍 DEBUG: Log color decision for first 3 rooms
          const debugThis = elementsFound <= 3;
          if (debugThis) {
          }

          let color: string;
          if (effectiveStatus === 'Occupied') {
            color = '#ef4444';
          } else if (filtersStatus === 'Available') {
            // ✅ Apply pax colors when status filter is "Available" (works with OR without date)
            color = getPaxColor(room.capacity);
            elementsColored++;
          } else {
            color = '#22c55e';
            elementsColored++;
          }

          el.setAttribute('fill', color);
          el.setAttribute('opacity', '0.7');
          (el as any).style.pointerEvents = 'auto';
        }
        (el as any).style.cursor = 'pointer';
      }
    });

    // 🔍 DEBUG: Summary
  }

  updateSvgColorsInline(
    rootSvg: SVGSVGElement,
    rooms: Room[],
    filteredRooms: Room[],
    selectedStartDate: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    filtersStatus: string,
    toStatusUnion: (status: string) => 'Available' | 'Occupied',
    getPaxColor: (capacity: number) => string,
    findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null
  ): void {
    // 🔍 DEBUG: Log when updateSvgColorsInline is called

    let elementsFound = 0;
    let elementsColored = 0;

    rooms.forEach(room => {
      const el = findRoomElementInline(rootSvg, room);
      if (!el) {
        // 🔍 DEBUG: Log ALL missing elements for UBP3A debugging
        return;
      }
      elementsFound++;

      const containerTag = (el.closest('defs,clipPath,mask') as Element | null)?.tagName?.toLowerCase();
      if (containerTag) return;

      const isSelected = filteredRooms.includes(room);
      let color = '#FFFFFF'; // Light gray for unselected rooms (instead of 'none')

      // 🔍 DEBUG: Log filtering status
      if (!isSelected && elementsFound <= 5) {
      }

      if (isSelected) {
        const avail = selectedStartDate ? availabilityByRoomId.get(room.id) : undefined;
        let effectiveStatus: 'Occupied' | 'Available';
        if (avail !== undefined) {
          // ✅ FIX: When date is selected, ALWAYS use date-based availability
          // Don't check room.status - that's today's status, not the selected date
          effectiveStatus = (avail === 'free') ? 'Available' : 'Occupied';
        } else {
          // No date selected OR no availability data - use room's base status
          effectiveStatus = toStatusUnion(room.status);
        }

        // 🔍 DEBUG: Enhanced logging for UBP3A

        if (effectiveStatus === 'Occupied') {
          color = '#ef4444';
        } else if (filtersStatus === 'Available') {
          // ✅ Apply pax colors when status filter is "Available" (works with OR without date)
          color = getPaxColor(room.capacity);
          elementsColored++;
        } else {
          color = '#22c55e';
          elementsColored++;
        }
      }

      const tag = el.tagName.toLowerCase();
      (el as HTMLElement).style.setProperty('fill', color, 'important');
      (el as HTMLElement).style.setProperty('pointer-events', 'auto', 'important');
      el.setAttribute('opacity', isSelected ? '0.7' : '0.35');

      if (tag === 'line' || tag === 'polyline') {
        (el as HTMLElement).style.setProperty('stroke', color, 'important');
        if (color !== 'none') el.setAttribute('stroke-width', '2');
      }

      if (tag === 'use') {
        const href = (el as any).getAttribute('href') || (el as any).getAttribute('xlink:href');
        if (href && href.startsWith('#')) {
          const ref = rootSvg.querySelector(href) as HTMLElement | null;
          if (ref) {
            ref.style.setProperty('fill', color, 'important');
            ref.style.setProperty('pointer-events', 'auto', 'important');
          }
        }
      }

      (el as HTMLElement).style.cursor = 'pointer';
    });

    // 🔍 DEBUG: Summary of color updates
  }

  /**
   * Apply colors to SVG for PDF export using attributes (not CSS)
   * This ensures colors persist through cloneNode() for svg2pdf
   */
  applySvgColorsForPdfExport(
    rootSvg: SVGSVGElement,
    rooms: Room[],
    filteredRooms: Room[],
    selectedStartDate: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    filtersStatus: string,
    toStatusUnion: (status: string) => 'Available' | 'Occupied',
    getPaxColor: (capacity: number) => string,
    findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null
  ): void {

    let elementsFound = 0;
    let elementsColored = 0;

    rooms.forEach(room => {
      const el = findRoomElementInline(rootSvg, room);
      if (!el) return;

      const containerTag = (el.closest('defs,clipPath,mask') as Element | null)?.tagName?.toLowerCase();
      if (containerTag) return;

      elementsFound++;

      const isSelected = filteredRooms.includes(room);
      let color = '#FFFFFF'; // Gray for unselected

      if (isSelected) {
        const avail = selectedStartDate ? availabilityByRoomId.get(room.id) : undefined;
        let effectiveStatus: 'Occupied' | 'Available';

        if (avail !== undefined) {
          effectiveStatus = (avail === 'free') ? 'Available' : 'Occupied';
        } else {
          effectiveStatus = toStatusUnion(room.status);
        }

        if (effectiveStatus === 'Occupied') {
          color = '#ef4444'; // Red
        } else if (filtersStatus === 'Available') {
          color = getPaxColor(room.capacity); // Pax colors
          elementsColored++;
        } else {
          color = '#22c55e'; // Green
          elementsColored++;
        }
      }

      const tag = el.tagName.toLowerCase();

      // Use setAttribute instead of style.setProperty
      el.setAttribute('fill', color);
      el.setAttribute('opacity', isSelected ? '0.7' : '0.35');

      if (tag === 'line' || tag === 'polyline') {
        el.setAttribute('stroke', color);
        if (color !== 'none') el.setAttribute('stroke-width', '2');
      }

      if (tag === 'use') {
        const href = (el as any).getAttribute('href') || (el as any).getAttribute('xlink:href');
        if (href && href.startsWith('#')) {
          const ref = rootSvg.querySelector(href) as HTMLElement | null;
          if (ref) {
            ref.setAttribute('fill', color);
          }
        }
      }
    });

  }
}

