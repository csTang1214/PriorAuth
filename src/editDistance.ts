/**
 * Plain Levenshtein distance — draft letters are a few hundred words, not
 * novels, so an O(n·m) DP table is fast enough and keeps this dependency-free.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  let currRow = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * Raw edit distance divided by the generated text's length, so "how much
 * did staff change this" is comparable across drafts of different lengths.
 * Fast reward signal for Phase 5 (spec §4.4) — Phase 4's job is just to
 * capture this honestly; Phase 5 decides how to weight/interpret it.
 */
export function normalizedEditDistance(generated: string, final: string): number {
  if (generated.length === 0) return final.length === 0 ? 0 : 1;
  return levenshtein(generated, final) / generated.length;
}
