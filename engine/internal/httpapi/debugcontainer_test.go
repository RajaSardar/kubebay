package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildEphemeralContainerPatch(t *testing.T) {
	name, data, err := buildEphemeralContainerPatch([]string{"debugger-aaaaa"}, "busybox:1.36", "app")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(name, "debugger-") || name == "debugger-aaaaa" {
		t.Errorf("name = %q, want a fresh debugger-* name", name)
	}
	var patch struct {
		Spec struct {
			Ephemeral []map[string]any `json:"ephemeralContainers"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(data, &patch); err != nil {
		t.Fatal(err)
	}
	if len(patch.Spec.Ephemeral) != 1 {
		t.Fatalf("want one ephemeral container, got %s", data)
	}
	c := patch.Spec.Ephemeral[0]
	if c["name"] != name || c["image"] != "busybox:1.36" || c["targetContainerName"] != "app" || c["stdin"] != true || c["tty"] != true {
		t.Errorf("container = %v", c)
	}
}

func TestBuildEphemeralContainerPatchWithoutTargetOmitsIt(t *testing.T) {
	_, data, err := buildEphemeralContainerPatch(nil, "busybox", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "targetContainerName") {
		t.Errorf("empty target must be omitted: %s", data)
	}
}

func TestBuildEphemeralContainerPatchRejectsBadImages(t *testing.T) {
	for _, img := range []string{"", "   ", "busy box", "img;rm -rf"} {
		if _, _, err := buildEphemeralContainerPatch(nil, img, ""); err == nil {
			t.Errorf("image %q should be rejected", img)
		}
	}
}

func TestDebugContainerAuditDetail(t *testing.T) {
	d := debugContainerAuditDetail("debugger-abcde", "busybox:1.36", "app")
	for _, want := range []string{"container=debugger-abcde", "image=busybox:1.36", "target=app"} {
		if !strings.Contains(d, want) {
			t.Errorf("detail %q missing %q", d, want)
		}
	}
}

func TestSettingsExposeDebugImageAndKeepItWhenOmitted(t *testing.T) {
	sm := settingsWithManager(t)
	save(t, sm, `{"debugImage":"  nicolaka/netshoot  "}`)
	save(t, sm, `{"prometheusUrl":""}`)
	rec := httptest.NewRecorder()
	sm.HandleGet(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["debugImage"] != "nicolaka/netshoot" {
		t.Errorf("debugImage = %v", got["debugImage"])
	}
	if got["debugImageDefault"] != DefaultDebugImage || DefaultDebugImage == "" {
		t.Errorf("debugImageDefault = %v", got["debugImageDefault"])
	}
}
