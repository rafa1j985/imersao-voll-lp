/**
 * POST /api/agenda/photo
 * Upload de foto do consultor (base64).
 * Admin: qualquer consultant_id. Consultor: só o próprio.
 * Body: { consultant_id?, data_base64, content_type? }
 */
const { cors, readBody, sbFetch, requireUser, supabaseUrl, serviceKey } = require("../_lib");

async function ensureBucket() {
  const base = supabaseUrl();
  const key = serviceKey();
  const res = await fetch(base + "/storage/v1/bucket", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: "consultant-photos",
      name: "consultant-photos",
      public: true,
      file_size_limit: 2_000_000,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"]
    })
  });
  // 200 created or 409 already exists are fine
  if (!res.ok && res.status !== 409) {
    const t = await res.text();
    // ignore if already exists message
    if (!/already|exists|duplicate/i.test(t)) {
      console.warn("bucket create", res.status, t);
    }
  }
}

module.exports = async function handler(req, res) {
  cors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { profile } = await requireUser(req, ["admin", "consultant"]);
    const body = readBody(req);
    let consultantId = String(body.consultant_id || "").trim();
    if (profile.role === "consultant") consultantId = profile.consultant_id;
    if (!consultantId) return res.status(400).json({ ok: false, error: "consultant_id obrigatório" });

    const raw = String(body.data_base64 || "");
    const m = raw.match(/^data:([^;]+);base64,(.+)$/) || [null, body.content_type || "image/jpeg", raw];
    const contentType = (m[1] || "image/jpeg").split(";")[0].trim();
    const b64 = m[2] || "";
    if (!b64 || b64.length < 32) return res.status(400).json({ ok: false, error: "imagem inválida" });

    const path = consultantId + "/avatar.jpg";
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 2_000_000) return res.status(400).json({ ok: false, error: "imagem até 2MB" });

    await ensureBucket();
    const base = supabaseUrl();
    const key = serviceKey();
    const up = await fetch(base + "/storage/v1/object/consultant-photos/" + path, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": contentType || "image/jpeg",
        "x-upsert": "true"
      },
      body: buf
    });
    if (!up.ok) {
      const t = await up.text();
      throw Object.assign(new Error(t || "Falha no upload"), { status: up.status });
    }

    const photoUrl = base + "/storage/v1/object/public/consultant-photos/" + path + "?t=" + Date.now();
    try {
      await sbFetch("/rest/v1/consultants?id=eq." + encodeURIComponent(consultantId), {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ photo_url: photoUrl })
      });
    } catch (e) {
      console.warn("photo_url patch", e.message);
    }

    return res.status(200).json({ ok: true, photo_url: photoUrl, consultant_id: consultantId });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
