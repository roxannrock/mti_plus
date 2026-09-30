import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    // The first issue is the most useful thing to show; messages are Russian
    // (z.config in app.ts, or custom messages given in the schema).
    res.status(400).json({ error: err.issues[0]?.message ?? "Некорректные данные запроса.", details: err.flatten() });
    return;
  }
  // update/delete on a row that doesn't exist (or was deleted concurrently)
  // is a client error, not a server fault.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Запись не найдена." });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: "Запись с такими данными уже существует." });
      return;
    }
    // Foreign key violation: the referenced row was deleted concurrently
    // (e.g. an attempt started while the test was being deleted), or a row
    // that others still reference is being removed.
    if (err.code === "P2003") {
      res.status(409).json({ error: "Операция невозможна: связанная запись удалена или ещё используется." });
      return;
    }
  }
  // Errors raised by Express itself and body-parser (malformed JSON, body too
  // large, undecodable URL, …) carry a 4xx status — those are client errors,
  // not crashes, so answer in Russian and don't log a stack trace.
  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== null) {
    res.status(clientStatus).json({ error: clientErrorMessage(err, clientStatus) });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера." });
}

function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const code = typeof status === "number" ? status : statusCode;
  return typeof code === "number" && code >= 400 && code < 500 ? code : null;
}

const BODY_ERROR_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Некорректный JSON в теле запроса.",
  "entity.too.large": "Слишком большой запрос.",
  "encoding.unsupported": "Неподдерживаемая кодировка запроса.",
  "charset.unsupported": "Неподдерживаемая кодировка запроса.",
  "request.aborted": "Запрос прерван.",
  "request.size.invalid": "Некорректный размер запроса.",
  "parameters.too.many": "Слишком много параметров в запросе.",
};

function clientErrorMessage(err: unknown, status: number): string {
  const type = (err as { type?: unknown }).type;
  if (typeof type === "string" && BODY_ERROR_MESSAGES[type]) return BODY_ERROR_MESSAGES[type];
  if (status === 413) return "Слишком большой запрос.";
  if (status === 415) return "Неподдерживаемый формат запроса.";
  if (status === 404) return "Не найдено.";
  return "Некорректный запрос.";
}

export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<void>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
