export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Build an ApiError from a non-2xx response. Backend bodies: `{detail: {code, message}}` or `{detail: "text"}`. */
export async function toApiError(res: Response): Promise<ApiError> {
  const fallback = `API error: ${res.status}`;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return new ApiError(res.status, fallback);
  }
  const detail = isRecord(body) ? body.detail : undefined;
  if (isRecord(detail)) {
    const message = typeof detail.message === "string" ? detail.message : fallback;
    const code = typeof detail.code === "string" ? detail.code : null;
    return new ApiError(res.status, message, code);
  }
  if (typeof detail === "string" && detail !== "") {
    return new ApiError(res.status, detail);
  }
  return new ApiError(res.status, fallback);
}
