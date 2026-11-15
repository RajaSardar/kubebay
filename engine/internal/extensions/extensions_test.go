package extensions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func errorsContain(t *testing.T, errs []string, want string) {
	t.Helper()
	for _, e := range errs {
		if strings.Contains(e, want) {
			return
		}
	}
	t.Fatalf("no error contains %q; got %q", want, errs)
}

func TestParseValidFile(t *testing.T) {
	doc := `
version: 1
columns:
  - resource: deployments.apps
    header: Team
    jsonPath: .metadata.labels.team
  - resource: nodepools.karpenter.sh
    header: Ready
    jsonPath: '{.status.conditions[?(@.type=="Ready")].status}'
actions:
  - resource: pods
    label: Open in Grafana
    url: https://grafana.example.com/d/pods?var-namespace={{namespace}}&var-pod={{name}}
  - resource: deployments
    label: Tail logs with stern
    run: stern -n {{namespace}} {{name}} --selector app={{label:app}}
    contexts: ["dev-*", kind-kind]
`
	f := Parse([]byte(doc))
	if len(f.Errors) != 0 {
		t.Fatalf("errors: %q", f.Errors)
	}
	if len(f.Columns) != 2 || len(f.Actions) != 2 {
		t.Fatalf("got %d columns, %d actions", len(f.Columns), len(f.Actions))
	}
	if f.Columns[0] != (Column{Resource: "deployments.apps", Header: "Team", JSONPath: ".metadata.labels.team"}) {
		t.Fatalf("column 0: %+v", f.Columns[0])
	}
	a := f.Actions[1]
	if a.Run == "" || a.URL != "" || len(a.Contexts) != 2 {
		t.Fatalf("action 1: %+v", a)
	}
}

func TestParseEmptyAndMissingVersion(t *testing.T) {
	if f := Parse([]byte("")); len(f.Errors) != 0 || len(f.Columns) != 0 {
		t.Fatalf("empty file: %+v", f)
	}
	f := Parse([]byte("columns:\n  - {resource: pods, header: Node, jsonPath: .spec.nodeName}\n"))
	if len(f.Errors) != 0 || len(f.Columns) != 1 {
		t.Fatalf("no version should default to 1: %+v", f)
	}
}

func TestParseRejectsOtherVersions(t *testing.T) {
	f := Parse([]byte("version: 2\ncolumns:\n  - {resource: pods, header: Node, jsonPath: .spec.nodeName}\n"))
	errorsContain(t, f.Errors, "version 2")
	if len(f.Columns) != 0 {
		t.Fatalf("a file of another version must not be half-applied: %+v", f.Columns)
	}
}

func TestParseYAMLSyntaxErrorNamesTheLine(t *testing.T) {
	f := Parse([]byte("columns:\n  - resource: pods\n   header: x\n"))
	errorsContain(t, f.Errors, "not valid YAML: line 2:")
}

func TestParseUnknownKeys(t *testing.T) {
	f := Parse([]byte(`
colums: []
columns:
  - resource: pods
    header: Node
    jsonpath: .spec.nodeName
  - resource: pods
    header: IP
    jsonPath: .status.podIP
`))
	errorsContain(t, f.Errors, `unknown top-level key "colums"`)
	errorsContain(t, f.Errors, `column 1: unknown field "jsonpath" (did you mean "jsonPath"?)`)
	// One bad entry doesn't take the rest of the file with it.
	if len(f.Columns) != 1 || f.Columns[0].Header != "IP" {
		t.Fatalf("columns: %+v", f.Columns)
	}
}

func TestColumnValidation(t *testing.T) {
	cases := map[string]string{
		`{header: X, jsonPath: .a}`:                                                 "resource is required",
		`{resource: Pods, header: X, jsonPath: .a}`:                                 "resource",
		`{resource: pods, jsonPath: .a}`:                                            "header is required",
		`{resource: pods, header: X}`:                                               "jsonPath is required",
		`{resource: pods, header: X, jsonPath: spec.nodeName}`:                      "jsonPath",
		`{resource: pods, header: X, jsonPath: '.spec.containers[*].image'}`:        "jsonPath",
		`{resource: pods, header: X, jsonPath: '.a..b'}`:                            "jsonPath",
		`{resource: secrets, header: X, jsonPath: .data.password}`:                  "secrets",
		`{resource: pods, header: "` + strings.Repeat("h", 41) + `", jsonPath: .a}`: "header",
	}
	for entry, want := range cases {
		f := Parse([]byte("columns:\n  - " + entry + "\n"))
		if len(f.Columns) != 0 {
			t.Errorf("%s: accepted", entry)
			continue
		}
		errorsContain(t, f.Errors, want)
	}
	for _, path := range []string{
		`.spec.containers[0].image`,
		`.metadata.labels.app\.kubernetes\.io/name`,
		`{.status.conditions[?(@.type=='Ready')].reason}`,
	} {
		f := Parse([]byte("columns:\n  - resource: pods\n    header: X\n    jsonPath: " + yamlQuote(path) + "\n"))
		if len(f.Errors) != 0 || len(f.Columns) != 1 {
			t.Errorf("%s: %q", path, f.Errors)
		}
	}
	// Secrets columns may read metadata: the table never loads Secret data.
	f := Parse([]byte("columns:\n  - {resource: secrets, header: Owner, jsonPath: .metadata.labels.owner}\n"))
	if len(f.Errors) != 0 || len(f.Columns) != 1 {
		t.Fatalf("secrets metadata column: %+v", f)
	}
}

func TestActionValidation(t *testing.T) {
	cases := map[string]string{
		`{label: X, url: "https://a.example/{{name}}"}`:                          "resource is required",
		`{resource: pods, url: "https://a.example/{{name}}"}`:                    "label is required",
		`{resource: pods, label: X}`:                                             "one of url or run",
		`{resource: pods, label: X, url: "https://a.example/", run: "echo"}`:     "one of url or run",
		`{resource: pods, label: X, url: "javascript:alert(1)"}`:                 "http:// or https://",
		`{resource: pods, label: X, url: "{{annotation:link}}"}`:                 "http:// or https://",
		`{resource: pods, label: X, url: "https://{{label:team}}.example.com/"}`: "host",
		`{resource: pods, label: X, url: "https://a.example/{{Name}}"}`:          `unknown placeholder "{{Name}}"`,
		`{resource: pods, label: X, url: "https://a.example/{{ .Name }}"}`:       "unknown placeholder",
		`{resource: pods, label: X, url: "https://a.example/{{name"}`:            "unclosed",
		`{resource: pods, label: X, url: "https://a.example/{{label:}}"}`:        "label key",
		`{resource: pods, label: X, run: "echo '{{name}}'"}`:                     "inside quotes",
		`{resource: pods, label: X, run: 'echo "{{name}}"'}`:                     "inside quotes",
		`{resource: pods, label: X, run: 'echo \{{name}}'}`:                      "backslash",
		`{resource: pods, label: X, run: 'echo ${{name}}'}`:                      "$",
		`{resource: pods, label: X, run: "echo {{name}}\nrm -rf ~"}`:             "one line",
		`{resource: pods, label: X, run: "echo {{name}}", contexts: [""]}`:       "contexts",
	}
	for entry, want := range cases {
		f := Parse([]byte("actions:\n  - " + entry + "\n"))
		if len(f.Actions) != 0 {
			t.Errorf("%s: accepted", entry)
			continue
		}
		errorsContain(t, f.Errors, want)
	}
}

func TestRunTemplatesThatAreFine(t *testing.T) {
	for _, run := range []string{
		`kubectl -n {{namespace}} describe {{kind}} {{name}}`,
		`stern --context={{context}} {{name}}`,
		`echo 'quoted text' {{name}} "more text"`,
		`k9s -n {{namespace}}`,
		`echo it\'s {{annotation:example.com/owner}}`,
		`open $(printf %s {{name}})`,
	} {
		f := Parse([]byte("actions:\n  - resource: pods\n    label: X\n    run: " + yamlQuote(run) + "\n"))
		if len(f.Errors) != 0 || len(f.Actions) != 1 {
			t.Errorf("%s: %q", run, f.Errors)
		}
	}
}

func yamlQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func TestNestedQuotesAreRefused(t *testing.T) {
	// "$(…)" starts a new quoting context inside double quotes. Kubebay doesn't
	// follow that, so it refuses rather than guess.
	f := Parse([]byte("actions:\n  - resource: pods\n    label: X\n    run: " + yamlQuote(`open "$(printf %s {{name}})"`) + "\n"))
	errorsContain(t, f.Errors, "inside quotes")
}

func TestYAMLBooleansReadAsText(t *testing.T) {
	// YAML 1.1 reads a bare N as false; say what was expected.
	f := Parse([]byte("columns:\n  - {resource: pods, header: N, jsonPath: .spec.nodeName}\n"))
	errorsContain(t, f.Errors, "column 1: header must be text")
}

func TestLimits(t *testing.T) {
	var b strings.Builder
	b.WriteString("columns:\n")
	for i := 0; i < maxEntries+1; i++ {
		b.WriteString("  - {resource: pods, header: Node, jsonPath: .spec.nodeName}\n")
	}
	f := Parse([]byte(b.String()))
	errorsContain(t, f.Errors, "at most 100 columns")
	if len(f.Columns) != maxEntries {
		t.Fatalf("got %d columns", len(f.Columns))
	}
}

func TestLoad(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "extensions.yaml")

	f := Load(p)
	if f.Exists || f.Path != p || len(f.Errors) != 0 {
		t.Fatalf("missing file: %+v", f)
	}

	if err := os.WriteFile(p, []byte("columns:\n  - {resource: pods, header: Node, jsonPath: .spec.nodeName}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	f = Load(p)
	if !f.Exists || len(f.Columns) != 1 {
		t.Fatalf("file: %+v", f)
	}

	big := make([]byte, maxFileBytes+1)
	if err := os.WriteFile(p, big, 0o600); err != nil {
		t.Fatal(err)
	}
	f = Load(p)
	errorsContain(t, f.Errors, "larger than")

	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(p, 0o700); err != nil {
		t.Fatal(err)
	}
	f = Load(p)
	if !f.Exists || len(f.Errors) == 0 {
		t.Fatalf("a directory at the path should be an error: %+v", f)
	}
}
