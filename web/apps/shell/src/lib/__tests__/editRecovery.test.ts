import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, DRAFT_MAX_CHARS, readDraft, writeDraft } from "../editRecovery";

// Backlog 51 phase 3: dirty YAML text is kept per window so a reload or crash can offer it back.
beforeEach(() => sessionStorage.clear());

describe("edit drafts", () => {
  it("keeps a dirty edit by object key and reads it back", () => {
    writeDraft("c/v1/configmaps/d/x", { text: "a: 2\n", original: "a: 1\n" });
    expect(readDraft("c/v1/configmaps/d/x")).toEqual({ text: "a: 2\n", original: "a: 1\n" });
    expect(readDraft("c/v1/configmaps/d/other")).toBeNull();
  });

  it("is per window: it uses sessionStorage, never localStorage", () => {
    writeDraft("k", { text: "t", original: "o" });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });

  it("clears a draft", () => {
    writeDraft("k", { text: "t", original: "o" });
    clearDraft("k");
    expect(readDraft("k")).toBeNull();
  });

  it("never stores a Secret", () => {
    writeDraft("c/v1/secrets/d/x", { text: "data: {a: c2VjcmV0}", original: "o" });
    expect(sessionStorage.length).toBe(0);
  });

  it("does not store text over the size cap, and drops the older draft for that key", () => {
    writeDraft("k", { text: "small", original: "o" });
    writeDraft("k", { text: "x".repeat(DRAFT_MAX_CHARS + 1), original: "o" });
    expect(readDraft("k")).toBeNull();
  });

  it("ignores a corrupt entry", () => {
    sessionStorage.setItem("kb.editdraft:k", "{not json");
    expect(readDraft("k")).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => writeDraft("k", { text: "t", original: "o" })).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
