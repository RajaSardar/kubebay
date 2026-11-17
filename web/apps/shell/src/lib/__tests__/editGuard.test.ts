import { describe, it, expect, afterEach } from "vitest";
import { setEditDirty, anyEditDirty, resetEditGuard } from "../editGuard";

afterEach(resetEditGuard);

describe("editGuard", () => {
  it("is clean until an editor reports a dirty edit", () => {
    expect(anyEditDirty()).toBe(false);
    setEditDirty("a", true);
    expect(anyEditDirty()).toBe(true);
  });

  it("stays dirty until every dirty editor is clean", () => {
    setEditDirty("a", true);
    setEditDirty("b", true);
    setEditDirty("a", false);
    expect(anyEditDirty()).toBe(true);
    setEditDirty("b", false);
    expect(anyEditDirty()).toBe(false);
  });
});
