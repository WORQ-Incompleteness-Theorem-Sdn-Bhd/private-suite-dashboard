import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import lottie from 'lottie-web';

@Component({
  selector: 'app-lottie-loading',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col items-center justify-center p-8 bg-white rounded-xl">
      <div #lottieContainer [style.width]="width" [style.height]="height"></div>
      <p *ngIf="showText" class="mt-4 text-sm text-gray-600">{{ loadingText }}</p>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class LottieLoadingComponent implements AfterViewInit, OnDestroy {
  @ViewChild('lottieContainer', { static: true }) lottieContainer!: ElementRef;
  
  @Input() width: string = '200px';
  @Input() height: string = '200px';
  @Input() showText: boolean = true;
  @Input() loadingText: string = 'Loading...';

  private animation: any;

  ngAfterViewInit(): void {
    this.loadAnimation();
  }

  ngOnDestroy(): void {
    if (this.animation) {
      this.animation.destroy();
    }
  }

  private loadAnimation(): void {
    try {
      this.animation = lottie.loadAnimation({
        container: this.lottieContainer.nativeElement,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://lottie.host/e8ab1a29-ceaf-47b0-a96c-0adc5f97cfbb/kjq1NzcFmP.lottie'
      });
    } catch (error) {
      console.error('Error loading Lottie animation:', error);
    }
  }
}
