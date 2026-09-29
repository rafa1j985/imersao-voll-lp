/**
 * POST /api/agenda/book
 * Reserva um slot aberto (cliente) OU cria fake (admin).
 *
 * Cliente: { slot_id, nome, whatsapp, cidade?, quiz_payload? }
 * Admin fake: { slot_id, is_fake: true, display_name }
 */
const { cors, readBody, sbFetch, requireUser, bearer } = require("../../_lib");

function crmPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

async function crmFetch(path, opts = {}) {
  const base = (process.env.CRM_SUPABASE_URL || "https://wfrzsnwisypmgsbeccfj.supabase.co").replace(/\/$/, "");
  const key = process.env.CRM_SUPABASE_ANON_KEY || "";
  if (!key) throw new Error("CRM_SUPABASE_ANON_KEY não configurada");
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.message) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function forwardBookingToCrm(body) {
  const formId = process.env.CRM_FORM_ID || "1d9607f3-27e0-4ad4-a8f1-9756f47b82db";
  const answers = [
    { questionId: "c43fde98-7f76-4079-901a-3d3360e39f01", questionTitle: "Seu nome", value: body.nome || "" },
    { questionId: "9bc90794-3102-4fd4-aa55-821cab964194", questionTitle: "WhatsApp com DDD", value: crmPhone(body.whatsapp || "") },
    { questionId: "e2d9e620-8714-4fbd-988e-0c3ac6b4ce9c", questionTitle: "Cidade do seu Studio", value: body.cidade || "" },
    {
      questionId: "baa13de7-55f2-4308-b092-a4d0ee68a8e2",
      questionTitle: "Se fizer sentido, quando você quer resolver isso?",
      value: "Agendou conversa · " + (body.starts_label || body.starts_at || "")
    }
  ];
  await crmFetch("/rest/v1/crm_form_submissions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{ form_id: formId, answers }])
  });
}

module.exports = async function handler(req, res) {
  cors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = readBody(req);
    const slotId = String(body.slot_id || "").trim();
    if (!slotId) return res.status(400).json({ ok: false, error: "slot_id obrigatório" });

    const isFake = !!body.is_fake;
    if (isFake) {
      await requireUser(req, ["admin"]);
    }

    const slots = await sbFetch("/rest/v1/open_slots?id=eq." + encodeURIComponent(slotId) + "&select=*&limit=1");
    const slot = slots && slots[0];
    if (!slot || slot.status !== "open") {
      return res.status(409).json({ ok: false, error: "Horário indisponível" });
    }

    let nome = String(body.nome || "").trim();
    let whatsapp = crmPhone(body.whatsapp || "");
    let cidade = String(body.cidade || "").trim();
    let displayName = String(body.display_name || "").trim();

    if (isFake) {
      if (!displayName) displayName = nome || "Reservado";
      nome = nome || displayName;
      whatsapp = whatsapp || "5500000000000";
    } else {
      if (!nome || whatsapp.length < 12) {
        return res.status(400).json({ ok: false, error: "nome e whatsapp são obrigatórios" });
      }
      if (!displayName) displayName = nome.split(/\s+/)[0];
    }

    // marca slot como booked (otimista; falha se já mudou)
    const patched = await sbFetch(
      "/rest/v1/open_slots?id=eq." + encodeURIComponent(slotId) + "&status=eq.open",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "booked" })
      }
    );
    if (!patched || !patched.length) {
      return res.status(409).json({ ok: false, error: "Horário acabou de ser reservado" });
    }

    const booking = {
      slot_id: slotId,
      consultant_id: slot.consultant_id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      nome,
      whatsapp: isFake ? null : whatsapp,
      cidade: isFake ? null : cidade,
      is_fake: isFake,
      display_name: displayName,
      quiz_payload: body.quiz_payload || {},
      lead_id: body.lead_id || null
    };

    const rows = await sbFetch("/rest/v1/bookings", {
      method: "POST",
      body: JSON.stringify([booking])
    });
    const saved = rows && rows[0];

    let crmOk = false;
    let crmError = null;
    if (!isFake) {
      try {
        const startsLabel = new Date(slot.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        await forwardBookingToCrm({
          nome,
          whatsapp,
          cidade,
          starts_at: slot.starts_at,
          starts_label: startsLabel
        });
        crmOk = true;
      } catch (e) {
        crmError = String(e.message || e);
      }
      if (saved && saved.id) {
        await sbFetch("/rest/v1/bookings?id=eq." + encodeURIComponent(saved.id), {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify({ crm_ok: crmOk, crm_error: crmError })
        }).catch(() => {});
      }
    }

    return res.status(200).json({
      ok: true,
      booking: {
        id: saved && saved.id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        consultant_id: slot.consultant_id,
        display_name: displayName,
        is_fake: isFake
      },
      crmOk,
      crmError
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
