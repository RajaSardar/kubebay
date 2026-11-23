package httpapi

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	rcommon "helm.sh/helm/v4/pkg/release/common"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

func tempAuditLog(t *testing.T) *audit.Logger {
	t.Helper()
	// os.UserConfigDir reads XDG_CONFIG_HOME on Linux but $HOME/Library/Application Support on macOS;
	// redirect both so the audit log never lands in the real one.
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("HOME", cfg)
	lg, err := audit.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lg.Close() })
	return lg
}

func asUser(r *http.Request, name string) *http.Request {
	return r.WithContext(clusters.WithIdentity(r.Context(), &clusters.Identity{Name: name}))
}

func getAudit(t *testing.T, h http.HandlerFunc, r *http.Request) []audit.Entry {
	t.Helper()
	rr := httptest.NewRecorder()
	h(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	var out []audit.Entry
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func actions(es []audit.Entry) string {
	var s []string
	for _, e := range es {
		s = append(s, e.Action)
	}
	return strings.Join(s, ",")
}

func seedAudit(lg *audit.Logger) {
	lg.Record(audit.Entry{Action: "scale", Cluster: "c1", User: "alice@example.com", GVR: "apps/v1/deployments", Namespace: "shop", Resource: "web"})
	lg.Record(audit.Entry{Action: "delete", Cluster: "c1", User: "bob@example.com", GVR: "v1/pods", Namespace: "shop", Resource: "web-1"})
	lg.Record(audit.Entry{Action: "drain", Cluster: "c1", User: "alice@example.com", GVR: "v1/nodes", Resource: "n1"})
}

func TestAuditHandler_LocalSeesAllAndFiltersByUserAndKind(t *testing.T) {
	lg := tempAuditLog(t)
	seedAudit(lg)
	h := auditHandler(lg)

	if got := actions(getAudit(t, h, httptest.NewRequest(http.MethodGet, "/api/audit", nil))); got != "scale,delete,drain" {
		t.Errorf("all = %s", got)
	}
	if got := actions(getAudit(t, h, httptest.NewRequest(http.MethodGet, "/api/audit?user=bob@example.com", nil))); got != "delete" {
		t.Errorf("?user=bob = %s", got)
	}
	if got := actions(getAudit(t, h, httptest.NewRequest(http.MethodGet, "/api/audit?kind=nodes", nil))); got != "drain" {
		t.Errorf("?kind=nodes = %s", got)
	}
	if got := actions(getAudit(t, h, httptest.NewRequest(http.MethodGet, "/api/audit?kind=apps/v1/deployments&resource=web", nil))); got != "scale" {
		t.Errorf("?kind=apps/v1/deployments&resource=web = %s", got)
	}
}

// There is no admin role in Kubebay, so an OIDC user only ever sees their own
// entries, whatever ?user= asks for.
func TestAuditHandler_OIDCUserSeesOnlyOwnEntries(t *testing.T) {
	lg := tempAuditLog(t)
	seedAudit(lg)
	lg.Record(audit.Entry{Action: "apply", Cluster: "c1", Namespace: "shop", Resource: "web"}) // local
	h := auditHandler(lg)

	alice := asUser(httptest.NewRequest(http.MethodGet, "/api/audit", nil), "alice@example.com")
	if got := actions(getAudit(t, h, alice)); got != "scale,drain" {
		t.Errorf("alice sees %s, want scale,drain", got)
	}
	snoop := asUser(httptest.NewRequest(http.MethodGet, "/api/audit?user=bob@example.com", nil), "alice@example.com")
	if got := getAudit(t, h, snoop); len(got) != 0 {
		t.Errorf("alice asking for bob's entries got %s, want none", actions(got))
	}
	carol := asUser(httptest.NewRequest(http.MethodGet, "/api/audit", nil), "carol@example.com")
	if got := getAudit(t, h, carol); got == nil || len(got) != 0 {
		t.Errorf("carol (no entries) got %v, want an empty list", got)
	}
}

func TestHelmRollbackRecordsUserAndKind(t *testing.T) {
	lg := tempAuditLog(t)
	h := memoryHelm(t, webRelease(1, rcommon.StatusSuperseded), webRelease(2, rcommon.StatusDeployed))
	h.Audit = lg
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"cluster":"c","ns":"shop","name":"web","revision":1}`))
	h.HandleRollback(rec, asUser(req, "alice@example.com"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got, _ := lg.Tail(1)
	if len(got) != 1 || got[0].User != "alice@example.com" || got[0].GVR != "helm/releases" {
		t.Fatalf("audit = %+v, want user alice and gvr helm/releases", got)
	}
}

func TestApplyYAMLRecordsUserAndGVR(t *testing.T) {
	c, _ := editChannels(t, liveDeployment(t))
	b, _ := json.Marshal(editBody(deployYAML, edit(deployYAML, "value: old-pwd", "value: s3cret-new"), false))
	rr := httptest.NewRecorder()
	c.HandleApplyYAML(rr, asUser(httptest.NewRequest(http.MethodPut, "/api/yaml", strings.NewReader(string(b))), "bob@example.com"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	got, _ := c.Audit.Tail(1)
	if len(got) != 1 || got[0].User != "bob@example.com" || got[0].GVR != "apps/v1/deployments" {
		t.Fatalf("audit = %+v, want user bob and gvr apps/v1/deployments", got)
	}
}

// Guards every audit call site in this package: each one records the acting
// user (RecordCtx, never Record) and says what kind it acted on (a GVR key in
// every audit.Entry literal), so a new handler can't quietly drop either.
func TestEveryAuditEntryCarriesUserAndKind(t *testing.T) {
	// Entries not about one Kubernetes object.
	noObject := map[string]bool{"local-shell": true}
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		file, err := parser.ParseFile(fset, f, src, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.CallExpr:
				if sel, ok := x.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Record" {
					if inner, ok := sel.X.(*ast.SelectorExpr); ok && inner.Sel.Name == "Audit" {
						t.Errorf("%s: Audit.Record drops the acting user; use Audit.RecordCtx(r.Context(), …)", fset.Position(x.Pos()))
					}
				}
			case *ast.CompositeLit:
				sel, ok := x.Type.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Entry" {
					return true
				}
				if pkg, ok := sel.X.(*ast.Ident); !ok || pkg.Name != "audit" {
					return true
				}
				keys := map[string]string{}
				for _, el := range x.Elts {
					if kv, ok := el.(*ast.KeyValueExpr); ok {
						if k, ok := kv.Key.(*ast.Ident); ok {
							keys[k.Name] = string(src[fset.Position(kv.Value.Pos()).Offset:fset.Position(kv.Value.End()).Offset])
						}
					}
				}
				if len(keys) == 0 {
					return true // the zero value, e.g. []audit.Entry{}
				}
				if _, has := keys["GVR"]; !has && !noObject[strings.Trim(keys["Action"], `"`)] {
					t.Errorf("%s: audit.Entry %s has no GVR", fset.Position(x.Pos()), keys["Action"])
				}
			}
			return true
		})
	}
}

// A create from the New resource dialog is a mutation like any other: it
// was audited only when a webhook rejected it.
func TestCreateResourceRecordsEachDocWithUserAndGVR(t *testing.T) {
	c, _ := createChannels(t, nil)
	b, _ := json.Marshal(map[string]any{"cluster": "c1", "yaml": createDoc, "dryRun": false})
	rr := httptest.NewRecorder()
	c.HandleCreateResource(rr, asUser(httptest.NewRequest(http.MethodPost, "/api/yaml/create", strings.NewReader(string(b))), "carol@example.com"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	got, _ := c.Audit.Tail(5)
	if len(got) != 1 {
		t.Fatalf("got %d entries (%+v), want 1", len(got), got)
	}
	e := got[0]
	if e.Action != "create" || e.User != "carol@example.com" || e.GVR != "networking.k8s.io/v1/networkpolicies" || e.Namespace != "shop" || e.Resource != "db-lockdown" {
		t.Fatalf("entry = %+v", e)
	}
}

func TestCreateResourceDryRunIsNotRecorded(t *testing.T) {
	c, _ := createChannels(t, nil)
	b, _ := json.Marshal(map[string]any{"cluster": "c1", "yaml": createDoc, "dryRun": true})
	rr := httptest.NewRecorder()
	c.HandleCreateResource(rr, httptest.NewRequest(http.MethodPost, "/api/yaml/create", strings.NewReader(string(b))))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	if got, _ := c.Audit.Tail(5); len(got) != 0 {
		t.Fatalf("dry run recorded %+v", got)
	}
}
