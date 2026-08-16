import { describe, expect, it } from "vitest";
import { levenshtein, normalizedEditDistance } from "./editDistance";

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("hello world", "hello world")).toBe(0);
  });

  it("equals the length of a pure append", () => {
    const base = "The quick brown fox";
    const suffix = " jumps over the lazy dog";
    expect(levenshtein(base, base + suffix)).toBe(suffix.length);
  });

  it("equals the longer string's length when the other is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"));
  });

  it("counts a single substitution as distance 1", () => {
    expect(levenshtein("cat", "cot")).toBe(1);
  });
});

describe("normalizedEditDistance", () => {
  it("is 0 when the drafts are identical (approved unedited)", () => {
    const text = "Dear Aetna, this is a prior authorization request...";
    expect(normalizedEditDistance(text, text)).toBe(0);
  });

  it("is 0 for two empty strings", () => {
    expect(normalizedEditDistance("", "")).toBe(0);
  });

  it("is 1 when the generated text was empty but the final draft is not", () => {
    expect(normalizedEditDistance("", "hand-written from scratch")).toBe(1);
  });

  it("scales with edit size relative to the generated text's length", () => {
    const generated = "a".repeat(100);
    const lightlyEdited = generated + "bb"; // 2-char append on 100 chars
    const heavilyEdited = "completely different content entirely, nothing like the original";
    expect(normalizedEditDistance(generated, lightlyEdited)).toBeCloseTo(0.02, 5);
    expect(normalizedEditDistance(generated, heavilyEdited)).toBeGreaterThan(0.9);
  });
});
