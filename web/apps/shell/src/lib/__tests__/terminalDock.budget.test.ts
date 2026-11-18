import { beforeEach, describe, expect, it } from "vitest";
import { EDIT_TEXT_BUDGET, MIN_TAB_CHARS, editTextUsed, useTerminalDock } from "../terminalDock";
import { resetEditGuard } from "../editGuard";

// Backlog 51 phase 3/5: the tab cap is a budget of editor text, not a count.
const o = (name: string) => ({ cluster: "c1", gvr: "v1/configmaps", ns: "d", name });
const st = () => useTerminalDock.getState();

beforeEach(() => {
  resetEditGuard();
  useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", sizes: {}, capMessage: null });
});

describe("edit tab text budget", () => {
  it("counts a tab at least MIN_TAB_CHARS before its text has loaded", () => {
    st().openEditTab(o("a"));
    expect(editTextUsed(st().tabs, st().sizes)).toBe(MIN_TAB_CHARS);
  });

  it("opens many small tabs (no fixed count of 8)", () => {
    for (let i = 0; i < 12; i++) st().openEditTab(o(`n${i}`));
    expect(st().tabs).toHaveLength(12);
    expect(st().capMessage).toBeNull();
  });

  it("refuses a new tab once the open ones hold the budget, and says why", () => {
    st().openEditTab(o("big"));
    st().reportSize("c1/v1/configmaps/d/big", EDIT_TEXT_BUDGET);
    st().openEditTab(o("next"));
    expect(st().tabs.map((t) => t.name)).toEqual(["big"]);
    expect(st().capMessage).toMatch(/close a tab/i);
  });

  it("still focuses an already-open tab when over budget", () => {
    st().openEditTab(o("big"));
    st().openEditTab(o("small"));
    st().reportSize("c1/v1/configmaps/d/big", EDIT_TEXT_BUDGET);
    st().focusTab("shell");
    st().openEditTab(o("small"));
    expect(st().activeTab).toBe("c1/v1/configmaps/d/small");
  });

  it("frees the space when a tab closes and clears the message", () => {
    st().openEditTab(o("big"));
    st().reportSize("c1/v1/configmaps/d/big", EDIT_TEXT_BUDGET);
    st().openEditTab(o("next"));
    st().closeEditTab("c1/v1/configmaps/d/big");
    expect(st().capMessage).toBeNull();
    st().openEditTab(o("next"));
    expect(st().tabs).toHaveLength(1);
  });
});

describe("New resource tabs", () => {
  it("opens a tab with its own key, kind and text; each call is a new tab", () => {
    st().openNewTab({ kind: "Service", yaml: "kind: Service\n" });
    st().openNewTab({});
    const [a, b] = st().tabs;
    expect(a!.isNew).toBe(true);
    expect(a!.newKind).toBe("Service");
    expect(a!.newYaml).toBe("kind: Service\n");
    expect(a!.key).not.toBe(b!.key);
    expect(st().activeTab).toBe(b!.key);
    expect(st().open).toBe(true);
  });

  it("is held to the same budget", () => {
    st().openEditTab(o("big"));
    st().reportSize("c1/v1/configmaps/d/big", EDIT_TEXT_BUDGET);
    st().openNewTab({});
    expect(st().tabs).toHaveLength(1);
    expect(st().capMessage).toBeTruthy();
  });
});
