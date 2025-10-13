export interface Floor {
  floor_id: string;
  floor_no: string;
  floor_name: string;
  extraction_date: string;
  location_id?: string; // Location ID to filter floors by outlet
}

export interface FloorResponse {
  data: Floor[];
  success: boolean;
}
