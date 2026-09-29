/**
 * POST /api/admin/login  { email, password }
 * Returns access_token + profile (admin or consultant).
 */
const { cors, readBody, authPasswordGrant, getProfile } = require("../_lib");

module.exports = async function handler(req, res) {
  cors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email e senha obrigatórios" });
    }

    const session = await authPasswordGrant(email, password);
    const user = session.user || {};
    const profile = await getProfile(user.id);
    if (!profile) {
      return res.status(403).json({ ok: false, error: "Usuário sem perfil. Peça ao admin para liberar o acesso." });
    }

    return res.status(200).json({
      ok: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: { id: user.id, email: user.email },
      profile
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 401;
    return res.status(status).json({ ok: false, error: String(e.message || e) });
  }
};
