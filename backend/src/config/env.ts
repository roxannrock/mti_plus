import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  PORT: z.coerce.number().default(4000),
  // Interface to listen on. Default 127.0.0.1 everywhere: in production the
  // API is reached only through Nginx, and if :4000 were open to the world
  // anyone could send a forged X-Forwarded-For and dodge the login limiter.
  // Set HOST=0.0.0.0 only if you really need the API on other interfaces.
  HOST: z.string().min(1).default("127.0.0.1"),
  // Express "trust proxy": how many reverse-proxy hops to believe in
  // X-Forwarded-For. Default: 1 in production (Nginx), off in development.
  // "true" (trust everything) is refused — it makes req.ip client-controlled.
  TRUST_PROXY: z.string().trim().optional(),
  CORS_ORIGINS: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

function resolveTrustProxy(raw: string | undefined): number | string | false {
  if (raw === undefined || raw === "") return isProduction ? 1 : false;
  if (/^\d+$/.test(raw)) return Number(raw) === 0 ? false : Number(raw);
  if (raw === "false") return false;
  if (raw === "true") {
    console.error(
      'Invalid environment configuration: TRUST_PROXY="true" would trust any X-Forwarded-For sent by the client. ' +
        "Use the number of proxy hops (1 for a single Nginx) or a subnet list instead.",
    );
    process.exit(1);
  }
  // Anything else is handed to Express as-is: "loopback", "10.0.0.0/8, ::1", …
  return raw;
}

export const trustProxy = resolveTrustProxy(env.TRUST_PROXY);

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// In production an empty list would mean "no browser may call the API" at
// best, or a silent allow-all if someone later loosens the check — fail
// loudly at startup instead.
if (isProduction && corsOrigins.length === 0) {
  console.error(
    "Invalid environment configuration: CORS_ORIGINS is required when NODE_ENV=production " +
      '(comma-separated list, e.g. CORS_ORIGINS="https://admin.example.com,https://exam.example.com").',
  );
  process.exit(1);
}
