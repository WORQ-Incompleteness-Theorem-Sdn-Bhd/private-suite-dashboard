import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, ToastMessage } from '../services/toast.service';
import { Observable, Subscription } from 'rxjs';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-4 right-4 z-50 space-y-2">
      <div
        *ngFor="let toast of toasts$ | async"
        class="flex items-center p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ease-in-out"
        [class]="getToastClasses(toast.type)"
        (click)="removeToast(toast.id)"
      >
        <div class="flex items-center">
          <span class="mr-2 text-lg">{{ getToastIcon(toast.type) }}</span>
          <span class="text-sm font-medium">{{ toast.message }}</span>
        </div>
        <button
          class="ml-2 text-lg font-bold opacity-70 hover:opacity-100"
          (click)="removeToast(toast.id); $event.stopPropagation()"
        >
          ×
        </button>
      </div>
    </div>
  `,
  styles: [`
    .toast-enter {
      transform: translateX(100%);
      opacity: 0;
    }
    .toast-enter-active {
      transform: translateX(0);
      opacity: 1;
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

  getToastClasses(type: ToastMessage['type']): string {
    const baseClasses = 'cursor-pointer';
    switch (type) {
      case 'success':
        return `${baseClasses} bg-green-100 text-green-800 border border-green-200`;
      case 'error':
        return `${baseClasses} bg-red-100 text-red-800 border border-red-200`;
      case 'warning':
        return `${baseClasses} bg-yellow-100 text-yellow-800 border border-yellow-200`;
      case 'info':
      default:
        return `${baseClasses} bg-blue-100 text-blue-800 border border-blue-200`;
    }
  }

  getToastIcon(type: ToastMessage['type']): string {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  }

  removeToast(id: string): void {
    this.toastService.remove(id);
  }
}
