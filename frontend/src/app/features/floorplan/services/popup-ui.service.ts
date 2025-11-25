import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { ElementRef, QueryList } from '@angular/core';

export interface PopupPosition {
  x: number;
  y: number;
  show: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PopupUiService {
  openPopupFromRoom(
    room: Room,
    clickEvent: MouseEvent | undefined,
    svgHosts: QueryList<ElementRef<HTMLDivElement>> | undefined,
    svgObjects: QueryList<ElementRef<HTMLObjectElement>> | undefined,
    panelContainer: ElementRef<HTMLDivElement> | undefined,
    findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null,
    findRoomElementInDoc: (doc: Document, room: Room) => Element | null,
    getSvgViewBox: (rootSvg: SVGSVGElement) => { x: number; y: number; w: number; h: number } | null,
    setPopupState: (show: boolean, x: number, y: number, selectedRoom: Room) => void
  ): void {
    const position = this.calculatePopupPosition(
      room,
      clickEvent,
      svgHosts,
      svgObjects,
      panelContainer,
      findRoomElementInline,
      findRoomElementInDoc,
      getSvgViewBox
    );

    if (position && position.show) {
      setPopupState(true, position.x, position.y, room);
    } else {
      // Fallback: use click event position if available
      if (clickEvent) {
        const containerRect = panelContainer?.nativeElement?.getBoundingClientRect();
        let popupX: number;
        let popupY: number;
        if (containerRect) {
          popupX = clickEvent.clientX - containerRect.left + 15;
          popupY = clickEvent.clientY - containerRect.top - 30;
        } else {
          popupX = clickEvent.clientX + 15;
          popupY = clickEvent.clientY - 30;
        }
        setPopupState(true, popupX, popupY, room);
      } else {
        // Center fallback
        const containerRect = panelContainer?.nativeElement?.getBoundingClientRect();
        let popupX: number;
        let popupY: number;
        if (containerRect) {
          popupX = Math.max(16, containerRect.width / 2 - 130);
          popupY = Math.max(16, containerRect.height / 2 - 100);
        } else {
          popupX = Math.max(16, window.innerWidth / 2 - 130);
          popupY = Math.max(16, window.innerHeight / 2 - 100);
        }
        setPopupState(true, popupX, popupY, room);
      }
    }
  }

  calculatePopupPosition(
    room: Room,
    clickEvent: MouseEvent | undefined,
    svgHosts: QueryList<ElementRef<HTMLDivElement>> | undefined,
    svgObjects: QueryList<ElementRef<HTMLObjectElement>> | undefined,
    panelContainer: ElementRef<HTMLDivElement> | undefined,
    findRoomElementInline: (rootSvg: SVGSVGElement, room: Room) => Element | null,
    findRoomElementInDoc: (doc: Document, room: Room) => Element | null,
    getSvgViewBox: (rootSvg: SVGSVGElement) => { x: number; y: number; w: number; h: number } | null
  ): PopupPosition | null {
    let positioned = false;
    let popupX = 0;
    let popupY = 0;

    // Try inline SVG hosts first
    if (svgHosts && svgHosts.length > 0) {
      svgHosts.forEach(hostRef => {
        if (positioned) return;
        const hostEl = hostRef.nativeElement as HTMLDivElement;
        const rootSvg = hostEl.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) return;

        const viewBoxAttr = rootSvg.getAttribute('viewBox');
        if (!viewBoxAttr) return;
        const [vbX, vbY, vbW, vbH] = viewBoxAttr.split(/\s+/).map(Number);
        if ([vbX, vbY, vbW, vbH].some(n => Number.isNaN(n))) return;

        const el = findRoomElementInline(rootSvg, room) as any;
        if (!el || !el.getBBox) return;

        const bbox = el.getBBox();
        const hostRect = hostEl.getBoundingClientRect();
        const scaleX = hostRect.width / vbW;
        const scaleY = hostRect.height / vbH;

        const roomRightX = bbox.x + bbox.width;
        const roomCenterY = bbox.y + bbox.height / 2;
        let screenX = hostRect.left + (roomRightX - vbX) * scaleX + 10;
        let screenY = hostRect.top + (roomCenterY - vbY) * scaleY;

        const containerEl = panelContainer?.nativeElement;
        const containerRect = containerEl?.getBoundingClientRect();
        let popupXInline = screenX;
        let popupYInline = screenY - 10;
        if (containerRect && containerEl) {
          popupXInline = screenX - containerRect.left + (containerEl.scrollLeft || 0);
          popupYInline = screenY - containerRect.top + (containerEl.scrollTop || 0) - 10;
        }

        const popupWidthInline = 192;
        const popupHeightInline = 120;
        if (containerRect) {
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          if (popupXInline + popupWidthInline > containerWidth) popupXInline = containerWidth - popupWidthInline - 10;
          if (popupXInline < 0) popupXInline = 10;
          if (popupYInline < 0) popupYInline = 10;
          if (popupYInline + popupHeightInline > containerHeight) popupYInline = containerHeight - popupHeightInline - 10;
        }

        popupX = Math.max(0, popupXInline);
        popupY = Math.max(0, popupYInline);
        positioned = true;
      });
    }

    if (positioned) {
      return { x: popupX, y: popupY, show: true };
    }

    // Try SVG objects
    if (svgObjects) {
      for (const ref of svgObjects.toArray()) {
        if (positioned) break;
        const objectEl = ref.nativeElement as HTMLObjectElement;
        const doc = objectEl.contentDocument as Document | null;
        if (!doc) continue;
        const rootSvg = doc.querySelector('svg') as SVGSVGElement | null;
        if (!rootSvg) continue;
        const viewBox = getSvgViewBox(rootSvg);
        if (!viewBox) continue;
        const el = findRoomElementInDoc(doc, room) as any;
        if (!el || !el.getBBox) continue;

        const bbox = el.getBBox();
        const objectRect = objectEl.getBoundingClientRect();
        const scaleX = objectRect.width / viewBox.w;
        const scaleY = objectRect.height / viewBox.h;

        const roomCenterX = bbox.x + bbox.width / 2;
        const roomCenterY = bbox.y + bbox.height / 2;
        const screenX = objectRect.left + (roomCenterX - viewBox.x) * scaleX;
        const screenY = objectRect.top + (roomCenterY - viewBox.y) * scaleY;

        let calculatedX = screenX + bbox.width * scaleX / 2 + 10;
        let calculatedY = screenY - 10;

        const containerRect = panelContainer?.nativeElement?.getBoundingClientRect();
        if (containerRect) {
          calculatedX = calculatedX - containerRect.left;
          calculatedY = calculatedY - containerRect.top;
        }

        const popupWidth = 192;
        const popupHeight = 120;
        if (containerRect) {
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          if (calculatedX + popupWidth > containerWidth) calculatedX = containerWidth - popupWidth - 10;
          if (calculatedX < 0) calculatedX = 10;
          if (calculatedY < 0) calculatedY = 10;
          if (calculatedY + popupHeight > containerHeight) calculatedY = containerHeight - popupHeight - 10;
        }

        popupX = Math.max(0, calculatedX);
        popupY = Math.max(0, calculatedY);
        positioned = true;
      }
    }

    if (positioned) {
      return { x: popupX, y: popupY, show: true };
    }

    // Fallback to center
    return {
      x: Math.max(16, window.innerWidth / 2 - 130),
      y: Math.max(16, window.innerHeight / 2 - 100),
      show: true
    };
  }
}

