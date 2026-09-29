/**
 * GET  /api/agenda/consultants — lista (público: ativos; admin: todos)
 * POST /api/agenda/consultants — admin cria
 * PATCH /api/agenda/consultants — admin qualquer; consultor só o próprio (name, note, photo_url)
 */
const { cors, readBody, sbFetch, requireUser, bearer } = require("../_lib");

module.exports = async function handler(req, res) {
  cors(res, "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      let isAdmin = false;
      if (bearer(req)) {
        try {
          const auth = await requireUser(req, ["admin", "consultant"]);
          isAdmin = auth.profile.role === "admin";
        } catch (_) {}
      }
      const q = isAdmin
        ? "/rest/v1/consultants?select=*&order=name"
        : "/rest/v1/consultants?active=eq.true&select=id,name,note,photo_url&order=name";
      let rows;
      try {
        rows = await sbFetch(q);
      } catch (e) {
        // fallback se photo_url ainda não existe
        const q2 = isAdmin
          ? "/rest/v1/consultants?select=id,name,active,note,created_at&order=name"
          : "/rest/v1/consultants?active=eq.true&select=id,name,note&order=name";
        rows = await sbFetch(q2);
      }
      const base = require("../_lib").supabaseUrl();
      const consultants = (rows || []).map((c) => ({
        ...c,
        photo_url: c.photo_url || (base + "/storage/v1/object/public/consultant-photos/" + c.id + "/avatar.jpg")
      }));
      return res.status(200).json({ ok: true, consultants });
    }

    if (req.method === "POST") {
      await requireUser(req, ["admin"]);
      const body = readBody(req);
      const name = String(body.name || "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "name obrigatório" });
      const rows = await sbFetch("/rest/v1/consultants", {
        method: "POST",
        body: JSON.stringify([{ name, note: String(body.note || ""), active: true }])
      });
      return res.status(200).json({ ok: true, consultant: rows && rows[0] });
    }

    if (req.method === "PATCH") {
      const { profile } = await requireUser(req, ["admin", "consultant"]);
      const body = readBody(req);
      let id = String(body.id || "").trim();
      if (profile.role === "consultant") {
        id = profile.consultant_id;
        if (!id) return res.status(403).json({ ok: false, error: "Consultor sem vínculo" });
      }
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });

      const patch = {};
      if (body.name != null) patch.name = String(body.name).trim();
      if (body.note != null) patch.note = String(body.note);
      if (body.photo_url != null) patch.photo_url = String(body.photo_url);
      if (profile.role === "admin" && body.active != null) patch.active = !!body.active;
      if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "nada para atualizar" });

      const rows = await sbFetch("/rest/v1/consultants?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ ok: true, consultant: rows && rows[0] });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
