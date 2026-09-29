/**
 * GET  /api/content  — público: conteúdo publicado (ou vazio)
 * PUT  /api/content  — admin: publica JSON completo do CONTEUDO
 */
const { cors, readBody, sbFetch, requireUser } = require("./_lib");

module.exports = async function handler(req, res) {
  cors(res, "GET, PUT, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const rows = await sbFetch("/rest/v1/lp_content?id=eq.oficial&select=content,updated_at&limit=1");
      const row = (rows && rows[0]) || null;
      const content = row && row.content && Object.keys(row.content).length ? row.content : null;
      return res.status(200).json({
        ok: true,
        content,
        updated_at: row ? row.updated_at : null
      });
    }

    if (req.method === "PUT") {
      const { user } = await requireUser(req, ["admin"]);
      const body = readBody(req);
      const content = body.content;
      if (!content || typeof content !== "object") {
        return res.status(400).json({ ok: false, error: "content (objeto) é obrigatório" });
      }
      const rows = await sbFetch("/rest/v1/lp_content?id=eq.oficial", {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({
          content,
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })
      });
      const row = (rows && rows[0]) || null;
      return res.status(200).json({ ok: true, updated_at: row && row.updated_at });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
