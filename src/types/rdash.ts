// Standard rDash response envelope.
export interface ApiResponse<T> {
  code: number;
  message: string;
  success: boolean;
  data: T;
  errors: Record<string, string> | null;
}

// GET /v2/vendors item (Swagger: id, name, code). `id` is decoded to an
// integer-string at the server boundary.
export interface RdashVendor {
  id: string;
  name: string;
  code: string;
}
