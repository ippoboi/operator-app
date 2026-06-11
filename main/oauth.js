"use strict";
/* System-browser OAuth with a throwaway 127.0.0.1 loopback listener.
   Google uses PKCE; both providers exchange/refresh with bare fetch. */
const http = require("http");
const crypto = require("crypto");
const { shell } = require("electron");

const TIMEOUT_MS = 3 * 60 * 1000;

function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

/* spin up the listener first so the redirect_uri port is known */
function awaitCode(expectedState) {
  let resolveCode, rejectCode;
  const code = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
    const ok = u.searchParams.get("code") && u.searchParams.get("state") === expectedState;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body style=\"font-family:sans-serif;background:#0b0c0e;color:#e7e9ec;padding:40px\"><p>" +
      (ok ? "Operator connected — you can close this tab." : "Connection failed — return to Operator and retry.") +
      "</p></body></html>");
    if (ok) resolveCode(u.searchParams.get("code"));
    else rejectCode(new Error(u.searchParams.get("error") || "OAuth state mismatch"));
    setImmediate(() => server.close());
  });
  const timer = setTimeout(() => { server.close(); rejectCode(new Error("OAuth timed out — no browser response in 3 minutes")); }, TIMEOUT_MS);
  code.finally(() => clearTimeout(timer)).catch(() => {});
  return new Promise(res => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, code })));
}

async function tokenPost(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + "): " + (data.error_description || data.error || data.message || ""));
  return data;
}

function withExpiry(t) { return Object.assign({}, t, { expiresAt: Date.now() + ((t.expires_in || 3600) - 60) * 1000 }); }

async function connectGoogle(creds) {
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const { port, code } = await awaitCode(state);
  const redirect = "http://127.0.0.1:" + port + "/callback";
  shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirect, response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline", prompt: "consent",
    code_challenge: challenge, code_challenge_method: "S256", state,
  }));
  const c = await code;
  return withExpiry(await tokenPost("https://oauth2.googleapis.com/token", {
    code: c, client_id: creds.clientId, client_secret: creds.clientSecret,
    redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier,
  }));
}

async function refreshGoogle(creds, refreshToken) {
  const t = await tokenPost("https://oauth2.googleapis.com/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  });
  return withExpiry(Object.assign({ refresh_token: refreshToken }, t));
}

async function connectStrava(creds) {
  const state = b64url(crypto.randomBytes(16));
  const { port, code } = await awaitCode(state);
  const redirect = "http://127.0.0.1:" + port + "/callback";
  shell.openExternal("https://www.strava.com/oauth/authorize?" + new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirect, response_type: "code",
    scope: "activity:read_all", approval_prompt: "auto", state,
  }));
  const c = await code;
  return withExpiry(await tokenPost("https://www.strava.com/oauth/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret, code: c, grant_type: "authorization_code",
  }));
}

async function refreshStrava(creds, refreshToken) {
  /* Strava rotates refresh tokens — the response carries the new one */
  return withExpiry(await tokenPost("https://www.strava.com/oauth/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  }));
}

module.exports = { connectGoogle, connectStrava, refreshGoogle, refreshStrava };
