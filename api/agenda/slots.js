/**
 * GET  /api/agenda/slots?from=&to= — público: slots no intervalo + ocupados (display_name)
 * POST /api/agenda/slots — consultor/admin abre slots
 *   { consultant_id?, slots: [{ starts_at, ends_at }] }
 * DELETE /api/agenda/slots — cancela slot aberto { id }
 */
const { cors, readBody, sbFetch, requireUser } = require("../_lib");

function iso(d) {
  return new Date(d).toISOString();
}

module.exports = async function handler(req, res) {
  cors(res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const from = req.query.from || new Date().toISOString();
      const to = req.query.to || new Date(Date.now() + 14 * 864e5).toISOString();
      const slots = await sbFetch(
        "/rest/v1/open_slots?starts_at=gte." + encodeURIComponent(from) +
        "&starts_at=lt." + encodeURIComponent(to) +
        "&status=neq.cancelled&select=id,consultant_id,starts_at,ends_at,status&order=starts_at"
      );
      const bookings = await sbFetch(
        "/rest/v1/bookings?starts_at=gte." + encodeURIComponent(from) +
        "&starts_at=lt." + encodeURIComponent(to) +
        "&select=id,slot_id,consultant_id,starts_at,ends_at,is_fake,display_name,nome&order=starts_at"
      );
      const consultants = await sbFetch("/rest/v1/consultants?active=eq.true&select=id,name");
      const byId = Object.fromEntries((consultants || []).map((c) => [c.id, c.name]));

      const occupiedBySlot = {};
      (bookings || []).forEach((b) => {
        if (b.slot_id) occupiedBySlot[b.slot_id] = b;
      });

      const out = (slots || []).map((s) => {
        const b = occupiedBySlot[s.id];
        const taken = s.status === "booked" || !!b;
        const display = b
          ? (b.display_name || (b.nome ? String(b.nome).split(" ")[0] : "Reservado"))
          : null;
        return {
          id: s.id,
          consultant_id: s.consultant_id,
          consultant_name: byId[s.consultant_id] || "Consultor",
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          available: !taken,
          display_name: taken ? (display || "Reservado") : null,
          is_fake: b ? !!b.is_fake : false
        };
      });

      return res.status(200).json({ ok: true, slots: out });
    }

    if (req.method === "POST") {
      const { profile } = await requireUser(req, ["admin", "consultant"]);
      const body = readBody(req);
      let consultantId = body.consultant_id || profile.consultant_id;
      if (profile.role === "consultant") consultantId = profile.consultant_id;
      if (!consultantId) return res.status(400).json({ ok: false, error: "consultant_id obrigatório" });

      const list = Array.isArray(body.slots) ? body.slots : [];
      if (!list.length) return res.status(400).json({ ok: false, error: "slots[] obrigatório" });

      const rows = list.map((s) => {
        const starts = iso(s.starts_at);
        let ends = s.ends_at ? iso(s.ends_at) : null;
        if (!ends) ends = new Date(new Date(starts).getTime() + 30 * 60 * 1000).toISOString();
        return {
          consultant_id: consultantId,
          starts_at: starts,
          ends_at: ends,
          status: "open"
        };
      });

      const created = await sbFetch("/rest/v1/open_slots", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(rows)
      });
      return res.status(200).json({ ok: true, slots: created || [] });
    }

    if (req.method === "DELETE") {
      const { profile } = await requireUser(req, ["admin", "consultant"]);
      const body = readBody(req);
      const id = String(body.id || req.query.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id obrigatório" });

      const existing = await sbFetch("/rest/v1/open_slots?id=eq." + encodeURIComponent(id) + "&select=*&limit=1");
      const slot = existing && existing[0];
      if (!slot) return res.status(404).json({ ok: false, error: "Slot não encontrado" });
      if (profile.role === "consultant" && slot.consultant_id !== profile.consultant_id) {
        return res.status(403).json({ ok: false, error: "Sem permissão neste slot" });
      }
      if (slot.status === "booked") {
        return res.status(400).json({ ok: false, error: "Slot já reservado" });
      }
      await sbFetch("/rest/v1/open_slots?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "cancelled" })
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
