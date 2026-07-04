// Block-art letterforms for SUPERHOT word slams — same 6-row weight as banners.ts.
// Sparse on purpose: add glyphs as new slam words need them.

const GLYPHS: Record<string, string[]> = {
  A: [" █████ ", "██   ██", "██   ██", "███████", "██   ██", "██   ██"],
  D: ["██████ ", "██   ██", "██   ██", "██   ██", "██   ██", "██████ "],
  E: ["███████", "██     ", "█████  ", "██     ", "██     ", "███████"],
  I: ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  ", "██████"],
  M: ["██   ██", "███ ███", "███████", "██ █ ██", "██   ██", "██   ██"],
  N: ["██   ██", "███  ██", "████ ██", "██ ████", "██  ███", "██   ██"],
  R: ["██████ ", "██   ██", "██████ ", "██  ██ ", "██   ██", "██   ██"],
  T: ["████████", "   ██   ", "   ██   ", "   ██   ", "   ██   ", "   ██   "],
  W: ["██   ██", "██   ██", "██ █ ██", "███████", "███ ███", "██   ██"],
  " ": ["    ", "    ", "    ", "    ", "    ", "    "],
};

export function renderBlock(word: string): string {
  const rows: string[] = [];
  for (let r = 0; r < 6; r += 1) {
    rows.push(
      [...word.toUpperCase()]
        .map((ch) => GLYPHS[ch]?.[r] ?? GLYPHS[" "]?.[r] ?? "")
        .join("  "),
    );
  }
  return rows.join("\n");
}
