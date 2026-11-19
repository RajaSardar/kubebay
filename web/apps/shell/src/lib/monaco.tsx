import { lazy, Suspense, useEffect, useRef } from "react";
import type { DiffEditorProps, DiffOnMount, EditorProps, OnMount } from "@monaco-editor/react";
import { usePalette } from "./palette-store";

// @monaco-editor/react fetches Monaco from cdn.jsdelivr.net unless it is handed
// one, so an offline or air-gapped install would never get an editor. Every
// editor in the shell comes from here, which hands it the bundled copy first.
// Monaco stays in its own chunks, loaded the first time an editor mounts.

let ready: Promise<void> | undefined;

export function loadMonaco(): Promise<void> {
  ready ??= Promise.all([import("@monaco-editor/react"), import("./monacoBundle")]).then(([{ loader }, { monaco }]) => {
    loader.config({ monaco });
  });
  return ready;
}

const EditorLazy = lazy(() => loadMonaco().then(() => import("@monaco-editor/react")).then((m) => ({ default: m.Editor })));
const DiffEditorLazy = lazy(() =>
  loadMonaco().then(() => import("@monaco-editor/react")).then((m) => ({ default: m.DiffEditor })),
);

/**
 * Monaco starts its Cmd/Ctrl+K chords (comment, fold, ...) on that key and
 * stops the keydown, so the app's palette shortcut never saw it. Toggle the
 * palette from a capture listener on the editor (it runs before Monaco's own
 * handler) and as a Monaco command, so both routes reach the same store.
 */
function bindPaletteKey(editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1]) {
  const toggle = () => usePalette.getState().toggle();
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, toggle);
  editor.getContainerDomNode().addEventListener(
    "keydown",
    (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true,
  );
}

export default function Editor({ onMount, ...props }: EditorProps) {
  const mount: OnMount = (editor, monaco, ...rest) => {
    bindPaletteKey(editor, monaco);
    onMount?.(editor, monaco, ...rest);
  };
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <EditorLazy {...props} onMount={mount} />
    </Suspense>
  );
}

type DiffModels = ReturnType<Parameters<DiffOnMount>[0]["getModel"]>;

/**
 * @monaco-editor/react disposes a diff editor's models before the editor
 * itself, which Monaco reports as an uncaught "TextModel got disposed before
 * DiffEditorWidget model got reset". So it keeps them, and they're freed here
 * once the editor is gone.
 */
export function DiffEditor({ onMount, ...props }: DiffEditorProps) {
  const models = useRef<DiffModels>(null);
  useEffect(
    () => () => {
      const m = models.current;
      // Effects clean up parent first; the editor is disposed after this runs.
      if (m) setTimeout(() => (m.original.dispose(), m.modified.dispose()));
    },
    [],
  );
  const mount: DiffOnMount = (editor, monaco) => {
    models.current = editor.getModel();
    editor.onDidChangeModel(() => (models.current = editor.getModel() ?? models.current));
    const modified = editor.getModifiedEditor?.();
    if (modified) bindPaletteKey(modified, monaco);
    onMount?.(editor, monaco);
  };
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <DiffEditorLazy {...props} keepCurrentOriginalModel keepCurrentModifiedModel onMount={mount} />
    </Suspense>
  );
}
