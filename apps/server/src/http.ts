/** Tiny HTTP helpers. Errors follow the spec 03 shape: { error: { code, message } }. */

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function apiError(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

export const unauthorized = () =>
  apiError("unauthorized", "Missing or invalid bearer token.", 401);

export const notFound = (message = "Not found.") =>
  apiError("not_found", message, 404);

export const badRequest = (message: string) =>
  apiError("bad_request", message, 400);

export const conflict = (message: string) =>
  apiError("conflict", message, 409);

export const serverError = (message = "Internal error.") =>
  apiError("internal_error", message, 500);
