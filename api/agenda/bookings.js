/**
 * GET /api/agenda/bookings?from=&to=
 * Lista agendamentos reais (não fake).
 * Consultor: só os seus. Admin: todos (ou ?consultant_id=).
 */
const { cors, sbFetch, requireUser } = require("../_lib");

module.exports = async function handler(req, res) {
  cors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { profile } = await requireUser(req, ["admin", "consultant"]);
    const from = req.query.from || new Date(Date.now() - 1 * 864e5).toISOString();
    const to = req.query.to || new Date(Date.now() + 30 * 864e5).toISOString();

    let consultantId = null;
    if (profile.role === "consultant") {
      consultantId = profile.consultant_id;
      if (!consultantId) return res.status(403).json({ ok: false, error: "Consultor sem vínculo" });
    } else if (req.query.consultant_id) {
      consultantId = String(req.query.consultant_id);
    }

    let q =
      "/rest/v1/bookings?is_fake=eq.false" +
      "&starts_at=gte." + encodeURIComponent(from) +
      "&starts_at=lt." + encodeURIComponent(to) +
      "&select=id,consultant_id,starts_at,ends_at,nome,whatsapp,cidade,created_at&order=starts_at.asc";
    if (consultantId) q += "&consultant_id=eq." + encodeURIComponent(consultantId);

    const rows = await sbFetch(q);
    let consultants = [];
    try {
      consultants = await sbFetch("/rest/v1/consultants?select=id,name,whatsapp,photo_url");
    } catch (_) {
      consultants = await sbFetch("/rest/v1/consultants?select=id,name");
    }
    const byId = Object.fromEntries((consultants || []).map((c) => [c.id, c]));

    const bookings = (rows || []).map((b) => ({
      ...b,
      consultant_name: (byId[b.consultant_id] && byId[b.consultant_id].name) || "Consultor"
    }));

    return res.status(200).json({ ok: true, bookings });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
