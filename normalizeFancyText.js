/**
 * Converte letras "bonitas" (bold/italic/fullwidth/etc.) para ASCII normal.
 * Ex.: "𝐠𝐫𝐮𝐩𝐨" -> "grupo"
 * Sem isso, includes("grupo") nunca encontra a palavra em fonte Unicode.
 */
function normalizeFancyText(text) {
  let result = "";

  for (const char of String(text).normalize("NFKC")) {
    const cp = char.codePointAt(0);

    // Mathematical Alphanumeric Symbols: vários estilos de A-Z / a-z
    const mathUpperStarts = [
      0x1d400, 0x1d434, 0x1d468, 0x1d49c, 0x1d4d0, 0x1d504, 0x1d56c, 0x1d5a0,
      0x1d5d4, 0x1d608, 0x1d63c, 0x1d670,
    ];
    const mathLowerStarts = [
      0x1d41a, 0x1d44e, 0x1d482, 0x1d4b6, 0x1d4ea, 0x1d51e, 0x1d552, 0x1d586,
      0x1d5ba, 0x1d5ee, 0x1d622, 0x1d656, 0x1d68a,
    ];

    let mapped = null;

    for (const start of mathUpperStarts) {
      if (cp >= start && cp <= start + 25) {
        mapped = String.fromCharCode(65 + (cp - start));
        break;
      }
    }

    if (!mapped) {
      for (const start of mathLowerStarts) {
        if (cp >= start && cp <= start + 25) {
          mapped = String.fromCharCode(97 + (cp - start));
          break;
        }
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

    if (!mapped && specials[cp]) mapped = specials[cp];

    result += mapped || char;
  }

  return result.toLowerCase();
}

/**
 * Junta letras quebradas por espaço, linha, pontuação ou caracteres invisíveis.
 * Ex.: "G\\nR\\nU\\nP\\nO\\nS" e "g.r.u.p.o.s" -> "grupos"
 */
function compactForWordMatch(text) {
  return normalizeFancyText(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

module.exports = { normalizeFancyText, compactForWordMatch };
