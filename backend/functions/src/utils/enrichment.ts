/**
 * Data enrichment utilities for merging BigQuery and Google Sheets data //seek advice later
 */

import { extractYoutubeId } from './youtube';
import { loadSheetMap } from '../sheets';

// Type definition for BigQuery resource rows
export type ResourceRow = {
  extraction_date: string;
  resource_id: string;
  resource_type: string;
  resource_name: string;
  price: number | null;
  deposit: number | null;
  resource_number: string | null;
  pax_size: number | null;
  area_in_sqmm: number | null;
  status: string | null;
  office_id: string | null;
  floor_id: string | null;
  available_from: string | null;
  available_until: string | null;
  youtube_link: string | null;
};

// Enriched resource row with YouTube data
export type EnrichedResourceRow = ResourceRow & {
  youtube_link: string | null;
  youtube_id: string | null;
  youtube_source: 'bigquery' | 'sheets' | null;
};

/**
 * Enriches resource rows with YouTube data from Google Sheets
 * @param rows - Array of resource rows from BigQuery
 * @returns Promise resolving to enriched resource rows
 */
export async function enrichWithYoutube(rows: ResourceRow[]): Promise<EnrichedResourceRow[]> {
  try {
    // Load the sheet map
    const sheetMap = await loadSheetMap();
    
    // Enrich each row
    return rows.map((row) => {
      const resourceId = row.resource_id;
      const bqYoutubeLink = row.youtube_link;
      
      // Try to find sheet data for this resource (try both original and trimmed ID)
      const sheetData = sheetMap[resourceId] || sheetMap[resourceId?.trim()];
      const sheetYoutubeUrl = sheetData?.youtube_url || null;
      
      // Apply merging rule: prefer BigQuery, fallback to Sheets
      const finalUrl = bqYoutubeLink ?? sheetYoutubeUrl ?? null;
      
      // Determine source
      let youtubeSource: 'bigquery' | 'sheets' | null = null;
      if (bqYoutubeLink) {
        youtubeSource = 'bigquery';
      } else if (sheetYoutubeUrl) {
        youtubeSource = 'sheets';
      }
      
      // Extract YouTube ID
      const youtubeId = extractYoutubeId(finalUrl);
      
      return {
        ...row,
        youtube_link: finalUrl,
        youtube_id: youtubeId,
        youtube_source: youtubeSource,
      };
    });
    
  } catch (error: any) {
    console.error('[enrichWithYoutube] Error during enrichment:', error.message);
    
    // Return original rows with null YouTube data if enrichment fails
    return rows.map((row) => ({
      ...row,
      youtube_link: row.youtube_link,
      youtube_id: extractYoutubeId(row.youtube_link),
      youtube_source: row.youtube_link ? 'bigquery' : null,
    }));
  }
}
