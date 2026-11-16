// Startup validation. Imported first in server.js so a misconfigured instance
// refuses to run instead of silently falling back to insecure defaults.
const problems = [];

const secret = process.env.APP_SECRET || "";
if (!secret || ["change-me", "dev-secret"].includes(secret) || secret.length < 32) {
  problems.push(
    "APP_SECRET must be a random string of at least 32 characters.\n" +
      "    Generate one:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

const password = process.env.OWNER_PASSWORD || "";
if (password.length < 12) {
  problems.push("OWNER_PASSWORD must be set (at least 12 characters). It is the login for the dashboard.");
}

let base;
try {
  base = new URL(process.env.PUBLIC_BASE_URL || "");
} catch {
  problems.push("PUBLIC_BASE_URL must be a valid URL, e.g. https://curb.yourdomain.com");
}
const isLocal = base && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
if (base && base.protocol !== "https:" && !isLocal) {
  problems.push("PUBLIC_BASE_URL must use https:// unless it points at localhost (sessions and OAuth tokens would travel in clear text).");
}

if (problems.length) {
  console.error("\nCurb cannot start — fix these in .env:\n");
  for (const p of problems) console.error("  • " + p + "\n");
  process.exit(1);
}

export const config = {
  publicBaseUrl: base.origin,
  secureCookies: base.protocol === "https:",
  isLocal,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT) || 3000,
};
