const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const { DatabaseSync } = require("node:sqlite");

// ====================== BANCO ======================
const db = new DatabaseSync("/app/data/database.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS proibidas (
    key INTEGER PRIMARY KEY,
    value TEXT UNIQUE NOT NULL
  ) STRICT;
`);

// ====================== CORS ======================
fastify.register(cors, {
  origin: "*",
});

// Servir arquivos estáticos (caso tenha css, imagens, etc no futuro)
fastify.register(require("@fastify/static"), {
  root: __dirname, // mesma pasta dos arquivos
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
