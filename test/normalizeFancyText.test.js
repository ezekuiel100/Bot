const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MIN_BANNED_WORD_LENGTH,
  compactForWordMatch,
  isUsableBannedCompact,
  matchesBannedWord,
  normalizeFancyText,
} = require("../normalizeFancyText");

test("normalizeFancyText converte estilos Unicode e caixa", () => {
  const cases = [
    ["𝐠𝐫𝐮𝐩𝐨", "grupo"],
    ["𝙂𝙍𝙐𝙋𝙊", "grupo"],
    ["ＧＲＵＰＯ", "grupo"],
    ["Grupo VIP", "grupo vip"],
    ["ℂℍℕℙℚℝℤ", "chnpqrz"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeFancyText(input), expected, input);
  }
});

test("normalizeFancyText preserva emojis e sequências relacionadas", () => {
  const cases = ["👶", "🇧🇷", "©️", "👨‍👩‍👧‍👦", "🅿️"];

  for (const value of cases) {
    assert.equal(normalizeFancyText(value), value, value);
  }
});

test("normalizeFancyText faz coerção segura de entradas não string", () => {
  assert.equal(normalizeFancyText(null), "null");
  assert.equal(normalizeFancyText(undefined), "undefined");
  assert.equal(normalizeFancyText(123), "123");
});

test("compactForWordMatch remove separadores e caracteres invisíveis", () => {
  const cases = [
    ["g.r.u.p.o", "grupo"],
    ["g r u p o", "grupo"],
    ["g\nr\nu\np\no", "grupo"],
    ["g\u200Br\u200Cu\u200Dp\u2060o", "grupo"],
    ["𝐠-𝐫_𝐮/𝐩.𝐨", "grupo"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(compactForWordMatch(input), expected, input);
  }
});

test("compactForWordMatch preserva emojis relevantes", () => {
  assert.equal(compactForWordMatch("oi 👨‍👩‍👧‍👦!"), "oi👨‍👩‍👧‍👦");
  assert.equal(compactForWordMatch("🇧🇷"), "🇧🇷");
  assert.equal(compactForWordMatch("©️"), "©");
});

test("isUsableBannedCompact rejeita regras vazias ou curtas", () => {
  assert.equal(MIN_BANNED_WORD_LENGTH, 2);
  assert.equal(isUsableBannedCompact(""), false);
  assert.equal(isUsableBannedCompact("a"), false);
  assert.equal(isUsableBannedCompact("ab"), true);
  assert.equal(isUsableBannedCompact("👶"), true);
});

test("matchesBannedWord encontra palavras completas", () => {
  const cases = [
    ["entre no grupo", "grupo"],
    ["GRUPO", "grupo"],
    ["acesse o 𝐠𝐫𝐮𝐩𝐨!", "grupo"],
    ["(grupo)", "grupo"],
    ["um grupo, por favor", "grupo"],
  ];

  for (const [message, banned] of cases) {
    assert.equal(matchesBannedWord(message, banned), "grupo", message);
  }
});

test("matchesBannedWord não confunde palavra com substring", () => {
  const messages = ["grupos", "subgrupo", "agrupou", "meugrupo"];

  for (const message of messages) {
    assert.equal(matchesBannedWord(message, "grupo"), null, message);
  }
});

test("matchesBannedWord detecta evasão com letras separadas", () => {
  const messages = [
    "g.r.u.p.o",
    "g r u p o",
    "g\nr\nu\np\no",
    "g\u200Br\u200Cu\u200Dp\u2060o",
    "𝐠.𝐫.𝐮.𝐩.𝐨",
  ];

  for (const message of messages) {
    assert.equal(matchesBannedWord(message, "grupo"), "grupo", message);
  }
});

test("matchesBannedWord exige a sequência completa na evasão", () => {
  assert.equal(matchesBannedWord("g.r.u.p", "grupo"), null);
  assert.equal(matchesBannedWord("g.r.u.p.o.s", "grupo"), null);
  assert.equal(matchesBannedWord("g.x.r.u.p.o", "grupo"), null);
});

test("matchesBannedWord encontra frases por sequência de tokens", () => {
  const messages = [
    "entre no grupo vip agora",
    "GRUPO   VIP",
    "grupo\nvip",
    "grupo - vip",
    "um 𝐠𝐫𝐮𝐩𝐨, 𝐯𝐢𝐩 exclusivo",
  ];

  for (const message of messages) {
    assert.equal(matchesBannedWord(message, "grupo vip"), "grupo vip", message);
  }
});

test("matchesBannedWord preserva os limites e a ordem de frases", () => {
  const messages = [
    "grupos vip",
    "subgrupo vip",
    "grupo muito vip",
    "vip grupo",
    "grupo",
  ];

  for (const message of messages) {
    assert.equal(matchesBannedWord(message, "grupo vip"), null, message);
  }
});

test("matchesBannedWord encontra emojis e sequências exatas", () => {
  const cases = [
    ["não envie 👶 aqui", "👶", "👶"],
    ["bandeira 🇧🇷 detectada", "🇧🇷", "🇧🇷"],
    ["família 👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦"],
    ["copyright ©️", "©️", "©"],
  ];

  for (const [message, banned, expected] of cases) {
    assert.equal(matchesBannedWord(message, banned), expected, message);
  }
});

test("matchesBannedWord não encontra emoji ausente ou sequência parcial", () => {
  assert.equal(matchesBannedWord("somente texto", "👶"), null);
  assert.equal(matchesBannedWord("👨‍👩‍👧", "👨‍👩‍👧‍👦"), null);
  assert.equal(matchesBannedWord("🇵🇹", "🇧🇷"), null);
});

test("matchesBannedWord ignora regras inválidas", () => {
  const invalidRules = ["", " ", "!!!", "a", ".a.", null];

  for (const banned of invalidRules) {
    assert.equal(matchesBannedWord("a null !!!", banned), null, String(banned));
  }
});
