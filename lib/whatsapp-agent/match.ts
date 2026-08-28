const FILLER = new Set([
  "a", "all", "any", "available", "containing", "find", "for", "give", "item", "items", "list", "me", "named", "of", "please", "product", "products", "show", "the", "with",
]);

function singular(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string, removeFiller = false) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !removeFiller || !FILLER.has(word))
    .map(singular);
}

function distance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column += 1) {
    let diagonal = rows[0];
    rows[0] = column;
    for (let row = 1; row <= left.length; row += 1) {
      const previous = rows[row];
      rows[row] = Math.min(rows[row] + 1, rows[row - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return rows[left.length];
}

function tokenScore(query: string, candidate: string) {
  if (query === candidate) return 30;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 22;
  if (candidate.includes(query) || query.includes(candidate)) return 16;
  const tolerance = query.length >= 8 ? 2 : query.length >= 4 ? 1 : 0;
  return tolerance && distance(query, candidate) <= tolerance ? 10 : 0;
}

export function rankedMatches<T>(query: string, rows: readonly T[], nameOf: (row: T) => string): T[] {
  const queryWords = words(query, true);
  if (queryWords.length === 0) return [];
  const queryPhrase = queryWords.join(" ");
  return rows
    .map((row, index) => {
      const nameWords = words(nameOf(row));
      const namePhrase = nameWords.join(" ");
      const scores = queryWords.map((queryWord) => Math.max(0, ...nameWords.map((nameWord) => tokenScore(queryWord, nameWord))));
      if (scores.some((score) => score === 0)) return { row, index, score: 0 };
      const phrase = namePhrase === queryPhrase ? 100 : namePhrase.startsWith(queryPhrase) ? 55 : namePhrase.includes(queryPhrase) ? 48 : 0;
      return { row, index, score: phrase + scores.reduce((sum, score) => sum + score, 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.row);
}

export function bestMatches<T>(query: string, rows: readonly T[], nameOf: (row: T) => string, limit = 5): T[] {
  const ranked = rankedMatches(query, rows, nameOf);
  if (ranked.length === 0) return [];
  const normalizedQuery = words(query, true).join(" ");
  const exact = ranked.filter((row) => words(nameOf(row)).join(" ") === normalizedQuery);
  return exact.length === 1 ? exact : ranked.slice(0, limit);
}

export function chooseFrom(label: string, names: string[]): string {
  return [`Which ${label}?`, ...names.map((name, index) => `${index + 1}. ${name}`), "Reply with number or name."].join("\n");
}
