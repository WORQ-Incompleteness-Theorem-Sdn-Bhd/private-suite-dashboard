export interface Floor {
  floor_id: string;
  floor_no: string;
  floor_name: string;
  extraction_date: string;
}

export interface FloorResponse {
  data: Floor[];
  success: boolean;
}
