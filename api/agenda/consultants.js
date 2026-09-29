/**
 * GET  /api/agenda/consultants — lista consultores ativos (público) ou todos (admin)
 * POST /api/agenda/consultants — admin cria consultor { name, note? }
 * PATCH /api/agenda/consultants — admin atualiza { id, name?, active?, note? }
 */
const { cors, readBody, sbFetch, requireUser, bearer } = require("../../_lib");

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
        : "/rest/v1/consultants?active=eq.true&select=id,name,note&order=name";
      const rows = await sbFetch(q);
      return res.status(200).json({ ok: true, consultants: rows || [] });
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
      await requireUser(req, ["admin"]);
      const body = readBody(req);
      const id = String(body.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });
      const patch = {};
      if (body.name != null) patch.name = String(body.name).trim();
      if (body.note != null) patch.note = String(body.note);
      if (body.active != null) patch.active = !!body.active;
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
