export class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function sendError(res, error) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : "SERVER_ERROR";
  const message = error instanceof AppError ? error.message : "Something went wrong. Please try again.";

  const payload = {
    success: false,
    error: { code, message },
  };
  if (error instanceof AppError && error.details) payload.details = error.details;
  return res.status(statusCode).json(payload);
}
