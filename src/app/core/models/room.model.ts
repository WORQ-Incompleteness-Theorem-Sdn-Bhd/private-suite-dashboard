export interface Room {
  id: string;
  name: string;
  status: string;
  outlet: string;
  capacity: any;
  type?: string;
  area?: number;
  price?: number;
  deposit?: number;
}
