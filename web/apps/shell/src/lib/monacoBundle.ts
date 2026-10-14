// Monaco from the app bundle: the editor API, its features (find, folding, the
// diff editor…) and YAML, the only language the shell edits. Not the package's
// main entry, which adds ~80 languages and the TypeScript, JSON, CSS and HTML
// workers.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/yaml/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };
