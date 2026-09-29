/** Shared helpers for Vercel API routes (Supabase project + auth). */

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function supabaseUrl() {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function serviceKey() {
  return env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
}

function anonKey() {
  return env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
}

async function sbFetch(path, opts = {}) {
  const base = supabaseUrl();
  const key = serviceKey();
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY não configurados");
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.msg)) || res.statusText || ("HTTP " + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function authPasswordGrant(email, password) {
  const base = supabaseUrl();
  const key = anonKey();
  if (!base || !key) throw new Error("SUPABASE_URL / ANON key não configurados");
  const res = await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.msg || data.message || "Login inválido");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function authGetUser(accessToken) {
  const base = supabaseUrl();
  const key = anonKey();
  const res = await fetch(base + "/auth/v1/user", {
    headers: {
      apikey: key,
      Authorization: "Bearer " + accessToken
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Sessão inválida");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getProfile(userId) {
  const rows = await sbFetch("/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=*&limit=1", {
    prefer: "return=representation"
  });
  return (rows && rows[0]) || null;
}

function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

async function requireUser(req, roles) {
  const token = bearer(req);
  if (!token) {
    const err = new Error("Não autenticado");
    err.status = 401;
    throw err;
  }
  const user = await authGetUser(token);
  const profile = await getProfile(user.id);
  if (!profile) {
    const err = new Error("Perfil não encontrado");
    err.status = 403;
    throw err;
  }
  if (roles && roles.length && !roles.includes(profile.role)) {
    const err = new Error("Sem permissão");
    err.status = 403;
    throw err;
  }
  return { user, profile, token };
}

function cors(res, methods = "GET, POST, PUT, PATCH, DELETE, OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function readBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; }
  }
  return req.body || {};
}

module.exports = {
  env,
  supabaseUrl,
  serviceKey,
  anonKey,
  sbFetch,
  authPasswordGrant,
  authGetUser,
  getProfile,
  bearer,
  requireUser,
  cors,
  readBody
};
