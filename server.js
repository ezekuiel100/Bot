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
const start = async () => {
  try {
    await fastify.listen({ port: 3333, host: "0.0.0.0" });
    console.log("🚀 API Fastify rodando em http://localhost:3333");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
