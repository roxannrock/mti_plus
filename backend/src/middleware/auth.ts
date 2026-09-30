import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";

export interface AuthPayload {
  userId: string;
  role: "ADMIN" | "STUDENT";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

// Async on purpose: the token only proves who the user *was* when it was
// signed. Re-reading the user on every request means a deleted account or a
// changed role (or a password reset) takes effect immediately instead of when the token expires.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Требуется авторизация." });
    return;
  }

  const token = header.slice("Bearer ".length);
  // tv = the user's tokenVersion at login; tokens signed before tv existed
  // count as version 0 (the column default).
  let payload: AuthPayload & { tv?: unknown };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload & { tv?: unknown };
  } catch {
    res.status(401).json({ error: "Недействительный или истёкший токен." });
    return;
  }

  try {
    const user = typeof payload.userId === "string"
      ? await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, role: true, tokenVersion: true } })
      : null;
    if (!user) {
      res.status(401).json({ error: "Пользователь не найден. Войдите снова." });
      return;
    }
    // A password reset bumps tokenVersion, which ends every session issued
    // before it.
    const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;
    if (tokenVersion !== user.tokenVersion) {
      res.status(401).json({ error: "Сессия устарела. Войдите снова." });
      return;
    }
    req.auth = { userId: user.id, role: user.role };
  } catch (err) {
    next(err);
    return;
  }
  next();
}

export function requireRole(role: AuthPayload["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      res.status(403).json({ error: "Недостаточно прав." });
      return;
    }
    next();
  };
}
