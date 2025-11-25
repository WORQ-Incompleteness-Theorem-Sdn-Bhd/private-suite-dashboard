import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';

@Injectable({
  providedIn: 'root'
})
export class YoutubeLinksService {
  openYouTubeLink(room: Room): void {
    const youtubeUrl = this.getYouTubeWatchUrlFor(room);
    if (youtubeUrl) {
      window.open(youtubeUrl, '_blank', 'noopener,noreferrer');
    } else {
      console.warn('No valid YouTube URL found for room:', room.name);
    }
  }

  getYouTubeWatchUrlFor(room: Room | null | undefined): string | null {
    if (!room?.video) return null;
    return this.toYouTubeWatch(room.video.trim());
  }

  getRoomsWithYouTubeLinks(rooms: Room[]): Room[] {
    return rooms.filter(room => room.video && room.video.trim() !== '');
  }

  getYouTubeLinkCount(rooms: Room[]): number {
    return this.getRoomsWithYouTubeLinks(rooms).length;
  }

  private toYouTubeWatch(raw: string): string | null {
    if (!raw) return null;
    try {
      const u = new URL(raw);

      if (u.hostname.includes('youtu.be')) {
        const id = u.pathname.replace('/', '');
        return id ? `https://www.youtube.com/watch?v=${id}` : null;
      }

      if (u.hostname.includes('youtube.com')) {
        if (u.pathname.startsWith('/embed/')) {
          const id = u.pathname.split('/')[2];
          return id ? `https://www.youtube.com/watch?v=${id}` : null;
        }
        if (u.pathname === '/watch') {
          const id = u.searchParams.get('v');
          return id ? `https://www.youtube.com/watch?v=${id}` : null;
        }
      }

      return raw;
    } catch {
      return raw;
    }
  }
}

