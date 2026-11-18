/**
 * Unsaved YAML kept so a reload or crash can offer it back (backlog 51 phase 3).
 * sessionStorage, so it is per window (docs/MULTI_WINDOW.md) and gone when the
 * window closes. A Secret is never kept: its text may hold values. Text over
 * DRAFT_MAX_CHARS is not kept either, and the older draft for that object goes.
 */

export const DRAFT_MAX_CHARS = 200_000;
const PREFIX = "kb.editdraft:";

export interface EditDraft {
  /** The edited text. */
  text: string;
  /** What the editor had loaded when it was edited. */
  original: string;
}

const isSecretKey = (key: string) => key.includes("/v1/secrets/");

export function writeDraft(key: string, d: EditDraft): void {
  if (isSecretKey(key)) return;
  try {
    if (d.text.length > DRAFT_MAX_CHARS) {
      sessionStorage.removeItem(PREFIX + key);
      return;
    }
    sessionStorage.setItem(PREFIX + key, JSON.stringify(d));
  } catch {
    // Storage blocked or full: the edit just isn't recoverable.
  }
}

export function readDraft(key: string): EditDraft | null {
  if (isSecretKey(key)) return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<EditDraft>;
    return typeof d.text === "string" && typeof d.original === "string" ? { text: d.text, original: d.original } : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}
