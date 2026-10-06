/** Error carrying an intended HTTP status for API routes. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return String(e);
}
