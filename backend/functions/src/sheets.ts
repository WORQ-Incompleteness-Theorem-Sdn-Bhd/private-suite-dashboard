/**
 * Google Sheets integration for YouTube URL enrichment
 */

import { google } from 'googleapis';

// Cache configuration
interface SheetCacheEntry {
  data: Record<string, { youtube_url: string; updated_at?: string }>;
  timestamp: number;
}

let sheetCache: SheetCacheEntry | null = null;

/**
 * Loads YouTube URLs from Google Sheets and caches them
 * @returns Promise resolving to a map of resource_id -> { youtube_url, updated_at }
 */
export async function loadSheetMap(): Promise<Record<string, { youtube_url: string; updated_at?: string }>> {
  const sheetId = process.env.SHEET_ID;
  const sheetRange = process.env.SHEET_RANGE || 'A:B';
  const cacheTtlMs = parseInt(process.env.SHEETS_CACHE_TTL_MS || '600000', 10); // 10 minutes default

  if (!sheetId) {
    console.warn('[loadSheetMap] SHEET_ID not configured, skipping YouTube enrichment');
    return {};
  }

  // Check cache validity
  const now = Date.now();
  if (sheetCache && (now - sheetCache.timestamp) < cacheTtlMs) {
    console.log('[loadSheetMap] Using cached sheet data');
    return sheetCache.data;
  }

  try {
    console.log('[loadSheetMap] Loading fresh sheet data from Google Sheets');
    
    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Fetch data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetRange,
    });

    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      console.warn('[loadSheetMap] No data found in sheet');
      return {};
    }

    // Build the map from sheet data
    const map: Record<string, { youtube_url: string; updated_at?: string }> = {};
    
    // Skip header row if it exists (assume first row might be headers)
    const dataRows = rows.slice(1);
    
    for (const row of dataRows) {
      if (!row || row.length < 2) continue;
      
      const resourceId = String(row[0] || '').trim();
      const youtubeUrl = String(row[1] || '').trim();
      const updatedAt = row[2] ? String(row[2]).trim() : undefined;
      
      if (resourceId && youtubeUrl) {
        // Try both original and trimmed resource_id for safety
        map[resourceId] = { youtube_url: youtubeUrl, updated_at: updatedAt };
        map[resourceId.trim()] = { youtube_url: youtubeUrl, updated_at: updatedAt };
      }
    }

    // Update cache
    sheetCache = {
      data: map,
      timestamp: now,
    };

    console.log(`[loadSheetMap] Loaded ${Object.keys(map).length} YouTube URLs from sheet`);
    return map;

  } catch (error: any) {
    console.error('[loadSheetMap] Error loading sheet data:', error.message);
    
    // Return cached data if available, even if expired
    if (sheetCache) {
      console.log('[loadSheetMap] Returning stale cached data due to error');
      return sheetCache.data;
    }
    
    return {};
  }
}

/**
 * Clears the sheet cache, forcing a reload on next request
 */
export function clearSheetCache(): void {
  sheetCache = null;
  console.log('[loadSheetMap] Sheet cache cleared');
}

/**
 * Gets cache status for debugging
 */
export function getCacheStatus(): { cached: boolean; age?: number; entryCount?: number } {
  if (!sheetCache) {
    return { cached: false };
  }
  
  return {
    cached: true,
    age: Date.now() - sheetCache.timestamp,
    entryCount: Object.keys(sheetCache.data).length,
  };
}
