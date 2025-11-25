import { Injectable, NgZone } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { QueryList, ElementRef } from '@angular/core';
import * as FloorplanUtils from './floorplan-utils';

@Injectable({
  providedIn: 'root'
})
export class SvgEventsService {
  private clickTimer: any = null;
  private clickCount = 0;
  private lastClickedRoom: Room | null = null;
  private readonly DOUBLE_CLICK_DELAY = 300; // milliseconds

  constructor(private ngZone: NgZone) {}

  /**
   * Handle room click with single/double-click detection
   * Single click: Opens popup
   * Double click: Selects the suite
   */
  private handleRoomClick(
    room: Room,
    event: MouseEvent,
    openPopupFromRoom: (room: Room, event?: MouseEvent) => void,
    onSuiteSelect?: (room: Room) => void
  ): void {
    // Check if this is the same room as last click
    if (this.lastClickedRoom === room) {
      this.clickCount++;
    } else {
      this.clickCount = 1;
      this.lastClickedRoom = room;
    }

    // Clear existing timer
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
    }

    // If double-click detected
    if (this.clickCount === 2) {
      this.clickCount = 0;
      this.lastClickedRoom = null;
      // Execute suite selection
      if (onSuiteSelect) {
        onSuiteSelect(room);
      }
    } else {
      // Wait for potential second click
      this.clickTimer = setTimeout(() => {
        // Single click - open popup
        openPopupFromRoom(room, event);
        this.clickCount = 0;
        this.lastClickedRoom = null;
      }, this.DOUBLE_CLICK_DELAY);
    }
  }

  /**
   * Check if an SVG element is actually colored (has a fill that's not 'none')
   * This ensures popups only work for visually colored elements, especially when pax legend is visible
   */
  private isElementColored(el: Element | null): boolean {
    if (!el) return false;

    try {
      // Check computed style fill (most reliable for SVG)
      const computedStyle = window.getComputedStyle(el as HTMLElement);
      const computedFill = computedStyle.fill || computedStyle.getPropertyValue('fill');

      // Check attribute fill
      const attrFill = el.getAttribute('fill');

      // Check inline style fill (this is how colors are set in updateSvgColorsInline)
      const styleFill = (el as HTMLElement).style?.fill || (el as HTMLElement).style?.getPropertyValue('fill');

      // Get the actual fill value (prefer style, then computed, then attribute)
      // Style fill is most reliable since we set it with setProperty('fill', color, 'important')
      const fillValue = styleFill || computedFill || attrFill || '';

      // Element is colored if fill is set and not 'none', 'transparent', or empty
      // RGB colors like 'rgb(198, 69, 26)' are valid colors
      const hasValidFill = fillValue !== 'none' &&
                          fillValue !== 'transparent' &&
                          fillValue !== '' &&
                          fillValue !== 'rgba(0, 0, 0, 0)' &&
                          !fillValue.startsWith('url('); // Exclude patterns/gradients

      // Check opacity - colored elements should have opacity >= 0.5
      // Uncolored elements have opacity 0.35, colored have 0.7
      const opacity = parseFloat(computedStyle.opacity || el.getAttribute('opacity') || '1');

      // Element is colored if it has a valid fill AND sufficient opacity
      return hasValidFill && opacity >= 0.5;
    } catch (e) {
      // If we can't determine, allow it (filteredRooms check will handle it)
      return true;
    }
  }

  attachRoomListeners(
    svgDoc: Document,
    rooms: Room[],
    roomIdIndex: Map<string, Room>,
    normalizeId: (value: string | undefined | null) => string,
    openPopupFromRoom: (room: Room, event?: MouseEvent) => void,
    closePopup: () => void,
    filteredRooms: Room[] = [],
    onSuiteSelect?: (room: Room) => void
  ): void {
    const handleClick = (event: MouseEvent) => {
      let target = event.target as Element | null;
      const root = svgDoc.documentElement as Element | null;
      let matched = false;
      while (target && target !== root) {
        const el = target as HTMLElement;
        let candidate =
          el.id ||
          el.getAttribute?.('data-id') ||
          el.getAttribute?.('data-room') ||
          '';
        if (!candidate) {
          const href =
            el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
          if (href && href.startsWith('#')) candidate = href.slice(1);
        }
        if (candidate) {
          const normalized = normalizeId(candidate);
          const room = roomIdIndex.get(normalized);
          if (room) {
            // Only open popup if the room is in filteredRooms (i.e., colored)
            // If room is in filteredRooms, it means it passed all filters and should be colored
            if (filteredRooms.includes(room)) {
              this.handleRoomClick(room, event, openPopupFromRoom, onSuiteSelect);
              matched = true;
              return;
            }
          }
        }
        target = target.parentNode as Element | null;
      }
      if (!matched) {
        closePopup();
      }
    };

    const marker = '__ps_click_bound__';
    if (!(svgDoc as any)[marker]) {
      svgDoc.addEventListener('click', (ev: Event) =>
        this.ngZone.run(() => handleClick(ev as MouseEvent))
      );
      (svgDoc as any)[marker] = true;
    }

    rooms.forEach((room) => {
      const el = FloorplanUtils.findRoomElementInDoc(svgDoc, room) as HTMLElement | null;
      if (!el) return;
      (el as any).style.cursor = 'pointer';
      (el as any).style.pointerEvents = 'auto';
      const handlerKey = '__ps_room_handler__';

      // Remove old listener if it exists
      if ((el as any)[handlerKey]) {
        el.removeEventListener('click', (el as any)[handlerKey]);
      }

      // Create new listener with current filteredRooms
      const handler = (ev: MouseEvent) =>
        this.ngZone.run(() => {
          ev.preventDefault();
          ev.stopPropagation();
          // Only open popup if the room is in filteredRooms (i.e., colored)
          // If room is in filteredRooms, it means it passed all filters and should be colored
          if (filteredRooms.includes(room)) {
            this.handleRoomClick(room, ev, openPopupFromRoom, onSuiteSelect);
          }
        });

      el.addEventListener('click', handler);
      (el as any)[handlerKey] = handler;
      (el as any).__ps_room_bound__ = true;
    });
  }

  attachRoomListenersInline(
    rootSvg: SVGSVGElement,
    rooms: Room[],
    roomIdIndex: Map<string, Room>,
    normalizeId: (value: string | undefined | null) => string,
    openPopupFromRoom: (room: Room, event?: MouseEvent) => void,
    closePopup: () => void,
    findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null,
    filteredRooms: Room[] = [],
    onSuiteSelect?: (room: Room) => void
  ): void {
    if ((rootSvg as any).__ps_click_bound__) {
      rootSvg.removeEventListener('click', (rootSvg as any).__ps_click_handler);
    }

    const handleClick = (event: MouseEvent) => {
      let target = event.target as Element | null;
      const root = rootSvg as Element;
      let matched = false;

      while (target && target !== root) {
        const el = target as HTMLElement;
        let candidate = el.id || el.getAttribute?.('data-id') || el.getAttribute?.('data-room') || '';

        if (!candidate) {
          const href = el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
          if (href && href.startsWith('#')) candidate = href.slice(1);
        }

        if (candidate) {
          const normalized = normalizeId(candidate);
          const room = roomIdIndex.get(normalized);
          if (room) {
            // Only open popup if the room is in filteredRooms (i.e., colored)
            // If room is in filteredRooms, it means it passed all filters and should be colored
            if (filteredRooms.includes(room)) {
              this.handleRoomClick(room, event, openPopupFromRoom, onSuiteSelect);
              matched = true;
              return;
            }
          } else {
            const roomByOriginal = roomIdIndex.get(candidate);
            if (roomByOriginal) {
              // Only open popup if the room is in filteredRooms (i.e., colored)
              // If room is in filteredRooms, it means it passed all filters and should be colored
              if (filteredRooms.includes(roomByOriginal)) {
                this.handleRoomClick(roomByOriginal, event, openPopupFromRoom, onSuiteSelect);
                matched = true;
                return;
              }
            }
          }
        }
        target = target.parentElement;
      }

      if (!matched) {
        closePopup();
      }
    };

    (rootSvg as any).__ps_click_handler = (ev: Event) => this.ngZone.run(() => handleClick(ev as MouseEvent));
    rootSvg.addEventListener('click', (rootSvg as any).__ps_click_handler);
    (rootSvg as any).__ps_click_bound__ = true;

    rooms.forEach((room) => {
      const el = findRoomElementInline(rootSvg, room) as HTMLElement | null;
      if (!el) {
        return;
      }
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      const handlerKey = '__ps_room_handler__';

      // Remove old listener if it exists
      if ((el as any)[handlerKey]) {
        el.removeEventListener('click', (el as any)[handlerKey]);
      }

      // Create new listener with current filteredRooms
      const handler = (ev: MouseEvent) =>
        this.ngZone.run(() => {
          ev.preventDefault();
          ev.stopPropagation();
          // Only open popup if the room is in filteredRooms (i.e., colored)
          // If room is in filteredRooms, it means it passed all filters and should be colored
          if (filteredRooms.includes(room)) {
            this.handleRoomClick(room, ev, openPopupFromRoom, onSuiteSelect);
          }
        });

      el.addEventListener('click', handler);
      (el as any)[handlerKey] = handler;
      (el as any).__ps_room_bound__ = true;
    });
  }
}

