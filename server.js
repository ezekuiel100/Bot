const path = require("node:path");
const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const { DatabaseSync } = require("node:sqlite");

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

  const palavra = value.toLowerCase().trim();

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
