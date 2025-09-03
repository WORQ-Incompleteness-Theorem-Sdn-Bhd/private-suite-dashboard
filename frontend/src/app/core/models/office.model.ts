export interface Office {
  id: string;
  name: string;
  displayName: string;
  svg: string | string[];
  floor?: string;
}

export interface OfficeResponse {
  data: Office[];
  success: boolean;
  message?: string;
}
