import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, ToastMessage } from '../services/toast.service';
import { Observable, Subscription } from 'rxjs';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
      <div
        *ngFor="let toast of toasts$ | async"
        class="pointer-events-auto flex items-center p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ease-in-out"
        [class]="getToastClasses(toast.type, toast.message)"
        [class.toast-centered]="isWelcomeMessage(toast.message)"
        (click)="removeToast(toast.id)"
      >
        <div class="flex items-center gap-3">
          <span class="text-2xl">{{ getToastIcon(toast.type, toast.message) }}</span>
          <span class="text-sm font-medium">{{ toast.message }}</span>
        </div>
        <!-- <button
          class="ml-4 text-lg font-bold opacity-70 hover:opacity-100"
          (click)="removeToast(toast.id); $event.stopPropagation()"
        >
          ×
        </button> -->
      </div>
    </div>
  `,
  styles: [`
    /* Custom animation for the Welcome Toast */
    .toast-centered {
      position: fixed !important;
      top: 10% !important;      /* FIX: Moves it to vertical middle */
      left: 50% !important;     /* Moves it to horizontal middle */
      right: auto !important;
      transform: translate(-50%, -50%) !important; /* Centers it perfectly */
      z-index: 9999 !important; /* Ensures it sits on top of everything */
      min-width: 300px;
      animation: welcomePop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    }
    
    @keyframes welcomePop {
      0% {
        opacity: 0;
        transform: translate(-50%, -10%) scale(0.9);
      }
      100% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
    }
  `]
})
export class ToastComponent implements OnInit, OnDestroy {
  toasts$: Observable<ToastMessage[]>;
  private subscription: Subscription = new Subscription();

  constructor(private toastService: ToastService) {
    this.toasts$ = this.toastService.toasts$;
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  getToastClasses(type: ToastMessage['type'], message: string): string {
    const baseClasses = 'cursor-pointer border-l-4';
    
    // Special styling for welcome messages
    if (this.isWelcomeMessage(message)) {
      // White background, Orange border, large text
      return `${baseClasses} bg-white text-gray-800 border-orange-500 flex-col items-center justify-center gap-2 p-8 text-center`;
    }
    
    // Standard Toast Styling
    switch (type) {
      case 'success':
        return `${baseClasses} bg-white text-gray-800 border-green-500`;
      case 'error':
        return `${baseClasses} bg-white text-gray-800 border-red-500`;
      case 'warning':
        return `${baseClasses} bg-white text-gray-800 border-yellow-500`;
      case 'info':
      default:
        return `${baseClasses} bg-white text-gray-800 border-blue-500`;
    }
  }

  getToastIcon(type: ToastMessage['type'], message: string): string {
    if (this.isWelcomeMessage(message)) {
      return '👋'; // Waving hand for welcome
    }
    
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': default: return 'ℹ️';
    }
  }

  removeToast(id: string): void {
    this.toastService.remove(id);
  }

  isWelcomeMessage(message: string): boolean {
    // Check for "Welcome" AND "Floorplan" to be safe
    return message.toLowerCase().includes('welcome') && 
           message.toLowerCase().includes('floorplan');
  }
}