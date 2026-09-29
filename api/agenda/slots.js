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
      const consultantFilter = req.query.consultant_id
        ? "&consultant_id=eq." + encodeURIComponent(req.query.consultant_id)
        : "";
      const slots = await sbFetch(
        "/rest/v1/open_slots?starts_at=gte." + encodeURIComponent(from) +
        "&starts_at=lt." + encodeURIComponent(to) +
        consultantFilter +
        "&status=neq.cancelled&select=id,consultant_id,starts_at,ends_at,status&order=starts_at"
      );
      const bookings = await sbFetch(
        "/rest/v1/bookings?starts_at=gte." + encodeURIComponent(from) +
        "&starts_at=lt." + encodeURIComponent(to) +
        "&select=id,slot_id,consultant_id,starts_at,ends_at,is_fake,display_name,nome&order=starts_at"
      );
      let consultants;
      try {
        consultants = await sbFetch("/rest/v1/consultants?active=eq.true&select=id,name,photo_url,whatsapp");
      } catch (_) {
        try {
          consultants = await sbFetch("/rest/v1/consultants?active=eq.true&select=id,name,photo_url");
        } catch (__) {
          consultants = await sbFetch("/rest/v1/consultants?active=eq.true&select=id,name");
        }
      }
      const base = require("../_lib").supabaseUrl();
      const byId = Object.fromEntries((consultants || []).map((c) => [c.id, {
        ...c,
        photo_url: c.photo_url || (base + "/storage/v1/object/public/consultant-photos/" + c.id + "/avatar.jpg")
      }]));

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
        const c = byId[s.consultant_id] || {};
        return {
          id: s.id,
          consultant_id: s.consultant_id,
          consultant_name: c.name || "Consultor",
          consultant_photo: c.photo_url || "",
          consultant_whatsapp: c.whatsapp || "",
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          available: !taken,
          display_name: taken ? (display || "Reservado") : null,
          is_fake: b ? !!b.is_fake : false
        };
      });

      // Público: embaralha ordem dos consultores a cada request (mesmo horário não favorece sempre o mesmo)
      if (!req.query.consultant_id) {
        const ids = [...new Set(out.map((s) => s.consultant_id))];
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
        }
        const rank = Object.fromEntries(ids.map((id, i) => [id, i]));
        out.sort((a, b) => {
          const ta = new Date(a.starts_at) - new Date(b.starts_at);
          if (ta !== 0) return ta;
          if (a.available !== b.available) return a.available ? -1 : 1;
          return (rank[a.consultant_id] || 0) - (rank[b.consultant_id] || 0);
        });
      }

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
