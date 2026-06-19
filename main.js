const { mkdirSync, existsSync, writeFileSync } = require("node:fs");
const path = require("node:path");
mkdirSync("./data/", { recursive: true });

let tf = null;
let nsfw = null;
try {
  tf = require("@tensorflow/tfjs-node");
  // Patch: re-adiciona isNullOrUndefined removido no TF.js 4.x (necessário pelo nsfwjs 2.4.2)
  const utilBase = require("@tensorflow/tfjs-core/dist/util_base");
  if (!utilBase.isNullOrUndefined) {
    utilBase.isNullOrUndefined = (val) => val === null || val === undefined;
  }
  nsfw = require("nsfwjs");
} catch {
  console.warn("NSFW detection indisponível neste ambiente.");
}
const { DatabaseSync } = require("node:sqlite");
const TelegramBot = require("node-telegram-bot-api");

const database = new DatabaseSync("/app/data/database.db");

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
// const telegramBotToken = process.env.token;

const bot = new TelegramBot(telegramBotToken, { polling: true });

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

const MODEL_DIR = "/app/data/nsfw_model";
const MODEL_URL = "https://nsfwjs.com/quant_nsfw_mobilenet/";

async function downloadModelIfNeeded() {
  const modelJsonPath = path.join(MODEL_DIR, "model.json");
  if (existsSync(modelJsonPath)) {
    console.log("[NSFW] Modelo encontrado no cache, carregando...");
    return;
  }
  console.log("[NSFW] Baixando modelo pela primeira vez...");
  mkdirSync(MODEL_DIR, { recursive: true });
  const modelJsonRes = await fetch(`${MODEL_URL}model.json`);
  if (!modelJsonRes.ok) throw new Error(`HTTP ${modelJsonRes.status} ao baixar model.json`);
  const modelJson = await modelJsonRes.json();
  writeFileSync(modelJsonPath, JSON.stringify(modelJson));
  for (const shard of modelJson.weightsManifest[0].paths) {
    const shardRes = await fetch(`${MODEL_URL}${shard}`);
    if (!shardRes.ok) throw new Error(`HTTP ${shardRes.status} ao baixar ${shard}`);
    writeFileSync(path.join(MODEL_DIR, shard), Buffer.from(await shardRes.arrayBuffer()));
  }
  console.log("[NSFW] Modelo baixado com sucesso.");
}

let nsfwModel = null;
if (nsfw) {
  downloadModelIfNeeded()
    .then(() => nsfw.load(`file://${MODEL_DIR}/`))
    .then((model) => {
      nsfwModel = model;
      console.log("[NSFW] Modelo carregado e pronto.");
    })
    .catch((err) => console.error("[NSFW] Erro ao carregar modelo:", err.message));
}

async function isNude(msg) {
  if (!nsfwModel || !msg.photo) return false;
  try {
    const fileId = msg.photo.at(-1).file_id;
    const url = await bot.getFileLink(fileId);
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const image = tf.node.decodeImage(buffer, 3);
    const predictions = await nsfwModel.classify(image);
    image.dispose();
    const porn =
      predictions.find((p) => p.className === "Porn")?.probability ?? 0;
    const hentai =
      predictions.find((p) => p.className === "Hentai")?.probability ?? 0;
    console.log(
      `[NSFW] user=${msg.from?.username ?? msg.from?.id} porn=${(porn * 100).toFixed(1)}% hentai=${(hentai * 100).toFixed(1)}%`,
    );
    return porn > 0.7 || hentai > 0.7;
  } catch (err) {
    console.error("Erro ao analisar imagem:", err.message);
    return false;
  }
}

let linkAlert = "PROIBIDO LINKS NO GRUPO!";
let forwardMessageAlert = "PROIBIDO ENCAMINHA MENSAGEM";

// Cache de admins por grupo: chatId → { ids, expiresAt }
const adminsCache = new Map();
const ADMINS_TTL = 5 * 60 * 1000;

// Cache de palavras proibidas
let wordsCache = null;
let wordsCacheExpiresAt = 0;
const WORDS_TTL = 60 * 1000;

function getProibidas() {
  if (wordsCache && Date.now() < wordsCacheExpiresAt) return wordsCache;
  wordsCache = database
    .prepare("SELECT value FROM proibidas")
    .all()
    .map((r) => r.value);
  wordsCacheExpiresAt = Date.now() + WORDS_TTL;
  return wordsCache;
}

function invalidateWordsCache() {
  wordsCacheExpiresAt = 0;
}

database.exec("PRAGMA journal_mode = WAL");

database.exec(`CREATE TABLE IF NOT EXISTS proibidas (
  key INTEGER PRIMARY KEY,
  value TEXT UNIQUE
) STRICT
`);

database.exec(`CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  action TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  message_text TEXT,
  chat_id INTEGER
) STRICT
`);

function insertLog(action, msg) {
  try {
    const username =
      msg.from?.username || msg.from?.first_name || "desconhecido";
    const text = (msg.text || msg.caption || "[mídia]").slice(0, 200);
    database
      .prepare(
        "INSERT INTO logs (timestamp, action, user_id, username, message_text, chat_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        Date.now(),
        action,
        msg.from?.id ?? null,
        username,
        text,
        msg.chat.id,
      );
  } catch (err) {
    console.error("Erro ao inserir log:", err.message);
  }
}

// Matches "/banir [palavra]"
bot.onText(/\/banir (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const palavra = match[1].toLowerCase().trim();

  const admins = await GetGroupAdmins(msg);
  const isAnonymousAdmin =
    userId === 1087968824 && msg.sender_chat && msg.sender_chat.id === chatId;

  if (admins.includes(userId) || isAnonymousAdmin) {
    try {
      const insert = database.prepare(
        "INSERT INTO proibidas (value) VALUES (?)",
      );
      insert.run(palavra);
      invalidateWordsCache();
      console.log("Nova palavra proibida adicionada");
    } catch (err) {
      console.log(err.message);
    }
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  console.log("mensagem recieved");

  if (msg.new_chat_members) {
    bot.deleteMessage(chatId, messageId).catch((err) => {
      console.error("Erro ao apagar mensagem:", err);
    });
  }

  if (msg.left_chat_member) {
    bot.deleteMessage(chatId, messageId).catch((err) => {
      console.error("Erro ao apagar mensagem de saída:", err);
    });
  }

  DeleteforwardMessage(msg);

  if (msg?.text) {
    const proibidas = getProibidas();
    const text = msg.text.toLowerCase();

    for (const palavra of proibidas) {
      if (text.includes(palavra)) {
        console.log("Palavra proibida detectada:", palavra);
        insertLog("palavra_proibida", msg);
        DeleteGroupMessage(msg, "MENSAGEM APAGADA!");
        restrictChatMember(msg);
        return;
      }
    }
  }

  if (msg?.entities && msg.entities[0].type == "url") {
    insertLog("link", msg);
    DeleteGroupMessage(msg, linkAlert);
    restrictChatMember(msg, 500000);
    return;
  }

  if (
    (msg.photo || msg.video) &&
    msg.caption_entities &&
    msg.caption_entities[0]?.type == "url"
  ) {
    insertLog("link", msg);
    DeleteGroupMessage(msg, linkAlert);
    restrictChatMember(msg, 500000);
    return;
  }

  if (msg.photo && (await isNude(msg))) {
    insertLog("nude", msg);
    DeleteGroupMessage(msg, "IMAGEM INAPROPRIADA!");
    restrictChatMember(msg);
    return;
  }
});

function DeleteGroupMessage(msg, alertText) {
  GetGroupAdmins(msg)
    .then((adm) => {
      if (adm.includes(msg.from.id) || msg.from.is_bot) return;
      bot
        .sendMessage(msg.chat.id, alertText)
        .catch((err) => console.error("Erro ao enviar alerta:", err.message));
      bot
        .deleteMessage(msg.chat.id, msg.message_id)
        .catch((err) => console.error("Erro ao apagar mensagem:", err.message));
    })
    .catch((err) => console.error("Erro ao obter admins:", err.message));
}

async function GetGroupAdmins(msg) {
  const chatId = msg.chat.id;
  const cached = adminsCache.get(chatId);
  if (cached && Date.now() < cached.expiresAt) return cached.ids;

  try {
    const admins = await bot.getChatAdministrators(chatId);
    const ids = admins.map((adm) => adm.user.id);
    adminsCache.set(chatId, { ids, expiresAt: Date.now() + ADMINS_TTL });
    return ids;
  } catch (error) {
    console.error("Erro ao obter admins:", error.message);
    return cached?.ids ?? [];
  }
}

function restrictChatMember(msg, duration = 86400) {
  let seconds = Math.floor(Date.now() / 1000);

  bot
    .restrictChatMember(msg.chat.id, msg.from.id, {
      can_send_messages: false,
      until_date: seconds + duration,
    })
    .catch((err) => console.error("Erro ao restringir membro:", err.message));
}

function DeleteforwardMessage(msg) {
  if (msg.forward_from_chat) {
    insertLog("encaminhamento", msg);
    DeleteGroupMessage(msg, forwardMessageAlert);
  }
}
