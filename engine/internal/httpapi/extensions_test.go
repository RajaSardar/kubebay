package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type extensionsGot struct {
	Path    string `json:"path"`
	Exists  bool   `json:"exists"`
	Columns []struct {
		Resource string `json:"resource"`
	} `json:"columns"`
	Actions []struct {
		Label string `json:"label"`
		Run   string `json:"run"`
	} `json:"actions"`
	Errors   []string `json:"errors"`
	Disabled string   `json:"disabled"`
	Commands struct {
		Available bool   `json:"available"`
		Reason    string `json:"reason"`
	} `json:"commands"`
}

func getExtensions(t *testing.T, api *ExtensionsAPI) extensionsGot {
	t.Helper()
	h := Router(Deps{Extensions: api}, "secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/extensions", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the token: %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/extensions", nil)
	req.Header.Set("X-Kubebay-Token", "secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var got extensionsGot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

// KB-13: the file is read on every request, so an edit shows up without a
// restart, and a command action is marked runnable only where the local shell is.
func TestExtensionsServesTheFileAndCommandAvailability(t *testing.T) {
	p := filepath.Join(t.TempDir(), "extensions.yaml")
	api := &ExtensionsAPI{Path: p, LocalShell: func() LocalShellStatus { return LocalShellStatus{Available: true, Enabled: true, Shell: "zsh"} }}

	got := getExtensions(t, api)
	if got.Exists || got.Path != p || !got.Commands.Available || len(got.Columns) != 0 {
		t.Fatalf("no file yet: %+v", got)
	}

	doc := "actions:\n  - resource: pods\n    label: Logs\n    run: stern {{name}}\n  - {resource: pods, label: Bad}\n"
	if err := os.WriteFile(p, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	got = getExtensions(t, api)
	if !got.Exists || len(got.Actions) != 1 || got.Actions[0].Run != "stern {{name}}" || len(got.Errors) != 1 {
		t.Fatalf("after writing the file: %+v", got)
	}

	api.LocalShell = func() LocalShellStatus {
		return LocalShellStatus{Enabled: true, Reason: "this engine was built without the localshell tag"}
	}
	got = getExtensions(t, api)
	if got.Commands.Available || !strings.Contains(got.Commands.Reason, "localshell tag") {
		t.Fatalf("no local shell: %+v", got.Commands)
	}
	api.LocalShell = func() LocalShellStatus { return LocalShellStatus{} }
	got = getExtensions(t, api)
	if got.Commands.Available || !strings.Contains(got.Commands.Reason, "--local-shell") {
		t.Fatalf("local shell not asked for: %+v", got.Commands)
	}
}

// Values are quoted for POSIX shells and fish; a shell that quotes some other
// way doesn't get command actions at all.
func TestExtensionCommandsOnlyForShellsKubebayQuotesFor(t *testing.T) {
	for shell, ok := range map[string]bool{"bash": true, "zsh": true, "sh": true, "dash": true, "ksh": true, "fish": true, "nu": false, "pwsh": false, "xonsh": false, "": false} {
		api := &ExtensionsAPI{Path: filepath.Join(t.TempDir(), "x.yaml"), LocalShell: func() LocalShellStatus { return LocalShellStatus{Available: true, Shell: shell} }}
		got := getExtensions(t, api)
		if got.Commands.Available != ok {
			t.Errorf("%q: available %v", shell, got.Commands.Available)
		}
		if !ok && shell != "" && !strings.Contains(got.Commands.Reason, shell) {
			t.Errorf("%q: reason %q doesn't name the shell", shell, got.Commands.Reason)
		}
	}
}

func TestExtensionsOffInServerModes(t *testing.T) {
	p := filepath.Join(t.TempDir(), "extensions.yaml")
	if err := os.WriteFile(p, []byte("columns:\n  - {resource: pods, header: Node, jsonPath: .spec.nodeName}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []struct{ inCluster, oidc bool }{{true, false}, {false, true}} {
		reason := ExtensionsBlockReason(mode.inCluster, mode.oidc)
		if reason == "" {
			t.Fatalf("%+v: no reason", mode)
		}
		got := getExtensions(t, &ExtensionsAPI{Path: p, Disabled: reason, LocalShell: func() LocalShellStatus { return LocalShellStatus{Available: true} }})
		if got.Disabled != reason || got.Path != "" || len(got.Columns) != 0 || got.Commands.Available {
			t.Errorf("%+v: %+v", mode, got)
		}
	}
	if ExtensionsBlockReason(false, false) != "" {
		t.Error("desktop mode is blocked")
	}
}
