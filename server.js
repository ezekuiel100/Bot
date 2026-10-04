const path = require("node:path");
const crypto = require("node:crypto");
const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const { DatabaseSync } = require("node:sqlite");
const {
  normalizeFancyText,
  compactForWordMatch,
  isUsableBannedCompact,
} = require("./normalizeFancyText");

// ====================== BANCO ======================
const db = new DatabaseSync("/app/data/database.db");

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS proibidas (
    key INTEGER PRIMARY KEY,
    value TEXT UNIQUE NOT NULL
  ) STRICT;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    message_text TEXT,
    chat_id INTEGER
  ) STRICT;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS restricoes (
    id INTEGER PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    reason TEXT NOT NULL,
    chat_id INTEGER NOT NULL
  ) STRICT;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reportadores_autorizados (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    authorized_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  ) STRICT;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS membros_conhecidos (
    chat_id INTEGER NOT NULL,
    chat_title TEXT,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  ) STRICT;
`);

// ====================== AUTENTICAÇÃO ======================
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error(
    "ADMIN_PASSWORD não configurada. Defina uma senha forte para iniciar o painel.",
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

fastify.addHook("onRequest", async (request, reply) => {
  // Preflight CORS não carrega credenciais e não executa ações administrativas.
  if (request.method === "OPTIONS") return;

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) {
    return reply
      .header("WWW-Authenticate", 'Basic realm="Painel administrativo", charset="UTF-8"')
      .code(401)
      .send({ success: false, error: "Autenticação obrigatória" });
  }

  let credentials;
  try {
    credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    credentials = "";
  }

  const separatorIndex = credentials.indexOf(":");
  const username = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : "";

  if (!safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
    return reply
      .header("WWW-Authenticate", 'Basic realm="Painel administrativo", charset="UTF-8"')
      .code(401)
      .send({ success: false, error: "Credenciais inválidas" });
  }
});

// ====================== CORS ======================
fastify.register(cors, {
  origin: "http://tc0ccgks8swswkkccc0kwc8s.168.231.91.32.sslip.io",
});

// Servir arquivos estáticos apenas da pasta public/ (css, imagens, html)
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"), // só o que for público
  prefix: "/", // acessível na raiz
});

// Servir o frontend HTML
fastify.get("/", async (request, reply) => {
  console.log("📄 Alguém acessou a raiz /");
  try {
    return reply.sendFile("index.html"); // ← Mude aqui se o nome for diferente
  } catch (err) {
    console.error("❌ Erro ao enviar HTML:", err.message);
    return reply.code(404).send(`
      <h1>Arquivo HTML não encontrado</h1>
      <p>Tente acessar: <a href="/gerenciador.html">/gerenciador.html</a></p>
    `);
  }
});

// ====================== ROTAS ======================

// Listar todas
fastify.get("/palavras", async (request, reply) => {
  const stmt = db.prepare(
    "SELECT key, value FROM proibidas ORDER BY value ASC",
  );
  const palavras = stmt.all();
  return { success: true, total: palavras.length, data: palavras };
});

// Adicionar
fastify.post("/palavras", async (request, reply) => {
  const { value } = request.body;

  if (!value || !value.trim()) {
    reply.code(400);
    return { success: false, error: "Valor é obrigatório" };
  }

  const palavra = normalizeFancyText(value).trim();
  if (!isUsableBannedCompact(compactForWordMatch(palavra))) {
    reply.code(400);
    return {
      success: false,
      error: "Use pelo menos 2 letras/números, ou um emoji",
    };
  }

  try {
    const insert = db.prepare("INSERT INTO proibidas (value) VALUES (?)");
    insert.run(palavra);
    return { success: true, message: `Palavra "${palavra}" banida!` };
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      reply.code(409);
      return { success: false, error: "Essa palavra já está proibida" };
    }
    reply.code(500);
    return { success: false, error: err.message };
  }
});

// Deletar
fastify.delete("/palavras/:key", async (request, reply) => {
  const { key } = request.params;

  const del = db.prepare("DELETE FROM proibidas WHERE key = ?");
  const result = del.run(key);

  if (result.changes === 0) {
    reply.code(404);
    return { success: false, error: "Palavra não encontrada" };
  }

  return { success: true, message: "Palavra removida com sucesso" };
});

// Contagem
fastify.get("/palavras/count", async () => {
  const stmt = db.prepare("SELECT COUNT(*) as total FROM proibidas");
  return stmt.get();
});

// ====================== REPORTADORES ======================

fastify.get("/membros", async () => {
  const data = db
    .prepare(
      `SELECT m.chat_id, m.chat_title, m.user_id, m.username, m.first_name,
              m.last_seen_at,
              CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS autorizado
       FROM membros_conhecidos m
       LEFT JOIN reportadores_autorizados r
         ON r.chat_id = m.chat_id AND r.user_id = m.user_id
       ORDER BY m.chat_title COLLATE NOCASE, m.first_name COLLATE NOCASE`,
    )
    .all();
  return { success: true, total: data.length, data };
});

fastify.get("/reportadores", async () => {
  const data = db
    .prepare(
      `SELECT r.chat_id, r.user_id, r.username, r.authorized_at,
              m.chat_title, m.first_name
       FROM reportadores_autorizados r
       LEFT JOIN membros_conhecidos m
         ON m.chat_id = r.chat_id AND m.user_id = r.user_id
       ORDER BY m.chat_title COLLATE NOCASE, COALESCE(m.first_name, r.username) COLLATE NOCASE`,
    )
    .all();
  return { success: true, total: data.length, data };
});

fastify.post("/reportadores", async (request, reply) => {
  const chatId = Number(request.body?.chat_id);
  const userId = Number(request.body?.user_id);

  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)) {
    reply.code(400);
    return { success: false, error: "Grupo e usuário são obrigatórios" };
  }

  const member = db
    .prepare(
      "SELECT username, first_name FROM membros_conhecidos WHERE chat_id = ? AND user_id = ?",
    )
    .get(chatId, userId);

  if (!member) {
    reply.code(404);
    return { success: false, error: "Usuário não encontrado nesse grupo" };
  }

  const name = member.username || member.first_name || `Usuário ${userId}`;
  db.prepare(
    "INSERT OR REPLACE INTO reportadores_autorizados (chat_id, user_id, username, authorized_at) VALUES (?, ?, ?, ?)",
  ).run(chatId, userId, name, Date.now());

  return { success: true, message: `${name} foi autorizado a denunciar` };
});

fastify.delete("/reportadores/:chatId/:userId", async (request, reply) => {
  const chatId = Number(request.params.chatId);
  const userId = Number(request.params.userId);

  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)) {
    reply.code(400);
    return { success: false, error: "Grupo ou usuário inválido" };
  }

  const result = db
    .prepare(
      "DELETE FROM reportadores_autorizados WHERE chat_id = ? AND user_id = ?",
    )
    .run(chatId, userId);
  db.prepare("DELETE FROM reports WHERE chat_id = ? AND reporter_id = ?").run(
    chatId,
    userId,
  );

  if (result.changes === 0) {
    reply.code(404);
    return { success: false, error: "Essa pessoa não estava autorizada" };
  }

  return { success: true, message: "Permissão de denúncia removida" };
});

// ====================== LOGS ======================

// Listar logs
fastify.get("/logs", async () => {
  const data = db.prepare("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100").all();
  return { success: true, total: data.length, data };
});

// Limpar logs
fastify.delete("/logs", async () => {
  db.prepare("DELETE FROM logs").run();
  return { success: true, message: "Histórico limpo" };
});

// Histórico de restrições aplicadas pelo bot
fastify.get("/restricoes", async () => {
  const data = db
    .prepare(
      "SELECT id, timestamp, user_id, username, reason, chat_id FROM restricoes ORDER BY timestamp DESC LIMIT 100",
    )
    .all();
  return { success: true, total: data.length, data };
});

// Banir permanentemente um usuário via Telegram API
fastify.post("/ban", async (request, reply) => {
  const { chat_id, user_id } = request.body;
  if (!chat_id || !user_id) {
    reply.code(400);
    return { success: false, error: "chat_id e user_id são obrigatórios" };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    reply.code(500);
    return { success: false, error: "Token do bot não configurado no servidor" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/banChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, user_id }),
    });
    const data = await res.json();
    if (!data.ok) {
      reply.code(400);
      return { success: false, error: data.description };
    }
    return { success: true, message: "Usuário banido com sucesso" };
  } catch (err) {
    reply.code(500);
    return { success: false, error: err.message };
  }
});

// Remover restrição de um usuário via Telegram API
fastify.post("/unrestrict", async (request, reply) => {
  const { chat_id, user_id } = request.body;

  if (!chat_id || !user_id) {
    reply.code(400);
    return { success: false, error: "chat_id e user_id são obrigatórios" };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    reply.code(500);
    return { success: false, error: "Token do bot não configurado no servidor" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/restrictChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        user_id,
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      reply.code(400);
      return { success: false, error: data.description };
    }
    return { success: true, message: "Restrição removida com sucesso" };
  } catch (err) {
    reply.code(500);
    return { success: false, error: err.message };
  }
});

// ====================== INICIAR ======================
fastify.listen({ port: 3333, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🚀 Servidor rodando em ${address}`);
  console.log(`🌐 Frontend: ${address}`);
  console.log(`🌐 API: ${address}/palavras`);
});
