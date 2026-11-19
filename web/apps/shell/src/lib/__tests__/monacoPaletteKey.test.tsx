import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { usePalette } from "../palette-store";

// Backlog 53: Monaco starts its Cmd+K chords (comment, fold, ...) on Cmd+K and
// stops the keydown, so the app-level listener never saw it.
vi.mock("../monacoBundle", () => ({ monaco: {} }));
const fake = vi.hoisted(() => {
  const state = { dom: document.createElement("div") };
  const editor = { addCommand: vi.fn(), getContainerDomNode: () => state.dom };
  const monaco = { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyK: 41 } };
  return { state, editor, monaco };
});
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  Editor: ({ onMount }: { onMount?: (e: unknown, m: unknown) => void }) => {
    onMount?.(fake.editor, fake.monaco);
    return <div />;
  },
  DiffEditor: () => <div />,
}));

import Editor from "../monaco";

beforeEach(() => {
  usePalette.setState({ open: false });
  fake.editor.addCommand.mockClear();
  fake.state.dom = document.createElement("div");
});

describe("Cmd/Ctrl+K inside a Monaco editor", () => {
  it("registers a command that toggles the palette", async () => {
    render(<Editor value="a: 1" />);
    await waitFor(() => expect(fake.editor.addCommand).toHaveBeenCalled());
    const [key, run] = fake.editor.addCommand.mock.calls[0] as [number, () => void];
    expect(key).toBe(2048 | 41);
    run();
    expect(usePalette.getState().open).toBe(true);
    run();
    expect(usePalette.getState().open).toBe(false);
  });

  it("catches the keydown before Monaco's chord handling can swallow it", async () => {
    render(<Editor value="a: 1" />);
    await waitFor(() => expect(fake.editor.addCommand).toHaveBeenCalled());
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    fake.state.dom.dispatchEvent(e);
    expect(usePalette.getState().open).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });
});
