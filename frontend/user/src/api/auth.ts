import { api } from "./client";
import type { AuthUser } from "../types";

export async function login(email: string, password: string) {
  const { data } = await api.post<{ token: string; user: AuthUser }>("/auth/login", {
    email,
    password,
  });
  return data;
}

export async function register(email: string, password: string, fullName: string) {
  const { data } = await api.post<{ token: string; user: AuthUser }>("/auth/register", {
    email,
    password,
    fullName,
  });
  return data;
}

export async function fetchMe() {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}
