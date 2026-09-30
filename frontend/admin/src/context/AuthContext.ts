import { createAuth } from "@mti/shared";
import { api, SESSION_KEYS } from "../api/client";

export const { AuthProvider, useAuth, ProtectedRoute } = createAuth({
  api,
  ...SESSION_KEYS,
  requiredRole: { role: "ADMIN", message: "Этот аккаунт не является админским." },
});
