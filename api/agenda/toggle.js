/**
 * POST /api/agenda/toggle
 * Um clique: libera ou bloqueia um horário de 30 min.
 * Body: { starts_at, consultant_id? }
 * - se não existe slot open → cria
 * - se existe open → cancela (bloqueia)
 * - se booked → erro
 */
const { cors, readBody, sbFetch, requireUser } = require("../_lib");

module.exports = async function handler(req, res) {
  cors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { profile } = await requireUser(req, ["admin", "consultant"]);
    const body = readBody(req);
    let consultantId = body.consultant_id || profile.consultant_id;
    if (profile.role === "consultant") consultantId = profile.consultant_id;
    if (!consultantId) return res.status(400).json({ ok: false, error: "consultant_id obrigatório" });

    const starts = new Date(body.starts_at);
    if (Number.isNaN(starts.getTime())) return res.status(400).json({ ok: false, error: "starts_at inválido" });
    const startsAt = starts.toISOString();
    const endsAt = new Date(starts.getTime() + 30 * 60 * 1000).toISOString();

    const existing = await sbFetch(
      "/rest/v1/open_slots?consultant_id=eq." + encodeURIComponent(consultantId) +
      "&starts_at=eq." + encodeURIComponent(startsAt) +
      "&select=*&limit=1"
    );
    const slot = existing && existing[0];

    if (slot && slot.status === "booked") {
      return res.status(409).json({ ok: false, error: "Horário já reservado", state: "booked" });
    }

    if (slot && slot.status === "open") {
      await sbFetch("/rest/v1/open_slots?id=eq." + encodeURIComponent(slot.id), {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "cancelled" })
      });
      return res.status(200).json({ ok: true, state: "closed", starts_at: startsAt });
    }

    // reabrir cancelled no mesmo instante, ou criar novo
    if (slot && slot.status === "cancelled") {
      const rows = await sbFetch("/rest/v1/open_slots?id=eq." + encodeURIComponent(slot.id), {
        method: "PATCH",
        body: JSON.stringify({ status: "open", ends_at: endsAt })
      });
      return res.status(200).json({ ok: true, state: "open", slot: rows && rows[0], starts_at: startsAt });
    }

    const created = await sbFetch("/rest/v1/open_slots", {
      method: "POST",
      body: JSON.stringify([{
        consultant_id: consultantId,
        starts_at: startsAt,
        ends_at: endsAt,
        status: "open"
      }])
    });
    return res.status(200).json({ ok: true, state: "open", slot: created && created[0], starts_at: startsAt });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
