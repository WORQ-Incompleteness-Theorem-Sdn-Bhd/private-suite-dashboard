import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-youtube-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Modal Backdrop -->
    <div 
      *ngIf="isOpen" 
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
      (click)="closeModal()"
    >
      <!-- Modal Content -->
      <div 
        class="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden"
        (click)="$event.stopPropagation()"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ roomName }} - Virtual Tour
          </h3>
          <button 
            (click)="closeModal()"
            class="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-4">
          <!-- YouTube Video Embed -->
          <div class="relative w-full" style="padding-bottom: 56.25%; height: 0;">
            <iframe 
              *ngIf="embedUrl"
              [src]="embedUrl"
              class="absolute top-0 left-0 w-full h-full rounded-lg"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              title="YouTube video player"
            ></iframe>
          </div>

          <!-- Video Info -->
          <div class="mt-4 p-3 bg-gray-50 rounded-lg">
            <div class="flex items-center gap-2 text-sm text-gray-600">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              <span>Virtual Tour Video</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">
              Click the video to watch in full screen or 
              <a [href]="originalUrl" target="_blank" class="text-blue-600 hover:underline">
                open in YouTube
              </a>
            </p>
            <div class="mt-2 text-xs text-gray-400">
              💡 Tip: Use the fullscreen button in the video player for the best viewing experience
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button 
            (click)="closeModal()"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
          >
            Close
          </button>
          <a 
            *ngIf="originalUrl"
            [href]="originalUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Open in YouTube
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    
    /* Responsive video container */
    @media (max-width: 768px) {
      .max-w-4xl {
        max-width: 95vw;
      }
    }
    
    /* Smooth transitions */
    .transition-colors {
      transition: all 0.2s ease-in-out;
    }
    
    /* Focus styles for accessibility */
    button:focus {
      outline: 2px solid #f97316;
      outline-offset: 2px;
    }
  `]
})
export class YoutubeModalComponent {
  @Input() isOpen = false;
  @Input() videoUrl: string | null = null;
  @Input() roomName: string = '';
  @Output() close = new EventEmitter<void>();

  get embedUrl(): string | null {
    if (!this.videoUrl) return null;
    return this.convertToEmbedUrl(this.videoUrl);
  }

  get originalUrl(): string | null {
    return this.videoUrl;
  }

  closeModal(): void {
    this.close.emit();
  }

  private convertToEmbedUrl(url: string): string | null {
    if (!url) return null;

    // Extract video ID from various YouTube URL formats
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;

    return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;
  }

  private extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }
}
