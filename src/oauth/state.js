// OAuth `state` handling shared by every provider: random, expiring (10 min),
// single-use, and bound to the signed-in browser session that started the flow.
import crypto from "crypto";

const TTL_MS = 10 * 60 * 1000;
const store = new Map(); // state -> { platform, sid, verifier, exp }

export const b64url = (buf) => buf.toString("base64url");

export function createState(platform, sid, withPkce = false) {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp < now) store.delete(k);

  const state = b64url(crypto.randomBytes(24));
  const entry = { platform, sid, exp: now + TTL_MS };
  let challenge;
  if (withPkce) {
    entry.verifier = b64url(crypto.randomBytes(32));
    challenge = b64url(crypto.createHash("sha256").update(entry.verifier).digest());
  }
  store.set(state, entry);
  return { state, challenge };
}

/** Consumes the state (single use). Throws unless it is valid for this platform + session. */
export function consumeState(state, platform, sid) {
  const entry = typeof state === "string" ? store.get(state) : null;
  if (entry) store.delete(state);
  if (!entry || entry.exp < Date.now() || entry.platform !== platform || entry.sid !== sid) {
    throw new Error("Login session expired or invalid. Start the connection again from the Accounts tab.");
  }
  return entry;
}
