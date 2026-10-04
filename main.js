const { DatabaseSync } = require("node:sqlite");
const TelegramBot = require("node-telegram-bot-api");
const {
  normalizeFancyText,
  compactForWordMatch,
  matchesBannedWord,
  isUsableBannedCompact,
} = require("./normalizeFancyText");

const database = new DatabaseSync("/app/data/database.db");

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(telegramBotToken, { polling: true });

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

let linkAlert = "PROIBIDO LINKS NO GRUPO!";
let forwardMessageAlert = "PROIBIDO ENCAMINHA MENSAGEM";

const adminsCache = new Map();
const ADMINS_TTL = 5 * 60 * 1000;
const configuredReportThreshold = Number.parseInt(
  process.env.REPORT_THRESHOLD || "3",
  10,
);
const REPORT_THRESHOLD =
  Number.isInteger(configuredReportThreshold) && configuredReportThreshold > 0
    ? configuredReportThreshold
    : 3;


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

database.exec(`CREATE TABLE IF NOT EXISTS restricoes (
  id INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  reason TEXT NOT NULL,
  chat_id INTEGER NOT NULL
) STRICT
`);

database.exec(`CREATE TABLE IF NOT EXISTS reports (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  target_user_id INTEGER,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id, reporter_id)
) STRICT
`);

database.exec(`CREATE TABLE IF NOT EXISTS reportadores_autorizados (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  authorized_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
) STRICT
`);

database.exec(`CREATE TABLE IF NOT EXISTS membros_conhecidos (
  chat_id INTEGER NOT NULL,
  chat_title TEXT,
  user_id INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
) STRICT
`);

function trackKnownMember(msg) {
  if (
    (msg.chat.type !== "group" && msg.chat.type !== "supergroup") ||
    !msg.from ||
    msg.from.is_bot
  ) {
    return;
  }

  try {
    database
      .prepare(
        `INSERT INTO membros_conhecidos
          (chat_id, chat_title, user_id, username, first_name, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, user_id) DO UPDATE SET
          chat_title = excluded.chat_title,
          username = excluded.username,
          first_name = excluded.first_name,
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        msg.chat.id,
        msg.chat.title || "Grupo sem nome",
        msg.from.id,
        msg.from.username || null,
        msg.from.first_name || null,
        Date.now(),
      );
  } catch (err) {
    console.error("Erro ao registrar membro conhecido:", err.message);
  }
}

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

bot.onText(/\/banir (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const palavra = normalizeFancyText(match[1]).trim();
  if (!isUsableBannedCompact(compactForWordMatch(palavra))) {
    return;
  }

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

async function canManageReporters(msg) {
  const admins = await GetGroupAdmins(msg);
  return (
    admins.includes(msg.from.id) ||
    (msg.sender_chat && msg.sender_chat.id === msg.chat.id)
  );
}

bot.onText(/\/permitirreport(?:@\w+)?(?:\s|$)/i, async (msg) => {
  const chatId = msg.chat.id;
  const target = msg.reply_to_message?.from;

  if (!(await canManageReporters(msg))) return;

  if (!target || target.is_bot) {
    await bot
      .sendMessage(
        chatId,
        "Responda à mensagem de um usuário com /permitirreport.",
      )
      .catch((err) => console.error("Erro ao responder permissão:", err.message));
    return;
  }

  const username = target.username || target.first_name || "sem nome";
  database
    .prepare(
      "INSERT OR REPLACE INTO reportadores_autorizados (chat_id, user_id, username, authorized_at) VALUES (?, ?, ?, ?)",
    )
    .run(chatId, target.id, username, Date.now());

  await bot
    .sendMessage(chatId, `${username} agora pode registrar denúncias válidas.`)
    .catch((err) => console.error("Erro ao confirmar permissão:", err.message));
});

bot.onText(/\/removerreport(?:@\w+)?(?:\s|$)/i, async (msg) => {
  const chatId = msg.chat.id;
  const target = msg.reply_to_message?.from;

  if (!(await canManageReporters(msg))) return;

  if (!target || target.is_bot) {
    await bot
      .sendMessage(
        chatId,
        "Responda à mensagem de um usuário com /removerreport.",
      )
      .catch((err) => console.error("Erro ao responder remoção:", err.message));
    return;
  }

  const username = target.username || target.first_name || "sem nome";
  database
    .prepare(
      "DELETE FROM reportadores_autorizados WHERE chat_id = ? AND user_id = ?",
    )
    .run(chatId, target.id);
  database
    .prepare("DELETE FROM reports WHERE chat_id = ? AND reporter_id = ?")
    .run(chatId, target.id);

  await bot
    .sendMessage(chatId, `${username} não pode mais registrar denúncias válidas.`)
    .catch((err) => console.error("Erro ao confirmar remoção:", err.message));
});

bot.onText(/\/report(?:@\w+)?(?:\s|$)/i, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    await bot
      .sendMessage(chatId, "O comando /report só pode ser usado em grupos.")
      .catch((err) => console.error("Erro ao responder report:", err.message));
    return;
  }

  const target = msg.reply_to_message;
  if (!target) {
    await bot
      .sendMessage(
        chatId,
        "Para denunciar, responda à postagem com o comando /report.",
      )
      .catch((err) => console.error("Erro ao responder report:", err.message));
    return;
  }

  const reporterId = msg.from.id;
  const targetUserId = target.from?.id ?? null;

  const isAuthorizedReporter = database
    .prepare(
      "SELECT 1 FROM reportadores_autorizados WHERE chat_id = ? AND user_id = ?",
    )
    .get(chatId, reporterId);

  if (!isAuthorizedReporter) {
    await bot
      .sendMessage(
        chatId,
        "Sua denúncia não foi contabilizada. Somente usuários autorizados podem denunciar.",
      )
      .catch((err) => console.error("Erro ao responder report:", err.message));
    return;
  }

  if (targetUserId === reporterId) {
    await bot
      .sendMessage(chatId, "Você não pode denunciar a própria postagem.")
      .catch((err) => console.error("Erro ao responder report:", err.message));
    return;
  }

  const admins = await GetGroupAdmins(msg);
  const isAnonymousAdmin = target.sender_chat?.id === chatId;
  const isAdminPost =
    isAnonymousAdmin || (targetUserId !== null && admins.includes(targetUserId));

  if (isAdminPost) {
    await bot
      .sendMessage(chatId, "Postagens de administradores não podem ser removidas por denúncias.")
      .catch((err) => console.error("Erro ao responder report:", err.message));
    return;
  }

  try {
    const result = database
      .prepare(
        "INSERT OR IGNORE INTO reports (chat_id, message_id, reporter_id, target_user_id, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        chatId,
        target.message_id,
        reporterId,
        targetUserId,
        Date.now(),
      );

    if (result.changes === 0) {
      await bot.sendMessage(chatId, "Você já denunciou esta postagem.");
      return;
    }

    const report = database
      .prepare(
        "SELECT COUNT(*) AS total FROM reports WHERE chat_id = ? AND message_id = ?",
      )
      .get(chatId, target.message_id);

    if (report.total >= REPORT_THRESHOLD) {
      await bot.deleteMessage(chatId, target.message_id);
      database
        .prepare("DELETE FROM reports WHERE chat_id = ? AND message_id = ?")
        .run(chatId, target.message_id);
      insertLog("removida_por_reports", target);
      await bot.sendMessage(
        chatId,
        `Postagem removida após ${report.total} denúncias.`,
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `Denúncia registrada (${report.total}/${REPORT_THRESHOLD}).`,
    );
  } catch (err) {
    console.error("Erro ao processar report:", err.message);
    await bot
      .sendMessage(chatId, "Não foi possível processar a denúncia agora.")
      .catch((sendErr) =>
        console.error("Erro ao responder report:", sendErr.message),
      );
  } finally {
    bot
      .deleteMessage(chatId, msg.message_id)
      .catch((err) => console.error("Erro ao apagar comando report:", err.message));
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;


  trackKnownMember(msg);

  if (msg.new_chat_members) {
    bot.deleteMessage(chatId, messageId).catch((err) => {
      console.error("Erro ao apagar mensagem:", err);
    });
    return;
  }

  if (msg.left_chat_member) {
    bot.deleteMessage(chatId, messageId).catch((err) => {
      console.error("Erro ao apagar mensagem de saída:", err);
    });
    return;
  }

  // Cada mensagem segue apenas a primeira regra aplicável nesta prioridade:
  // encaminhamento, palavra proibida e link.
  if (messageIsForwarded(msg)) {
    insertLog("encaminhamento", msg);
    DeleteGroupMessage(msg, forwardMessageAlert);
    return;
  }

  const rawContent = msg.text || msg.caption || "";
  if (rawContent) {
    const proibidas = getProibidas();

    for (const palavra of proibidas) {
      const banned = matchesBannedWord(rawContent, palavra);
      if (banned) {
        console.log("Palavra proibida detectada:", banned);
        insertLog("palavra_proibida", msg);
        DeleteGroupMessage(msg, "MENSAGEM APAGADA!");
        restrictChatMember(msg, 86400, `Palavra proibida: ${banned}`);
        return;
      }
    }
  }

  if (messageHasLink(msg)) {
    insertLog("link", msg);
    DeleteGroupMessage(msg, linkAlert);
    restrictChatMember(msg, 500000, "Envio de link proibido");
  }
});

function messageHasLink(msg) {
  const linkTypes = new Set(["url", "text_link"]);
  const entities = [
    ...(msg.entities || []),
    ...(msg.caption_entities || []),
  ];
  return entities.some((entity) => linkTypes.has(entity.type));
}

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

function restrictChatMember(msg, duration = 86400, reason = "Motivo não informado") {
  const seconds = Math.floor(Date.now() / 1000);

  bot
    .restrictChatMember(msg.chat.id, msg.from.id, {
      can_send_messages: false,
      until_date: seconds + duration,
    })
    .then(() => {
      const username =
        msg.from?.username || msg.from?.first_name || "desconhecido";
      database
        .prepare(
          "INSERT INTO restricoes (timestamp, user_id, username, reason, chat_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run(Date.now(), msg.from.id, username, reason, msg.chat.id);
    })
    .catch((err) => console.error("Erro ao restringir membro:", err.message));
}

function messageIsForwarded(msg) {
  return Boolean(
    msg.forward_origin ||
      msg.forward_from ||
      msg.forward_from_chat ||
      msg.forward_sender_name ||
      msg.forward_date,
  );
}
