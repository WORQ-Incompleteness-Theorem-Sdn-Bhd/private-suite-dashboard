export interface Room {
  id: string;
  name: string;
  status: string;
  outlet: string;
  capacity: number;
  type: string;
  area: number;
  price: number;
  deposit: number;
  svg: string[]; // SVG path(s) for the room
  suite?: string;
  pax?: any;
  video?: string;
  videoEmbed?: string; // Converted YouTube embed URL
  floor_id?: string; // Floor ID from backend
  originalStatus?: string; // Original status from backend for date features
  availableFrom?: string; // Available date for available_soon status
}
//data type