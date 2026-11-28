import "server-only";
import { getDb } from "@/src/lib/db";
import { readDbVocab, setVocabSource } from "@/src/lib/query/vocab";

/**
 * Lets the spelling vocabulary (src/lib/query/vocab.ts) read this app's database: the titles seen
 * in searches and the past queries. Once per process; never in tests (they use the static words).
 */
export function installDbVocab(): void {
  const g = globalThis as typeof globalThis & { __vocabDbInstalled?: boolean };
  if (g.__vocabDbInstalled || process.env.NODE_ENV === "test") return;
  g.__vocabDbInstalled = true;
  setVocabSource(() => readDbVocab(getDb()));
}
