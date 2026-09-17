function isEmojiRelated(char) {
  const cp = char.codePointAt(0);
  if (cp <= 0x7f) return false;
  if (
    cp === 0x200d ||
    cp === 0xfe0f ||
    cp === 0xfe0e ||
    cp === 0x20e3 ||
    cp === 0x00a9 ||
    cp === 0x00ae
  ) {
    return true;
  }
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return true;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true;
  if (cp >= 0x1f170 && cp <= 0x1f18d) return true;
  return /\p{Extended_Pictographic}/u.test(char);
}

function hasEmoji(text) {
  return [...String(text)].some(
    (char) =>
      isEmojiRelated(char) &&
      char.codePointAt(0) !== 0xfe0f &&
      char.codePointAt(0) !== 0xfe0e &&
      char.codePointAt(0) !== 0x200d,
  );
}

function mapFancyChar(char) {
  const cp = char.codePointAt(0);

  const mathUpperStarts = [
    0x1d400, 0x1d434, 0x1d468, 0x1d49c, 0x1d4d0, 0x1d504, 0x1d56c, 0x1d5a0,
    0x1d5d4, 0x1d608, 0x1d63c, 0x1d670,
  ];
  const mathLowerStarts = [
    0x1d41a, 0x1d44e, 0x1d482, 0x1d4b6, 0x1d4ea, 0x1d51e, 0x1d552, 0x1d586,
    0x1d5ba, 0x1d5ee, 0x1d622, 0x1d656, 0x1d68a,
  ];

  for (const start of mathUpperStarts) {
    if (cp >= start && cp <= start + 25) {
      return String.fromCharCode(65 + (cp - start));
    }
  }
  for (const start of mathLowerStarts) {
    if (cp >= start && cp <= start + 25) {
      return String.fromCharCode(97 + (cp - start));
    }
  }

  const specials = {
    0x2102: "C",
    0x210d: "H",
    0x2115: "N",
    0x2119: "P",
    0x211a: "Q",
    0x211d: "R",
    0x2124: "Z",
    0x212c: "B",
    0x2130: "E",
    0x2131: "F",
    0x210b: "H",
    0x2110: "I",
    0x2112: "L",
    0x2133: "M",
    0x211b: "R",
    0x212f: "e",
    0x210a: "g",
    0x2113: "l",
    0x2134: "o",
    0x210e: "h",
    0x1d455: "h",
  };

  return specials[cp] || char;
}

/**
 * Converte letras "bonitas" (bold/italic/fullwidth/etc.) para ASCII normal.
 * Ex.: "𝐠𝐫𝐮𝐩𝐨" -> "grupo"
 * Emojis (👶, 🇧🇷, ©️🅿️) são mantidos; NFKC não vira 🅿️ em "p".
 */
function normalizeFancyText(text) {
  let result = "";

  for (const char of String(text)) {
    if (isEmojiRelated(char)) {
      result += char;
      continue;
    }
    for (const piece of char.normalize("NFKC")) {
      result += mapFancyChar(piece);
    }
  }

  return result.toLowerCase();
}

/**
 * Junta letras quebradas por espaço, linha, pontuação ou caracteres invisíveis.
 * Ex.: "G\\nR\\nU\\nP\\nO\\nS" e "g.r.u.p.o.s" -> "grupos"
 */
function isCompactChar(char) {
  const cp = char.codePointAt(0);
  if (cp === 0xfe0f || cp === 0xfe0e) return false;
  if (/\p{L}|\p{N}/u.test(char)) return true;
  return isEmojiRelated(char);
}

function compactForWordMatch(text) {
  let result = "";
  for (const char of normalizeFancyText(text)) {
    if (isCompactChar(char)) result += char;
  }
  return result;
}

const MIN_BANNED_WORD_LENGTH = 2;

function isUsableBannedCompact(compact) {
  if (!compact) return false;
  if (hasEmoji(compact)) return true;
  return compact.length >= MIN_BANNED_WORD_LENGTH;
}

function messageTokens(text) {
  const tokens = [];
  let current = "";
  const flush = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (const char of normalizeFancyText(text)) {
    if (isCompactChar(char)) current += char;
    else flush();
  }
  flush();
  return tokens;
}

function joinedSingleLetterRuns(tokens) {
  const runs = [];
  let run = "";
  const flush = () => {
    if (run.length >= MIN_BANNED_WORD_LENGTH) runs.push(run);
    run = "";
  };
  for (const tok of tokens) {
    if (tok.length === 1) run += tok;
    else flush();
  }
  flush();
  return runs;
}

function matchesBannedWord(text, palavra) {
  const banned = compactForWordMatch(palavra);
  if (!isUsableBannedCompact(banned)) return null;

  if (hasEmoji(banned)) {
    return compactForWordMatch(text).includes(banned) ? banned : null;
  }

  const tokens = messageTokens(text);
  if (tokens.some((tok) => tok === banned)) return banned;

  if (joinedSingleLetterRuns(tokens).some((run) => run.includes(banned))) {
    return banned;
  }

  if (banned.length >= 4 && tokens.some((tok) => tok.includes(banned))) {
    return banned;
  }

  return null;
}

module.exports = {
  normalizeFancyText,
  compactForWordMatch,
  matchesBannedWord,
  isUsableBannedCompact,
  MIN_BANNED_WORD_LENGTH,
};
