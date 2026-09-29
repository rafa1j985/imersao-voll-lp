/**
 * POST /api/lead
 * Recebe respostas do quiz, grava no Supabase do projeto e encaminha ao formulário CRM VOLL.
 * Secrets só no server (Vercel env).
 */

const CRM_QUESTIONS = {
  dores: { id: "aab74dc3-f6b5-4e56-9a94-b70bf9a8c24a", title: "O que te incomoda hoje no seu Studio?" },
  ordem: { id: "87f45a8b-c3b3-4857-b862-7ded0b5d546f", title: "Se você pudesse resolver só 3, quais seriam?" },
  alunos: { id: "7ab236cb-d6d9-40e2-a634-93e65f60f9d0", title: "Quantos alunos ativos você tem hoje?" },
  numeros: { id: "ddf8ad10-abdb-4ef1-a682-880992bcdb6a", title: "Você toparia abrir os números do seu Studio pra gente?" },
  momento: { id: "baa13de7-55f2-4308-b092-a4d0ee68a8e2", title: "Se fizer sentido, quando você quer resolver isso?" },
  nome: { id: "c43fde98-7f76-4079-901a-3d3360e39f01", title: "Seu nome", crmMapping: "company_name" },
  whatsapp: { id: "9bc90794-3102-4fd4-aa55-821cab964194", title: "WhatsApp com DDD", crmMapping: "phone" },
  cidade: { id: "e2d9e620-8714-4fbd-988e-0c3ac6b4ce9c", title: "Cidade do seu Studio" }
};

function crmPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

function crmDealNumber() {
  const s = new Date();
  const y = s.getFullYear();
  const m = String(s.getMonth() + 1).padStart(2, "0");
  const d = String(s.getDate()).padStart(2, "0");
  const h = String(s.getHours()).padStart(2, "0");
  const min = String(s.getMinutes()).padStart(2, "0");
  const r = Math.floor(1000 + Math.random() * 9000);
  return Number(`${y}${m}${d}${h}${min}${r}`);
}

function buildCrmAnswers(body) {
  const ans = (key, value) => {
    const q = CRM_QUESTIONS[key];
    return { questionId: q.id, questionTitle: q.title, value: String(value == null ? "" : value) };
  };
  return [
    ans("dores", body.dores_labels || ""),
    ans("ordem", body.ordem_labels || ""),
    ans("alunos", body.alunos_label || body.alunos || ""),
    ans("numeros", body.numeros_label || body.numeros || ""),
    ans("momento", body.momento_label || body.momento || ""),
    ans("nome", body.nome || ""),
    ans("whatsapp", crmPhone(body.whatsapp || "")),
    ans("cidade", body.cidade || "")
  ];
}

async function sbFetch(path, opts = {}) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY não configurados");
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
    const msg = (data && data.message) || res.statusText || ("HTTP " + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
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
    const msg = (data && data.message) || res.statusText || ("HTTP " + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function forwardToCrm(body) {
  const formId = process.env.CRM_FORM_ID || "1d9607f3-27e0-4ad4-a8f1-9756f47b82db";
  const answers = buildCrmAnswers(body);
  await crmFetch("/rest/v1/crm_form_submissions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{ form_id: formId, answers }])
  });

  let dealId = null;
  let dealError = null;
  try {
    const formRows = await crmFetch("/rest/v1/crm_forms?id=eq." + encodeURIComponent(formId) + "&select=*");
    const form = (formRows && formRows[0]) || null;
    if (!form || form.type === "sector_form") return { submissionOk: true, dealId: null };

    let pipeline = form.target_pipeline || "Imersão Presencial";
    let stage = form.target_stage || "new";
    const pipes = await crmFetch("/rest/v1/crm_pipelines?select=name,stages&order=name").catch(() => []);
    const pipeList = pipes || [];
    if (!pipeList.find((p) => p.name === pipeline) && pipeList.length) pipeline = pipeList[0].name;
    const stages = ((pipeList.find((p) => p.name === pipeline) || {}).stages) || [];
    if (!stages.map((s) => s.id).includes(stage) && stages.length) stage = stages[0].id;

    const style = form.style && typeof form.style === "object" ? form.style : {};
    const internalName = String(style.internalName || form.title || "Formulário Inicial Imersão 2027").trim();
    const deal = {
      id: crypto.randomUUID(),
      deal_number: crmDealNumber(),
      pipeline,
      stage,
      status: "hot",
      created_at: new Date().toISOString(),
      source: "Formulário Online",
      campaign: form.campaign || "",
      form_internal_name: internalName
    };
    const Q = form.questions || [];
    answers.forEach((a) => {
      const B = Q.find((z) => z.id === a.questionId);
      if (!B || !B.crmMapping) return;
      const v = a.value != null ? String(a.value).trim() : "";
      if (!v) return;
      deal[B.crmMapping] = v;
    });
    if (deal.phone) deal.phone = crmPhone(deal.phone);
    if (!deal.company_name) deal.company_name = deal.contact_name || body.nome || "";
    deal.title = deal.company_name || ("Lead via " + (form.title || "formulário"));

    let owner = form.fixed_owner_id || null;
    if (!owner && form.distribution_mode === "round-robin" && form.team_id) {
      try {
        const teams = await crmFetch("/rest/v1/crm_teams?id=eq." + encodeURIComponent(form.team_id) + "&select=members");
        const members = (teams && teams[0] && teams[0].members) || [];
        if (members.length) {
          const next = ((form.last_assigned_index || 0) + 1) % members.length;
          owner = members[next];
          await crmFetch("/rest/v1/crm_forms?id=eq." + encodeURIComponent(form.id), {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ last_assigned_index: next })
          }).catch(() => {});
        }
      } catch (_) {}
    }
    if (owner) deal.owner_id = owner;

    await crmFetch("/rest/v1/crm_deals", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([deal])
    });
    dealId = deal.id;
  } catch (e) {
    dealError = String(e && e.message || e);
  }
  return { submissionOk: true, dealId, dealError };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const nome = String(body.nome || "").trim();
    const whatsapp = crmPhone(body.whatsapp || "");
    const cidade = String(body.cidade || "").trim();
    if (!nome || whatsapp.length < 12) {
      return res.status(400).json({ ok: false, error: "nome e whatsapp são obrigatórios" });
    }

    const row = {
      nome,
      whatsapp,
      cidade,
      dores: Array.isArray(body.dores) ? body.dores : [],
      ordem: Array.isArray(body.ordem) ? body.ordem : [],
      dores_labels: body.dores_labels || "",
      ordem_labels: body.ordem_labels || "",
      alunos: body.alunos_label || body.alunos || "",
      numeros: body.numeros_label || body.numeros || "",
      momento: body.momento_label || body.momento || "",
      dor_principal: body.dor_principal || "",
      rota: body.rota || "",
      origem: body.origem || "",
      payload: body,
      crm_submission_ok: false,
      crm_deal_ok: false,
      crm_error: null
    };

    let leadId = null;
    try {
      const inserted = await sbFetch("/rest/v1/quiz_leads", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row])
      });
      leadId = inserted && inserted[0] && inserted[0].id;
    } catch (e) {
      // Tabela ainda não criada: responde com erro claro
      if (String(e.message || "").includes("quiz_leads") || e.status === 404) {
        return res.status(503).json({
          ok: false,
          error: "Tabela quiz_leads não existe. Rode sql/001_quiz_leads.sql no SQL Editor do Supabase.",
          detail: e.message
        });
      }
      throw e;
    }

    let crm = { submissionOk: false, dealId: null, dealError: null };
    try {
      crm = await forwardToCrm(body);
    } catch (e) {
      crm = { submissionOk: false, dealId: null, dealError: String(e && e.message || e) };
    }

    if (leadId) {
      await sbFetch("/rest/v1/quiz_leads?id=eq." + encodeURIComponent(leadId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          crm_submission_ok: !!crm.submissionOk,
          crm_deal_ok: !!crm.dealId,
          crm_error: crm.dealError || (crm.submissionOk ? null : "falha ao enviar ao CRM")
        })
      }).catch(() => {});
    }

    return res.status(200).json({
      ok: true,
      leadId,
      crmSubmissionOk: !!crm.submissionOk,
      crmDealId: crm.dealId || null,
      crmDealError: crm.dealError || null
    });
  } catch (e) {
    console.error("[api/lead]", e);
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
