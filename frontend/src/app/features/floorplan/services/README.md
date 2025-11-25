# Floorplan Services

This directory contains services extracted from `floorplan.component.ts` to improve code organization and maintainability.

## Services Created

### 1. `dropdown-filter.service.ts`
Handles all dropdown and filter-related functionality:
- `getOptionValue()`, `getOptionLabel()` - Option formatting
- `buildOptions()` - Builds filter options based on current filters
- `applyFilters()` - Applies filters to room list
- `getOfficeIdFromOutletName()` - Office ID lookup

### 2. `color-pax.service.ts`
Manages pax-based color logic:
- `paxPalette` - Color palette array
- `paxBuckets` - Capacity buckets configuration
- `getPaxColor()` - Get color for a capacity
- `getDynamicPaxLegend()` - Build dynamic legend
- `hexToRgb()` - Color conversion utility

### 3. `svg-loader.service.ts`
Handles SVG loading and fetching:
- `normalizeUrlKey()` - URL normalization
- `getSafeUrl()` - Safe URL caching
- `detectSvgSource()` - Detect SVG source type
- `updateSelectedOutletSvgs()` - Load outlet SVGs
- `loadInlineSvgs()` - Load SVGs inline
- `processSvgForCompactDisplay()` - Process SVG for display

### 4. `availability.service.ts`
Manages date-based availability:
- `fetchAvailabilityForCurrentSelection()` - Fetch availability data
- `getStatusDisplayText()` - Format status text
- `toStatusUnion()` - Status normalization
- `isRoomUnavailable()` - Check room availability

### 5. `svg-color.service.ts`
Handles SVG coloring:
- `updateSvgColors()` - Update colors in SVG document
- `updateSvgColorsInline()` - Update colors in inline SVG

### 6. `popup-ui.service.ts`
Manages popup positioning:
- `calculatePopupPosition()` - Calculate popup position for a room

### 7. `youtube-links.service.ts`
Handles YouTube link functionality:
- `openYouTubeLink()` - Open YouTube link
- `getYouTubeWatchUrlFor()` - Get YouTube watch URL
- `getRoomsWithYouTubeLinks()` - Get rooms with videos
- `getYouTubeLinkCount()` - Get count of rooms with videos

### 8. `floorplan-navigation.service.ts`
Handles keyboard navigation:
- `setupKeyboardNavigation()` - Setup keyboard event listeners

### 9. `floorplan-utils.ts`
Utility functions (not a service, just exported functions):
- `getFloorLabel()` - Get floor label from path
- `basename()` - Get basename from path
- `normalizeId()` - Normalize ID string
- `buildRoomIdIndex()` - Build room ID index map
- `findRoomElementInDoc()` - Find room element in document
- `findRoomElementInline()` - Find room element in inline SVG
- `getSvgViewBox()` - Get SVG viewBox
- `isIOSDevice()` - Check if iOS device
- `downloadBlob()` - Download blob utility

## Integration Notes

The component (`floorplan.component.ts`) needs to be refactored to:
1. Inject these services in the constructor
2. Replace direct method calls with service method calls
3. Pass necessary state/data to service methods
4. Keep component-specific logic (lifecycle hooks, template bindings) in the component

## PDF Export Service

The PDF export functionality is very complex (~300+ lines) and tightly coupled to:
- Component DOM elements (`svgHosts`, `panelContainer`)
- Component state (`filteredRooms`, `rooms`, `filters`, `selectedSuites`, etc.)
- Multiple dependencies (jsPDF, html2canvas)

**Recommendation**: Keep PDF export methods in the component for now, or create a service that accepts all necessary data as parameters. The current structure makes it difficult to extract without significant refactoring.

