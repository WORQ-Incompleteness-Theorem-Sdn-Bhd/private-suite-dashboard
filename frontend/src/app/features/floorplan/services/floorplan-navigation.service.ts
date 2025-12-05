import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FloorplanNavigationService {
  setupKeyboardNavigation(
    previousFloorplan: () => void,
    nextFloorplan: () => void,
    goToFloorplan: (index: number) => void,
    totalFloorplans: number
  ): void {
    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          previousFloorplan();
          break;
        case 'ArrowRight':
          event.preventDefault();
          nextFloorplan();
          break;
        case 'Home':
          event.preventDefault();
          goToFloorplan(0);
          break;
        case 'End':
          event.preventDefault();
          goToFloorplan(totalFloorplans - 1);
          break;
      }
    });
  }

  /**
   * Automatically switch to the floorplan that contains the most filtered rooms
   * This helps users see the relevant floorplan when they apply filters
   *
   * @param filteredRooms Rooms that match current filters
   * @param displayedSvgs Array of SVG URLs being displayed
   * @param currentFloorplanIndex Current floorplan index
   * @param extractFloorId Function to extract floor_id from URL
   * @returns The best floorplan index to switch to, or null if no switch needed
   */
  calculateBestFloorplanIndex<T extends { floor_id?: string }>(
    filteredRooms: T[],
    displayedSvgs: string[],
    currentFloorplanIndex: number,
    extractFloorId: (url: string) => string | null
  ): number | null {
    if (!filteredRooms || filteredRooms.length === 0) {
      return null;
    }

    if (!displayedSvgs || displayedSvgs.length === 0) {
      return null;
    }

    // Group filtered rooms by floor_id
    const roomsByFloorId = new Map<string, T[]>();
    filteredRooms.forEach(room => {
      if (room.floor_id) {
        if (!roomsByFloorId.has(room.floor_id)) {
          roomsByFloorId.set(room.floor_id, []);
        }
        roomsByFloorId.get(room.floor_id)!.push(room);
      }
    });

    if (roomsByFloorId.size === 0) {
      return null;
    }

    // Find which floorplan URL corresponds to each floor_id
    const floorplanScores = new Map<number, number>(); // index -> room count

    displayedSvgs.forEach((url, index) => {
      const floorId = extractFloorId(url);
      if (floorId && roomsByFloorId.has(floorId)) {
        const roomCount = roomsByFloorId.get(floorId)!.length;
        floorplanScores.set(index, roomCount);
      }
    });

    if (floorplanScores.size === 0) {
      return null;
    }

    // Find the floorplan with the most filtered rooms
    let bestIndex = -1;
    let maxRooms = 0;

    floorplanScores.forEach((roomCount, index) => {
      if (roomCount > maxRooms) {
        maxRooms = roomCount;
        bestIndex = index;
      }
    });

    // Only return the new index if it's different from current
    if (bestIndex >= 0 && bestIndex !== currentFloorplanIndex) {
      return bestIndex;
    }

    return null;
  }
}

