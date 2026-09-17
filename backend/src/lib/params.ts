import type { Request } from "express";
import { HttpError } from "../middleware/errorHandler";

// Express types route params as `string | string[] | undefined` (repeated
// path segments can capture arrays). Every route here only ever uses single
// named segments, so this normalizes to a plain required string.
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `Отсутствует параметр маршрута: ${name}`);
  }
  return value;
}
