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
}

