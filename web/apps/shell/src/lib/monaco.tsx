import { lazy, Suspense, useEffect, useRef } from "react";
import type { DiffEditorProps, DiffOnMount, EditorProps } from "@monaco-editor/react";

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

export default function Editor(props: EditorProps) {
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <EditorLazy {...props} />
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
    onMount?.(editor, monaco);
  };
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <DiffEditorLazy {...props} keepCurrentOriginalModel keepCurrentModifiedModel onMount={mount} />
    </Suspense>
  );
}
