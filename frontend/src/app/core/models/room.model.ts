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
}
//data type