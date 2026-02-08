const { mkdirSync } = require('node:fs');
mkdirSync('./data', { recursive: true });

const { DatabaseSync } = require('node:sqlite');
const TelegramBot = require("node-telegram-bot-api")

const database = new DatabaseSync('./data/database.db');

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
// const telegramBotToken = process.env.token;

const bot = new TelegramBot(telegramBotToken, { polling: true });

let linkAlert = "PROIBIDO LINKS NO GRUPO!";
let forwardMessageAlert = "PROIBIDO ENCAMINHA MENSAGEM";


database.exec(`CREATE TABLE IF NOT EXISTS proibidas (
  key INTEGER PRIMARY KEY,
  value TEXT UNIQUE
) STRICT
`)

// Matches "/banir [palavra]"
bot.onText(/\/banir (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const palavra = match[1].toLowerCase().trim();

    const admins = await GetGroupAdmins(msg)
    const isAnonymousAdmin = (userId === 1087968824 && msg.sender_chat && msg.sender_chat.id === chatId);

    if (admins.includes(userId) || isAnonymousAdmin) {
        try {
            const insert = database.prepare("INSERT INTO proibidas (value) VALUEs (?)")
            insert.run(palavra)
            console.log("Nova palavra proibida adicionada")
        } catch (err) {


            console.log(err.message)
        }
    }
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    if (msg.new_chat_members) {
        bot.deleteMessage(chatId, messageId).catch((err) => {
            console.error('Erro ao apagar mensagem:', err);
        });
    }

    if (msg.left_chat_member) {
        bot.deleteMessage(chatId, messageId).catch((err) => {
            console.error('Erro ao apagar mensagem de saída:', err);
        });
    }

    DeleteforwardMessage(msg);

    if (msg?.text) {
        const data = database.prepare("SELECT * FROM proibidas").all()
        const text = msg.text.toLowerCase()

        for (i = 0; i < data.length; i++) {
            if (text.includes(data[i].value)) {
                console.log("Palavra proibida:", data[i].value)
                console.log("Palavra proibida detectada:", text);
                DeleteGroupMessage(msg, "MENSAGEM APAGADA!");
                return
            }
        }
    }


    if (msg?.entities && msg.entities[0].type == "url") {
        DeleteGroupMessage(msg, linkAlert);
        return;
    }

    if (
        (msg.photo || msg.video) &&
        msg.caption_entities &&
        msg.caption_entities[0]?.type == "url"
    ) {
        DeleteGroupMessage(msg, linkAlert);
        return;
    }

});

function DeleteGroupMessage(msg, alertText) {
    GetGroupAdmins(msg).then((adm) => {
        try {
            if (adm.includes(msg.from.id) || msg.from.is_bot) return;

            bot.sendMessage(msg.chat.id, alertText);
            bot.deleteMessage(msg.chat.id, msg.message_id);
            restrictChatMember(msg);
        } catch (err) {
            console.log(err)
        }
    });
}

async function GetGroupAdmins(msg) {
    try {
        let admin = await bot.getChatAdministrators(msg.chat.id);
        return admin.map((adm) => adm.user.id);
    } catch (error) {
        console.log("Erro:" + error);
    }
}

function restrictChatMember(msg) {
    let senconds = Math.floor(Date.now() / 1000);

    bot.restrictChatMember(msg.chat.id, msg.from.id, {
        can_send_messages: false,
        until_date: senconds + 500000,
    });
}

function DeleteforwardMessage(msg) {
    if (msg.forward_from_chat) {
        DeleteGroupMessage(msg, forwardMessageAlert);
    }
}

