/**
 * YouTube utility functions for extracting video IDs from URLs
 */

/**
 * Extracts YouTube video ID from various YouTube URL formats
 * @param url - YouTube URL (can be null/undefined)
 * @returns 11-character YouTube video ID or null if not found/invalid
 */
export function extractYoutubeId(url?: string | null): string | null {
  if (!url) return null;
  
  // Match various YouTube URL formats:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/embed/VIDEO_ID
  // - https://youtube.com/watch?v=VIDEO_ID
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  
  return match ? match[1] : null;
}
