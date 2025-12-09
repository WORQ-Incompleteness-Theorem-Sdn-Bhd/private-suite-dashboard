import { Injectable } from '@angular/core';
import { Room } from '../../../core/models/room.model';
import { AvailabilityService } from './availability.service';

export interface PaxBucket {
  max: number;
  label: string;
}

@Injectable({
  providedIn: 'root'
})
export class ColorPaxService {
  // Pax capacity color palette - Gradient from light to vibrant Available green
  // Largest pax uses full Available green (#22c55e), smaller pax use lighter opacity versions
  // Creates clear visual differentiation: larger capacity = more vibrant/saturated green
  readonly paxPalette = [
    'rgba(34, 197, 94, 0.3)',  // Smallest (2-4 pax) - 30% opacity: very light green
    'rgba(34, 197, 94, 0.45)', // 5-6 pax - 45% opacity: light green
    'rgba(34, 197, 94, 0.60)', // 7-8 pax - 60% opacity: medium-light green
    'rgba(34, 197, 94, 0.75)', // 9-12 pax - 75% opacity: medium green
    'rgba(34, 197, 94, 0.90)', // 13-20 pax - 90% opacity: strong green
    'rgba(34, 197, 94, 1.0)'   // Largest (21+ pax) - 100% opacity: full Available green #22c55e
  ] as const;
  readonly paxBuckets: PaxBucket[] = [
    { max: 5, label: '2-4' },
    { max: 7, label: '5–6' },
    { max: 9, label: '7–8' },
    { max: 13, label: '9–12' },
    { max: 21, label: '13–20' },
    { max: Infinity, label: '21+' },
  ];

  // Cache for dynamic buckets per outlet
  private dynamicBucketsCache: Map<string, { buckets: PaxBucket[], colorMap: Map<number, string> }> = new Map();

  constructor(private availabilityService: AvailabilityService) {}

  /**
   * Builds dynamic pax buckets based on actual room capacities in the outlet
   */
  buildDynamicBuckets(rooms: Room[]): { buckets: PaxBucket[], colorMap: Map<number, string> } {
    // Get unique pax values from rooms, sorted
    const uniquePax = Array.from(new Set(rooms.map(r => r.capacity)))
      .filter(pax => pax > 0)
      .sort((a, b) => a - b);

    if (uniquePax.length === 0) {
      // Fallback to default buckets if no rooms
      const colorMap = new Map<number, string>();
      this.paxBuckets.forEach((bucket, index) => {
        colorMap.set(bucket.max, this.paxPalette[index]);
      });
      return { buckets: this.paxBuckets, colorMap };
    }

    const buckets: PaxBucket[] = [];
    const colorMap = new Map<number, string>();

    const numColors = this.paxPalette.length;

    if (uniquePax.length <= numColors) {
      // Use each unique pax as a bucket
      uniquePax.forEach((pax, index) => {
        const colorIndex = Math.min(index, numColors - 1);
        let label: string;
        if (uniquePax.length === 1) {
          label = `${pax}`;
        } else if (index === 0) {
          label = `2-${pax}`;
        } else if (index === uniquePax.length - 1) {
          const prevPax = uniquePax[index - 1];
          label = `${prevPax + 1}+`;
        } else {
          const prevPax = uniquePax[index - 1];
          label = `${prevPax + 1}-${pax}`;
        }
        buckets.push({ max: pax, label });
        colorMap.set(pax, this.paxPalette[colorIndex]);
      });
    } else {
      // Too many unique pax values, group them into at most 6 buckets
      const groupSize = Math.ceil(uniquePax.length / numColors);
      for (let colorIndex = 0; colorIndex < numColors; colorIndex++) {
        const startIndex = colorIndex * groupSize;
        const group = uniquePax.slice(startIndex, startIndex + groupSize);
        if (group.length === 0) break;
        const maxPax = group[group.length - 1];
        const minPax = group[0];
        let label: string;
        if (colorIndex === 0) {
          label = `2-${maxPax}`;
        } else if (colorIndex === numColors - 1 || startIndex + groupSize >= uniquePax.length) {
          const prevMax = buckets[buckets.length - 1]?.max ?? minPax;
          label = `${prevMax + 1}+`;
        } else {
          const prevMax = buckets[buckets.length - 1]?.max ?? (minPax - 1);
          label = `${prevMax + 1}-${maxPax}`;
        }
        buckets.push({ max: maxPax, label });
        colorMap.set(maxPax, this.paxPalette[colorIndex]);
      }
    }

    return { buckets, colorMap };
  }

  /**
   * Get color for a capacity using dynamic buckets based on rooms
   */
  getPaxColor(capacity: number, rooms?: Room[]): string {
    // If rooms provided, use dynamic buckets
    if (rooms && rooms.length > 0) {
      // Create cache key from sorted unique capacities
      const uniqueCapacities = Array.from(new Set(rooms.map(r => r.capacity)))
        .filter(c => c > 0)
        .sort((a, b) => a - b)
        .join(',');
      
      let cached = this.dynamicBucketsCache.get(uniqueCapacities);
      
      if (!cached) {
        cached = this.buildDynamicBuckets(rooms);
        this.dynamicBucketsCache.set(uniqueCapacities, cached);
      }

      // Find the bucket this capacity belongs to
      // Buckets are ordered by max value, find the first one where capacity <= max
      const sortedBuckets = cached.buckets.sort((a, b) => a.max - b.max);
      for (const bucket of sortedBuckets) {
        if (capacity <= bucket.max) {
          // Get the color for this bucket's max value
          return cached.colorMap.get(bucket.max) || this.paxPalette[this.paxPalette.length - 1];
        }
      }
      
      // If capacity exceeds all buckets, use the darkest color (last bucket)
      const lastBucket = sortedBuckets[sortedBuckets.length - 1];
      return cached.colorMap.get(lastBucket.max) || this.paxPalette[this.paxPalette.length - 1];
    }

    // Fallback to fixed buckets for backward compatibility
    for (let i = 0; i < this.paxBuckets.length; i++) {
      if (capacity <= this.paxBuckets[i].max) {
        return this.paxPalette[i];
      }
    }
    return this.paxPalette[this.paxPalette.length - 1];
  }

  /**
   * Get dynamic buckets for rooms (used for legend)
   */
  getDynamicBucketsForRooms(rooms: Room[]): PaxBucket[] {
    const { buckets } = this.buildDynamicBuckets(rooms);
    return buckets;
  }

  getDynamicPaxLegend(
    filteredRooms: Room[],
    filtersStatus: string,
    selectedStartDate: string,
    availabilityByRoomId: Map<string, 'free' | 'occupied'>,
    allRooms?: Room[] // All rooms for the outlet to get pax groups
  ): Array<{ label: string, color: string }> {
    const legend: Array<{ label: string, color: string }> = [];

    // Only show legend if user has selected "Available" status
    if (filtersStatus !== 'Available') {
      return legend;
    }

    // Use all rooms for the outlet to get pax groups, or fallback to filtered rooms
    const roomsForPaxGroups = allRooms && allRooms.length > 0 ? allRooms : filteredRooms;

    // Get unique pax sizes from the outlet's rooms (from backend /resources)
    const uniquePaxSizes = Array.from(new Set(roomsForPaxGroups.map(r => r.capacity)))
      .filter(pax => pax > 0)
      .sort((a, b) => a - b);

    if (uniquePaxSizes.length === 0) {
      return legend;
    }

    // Get available rooms' pax sizes for filtering
    const availablePaxSizes = new Set<number>();
    filteredRooms.forEach(room => {
      if (this.availabilityService.getEffectiveStatus(room, selectedStartDate, availabilityByRoomId) === 'Available') {
        availablePaxSizes.add(room.capacity);
      }
    });

    // Build dynamic buckets based on outlet's pax groups
    const { buckets, colorMap } = this.buildDynamicBuckets(roomsForPaxGroups);

    // Only show buckets that have at least one available room
    const sortedBuckets = [...buckets].sort((a, b) => a.max - b.max);
    sortedBuckets.forEach((bucket, index) => {
      const color = colorMap.get(bucket.max);
      if (!color) return;

      const lowerBound = index === 0 ? Number.NEGATIVE_INFINITY : sortedBuckets[index - 1].max;
      const upperBound = bucket.max;

      const hasAvailableRooms = Array.from(availablePaxSizes).some((pax) => {
        if (upperBound === Infinity) {
          return pax > lowerBound;
        }
        if (index === 0 && lowerBound === Number.NEGATIVE_INFINITY) {
          return pax <= upperBound;
        }
        return pax > lowerBound && pax <= upperBound;
      });

      if (hasAvailableRooms) {
        legend.push({
          label: bucket.label,
          color,
        });
      }
    });

    return legend;
  }

  hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    const result = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 10),
        g: parseInt(result[2], 10),
        b: parseInt(result[3], 10)
      };
    }

    const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (hexResult) {
      return {
        r: parseInt(hexResult[1], 16),
        g: parseInt(hexResult[2], 16),
        b: parseInt(hexResult[3], 16)
      };
    }

    return null;
  }
}

