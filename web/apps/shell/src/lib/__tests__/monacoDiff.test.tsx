import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

// A stand-in for @monaco-editor/react's DiffEditor that unmounts the way the real
// one does: it disposes both models, unless told to keep them, then the editor.
// Like Monaco, a model disposed while the editor still holds it is a bug.
const log = vi.hoisted(() => [] as string[]);
vi.mock("@monaco-editor/react", () => {
  const model = (name: string, editor: { disposed: boolean }) => ({
    dispose: () => {
      if (!editor.disposed) throw new Error(`${name} TextModel got disposed before DiffEditorWidget model got reset`);
      log.push(`${name} disposed`);
    },
  });
  return {
    loader: { config: () => {} },
    Editor: () => null,
    DiffEditor: (p: { keepCurrentOriginalModel?: boolean; keepCurrentModifiedModel?: boolean; onMount?: (e: unknown) => void }) => {
      useEffect(() => {
        const editor = { disposed: false } as { disposed: boolean; getModel: () => unknown; onDidChangeModel: () => unknown; dispose: () => void };
        const models = { original: model("original", editor), modified: model("modified", editor) };
        editor.getModel = () => (editor.disposed ? null : models);
        editor.onDidChangeModel = () => ({ dispose: () => {} });
        editor.dispose = () => {
          editor.disposed = true;
          log.push("editor disposed");
        };
        p.onMount?.(editor);
        return () => {
          if (!p.keepCurrentOriginalModel) models.original.dispose();
          if (!p.keepCurrentModifiedModel) models.modified.dispose();
          editor.dispose();
        };
      }, []);
      return <div data-testid="diff" />;
    },
  };
});
vi.mock("../monacoBundle", () => ({ monaco: {} }));

import { DiffEditor } from "../monaco";

describe("DiffEditor", () => {
  it("frees its models after the editor lets go of them, not before", async () => {
    const onMount = vi.fn();
    const view = render(<DiffEditor original="a: 1" modified="a: 2" language="yaml" onMount={onMount} />);
    await view.findByTestId("diff");
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(() => view.unmount()).not.toThrow();
    await waitFor(() => expect(log).toEqual(["editor disposed", "original disposed", "modified disposed"]));
  });
});
