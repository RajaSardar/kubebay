package aiinvest

import (
	"reflect"
	"strings"
	"testing"
)

func baseRun() Run {
	return Run{
		Prompt:        "investigate this",
		MCPConfigPath: "/tmp/kb/cfg/mcp.json",
		AllowedTools:  []string{"mcp__kubebay__list_clusters", "mcp__kubebay__list_resources"},
	}
}

// The argv is pinned exactly: a change that re-enables a built-in tool, drops
// --strict-mcp-config or loosens the permission mode must fail here.
func TestBuildArgsExact(t *testing.T) {
	got, err := BuildArgs(baseRun())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"-p", "investigate this",
		"--output-format", "stream-json", "--verbose",
		"--tools", "",
		"--strict-mcp-config", "--mcp-config", "/tmp/kb/cfg/mcp.json",
		"--allowedTools", "mcp__kubebay__list_clusters", "mcp__kubebay__list_resources",
		"--disallowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit",
		"--permission-mode", "dontAsk",
		"--permission-prompts", "none",
		"--restricted",
		"--no-session-persistence",
		"--append-system-prompt", SystemInstruction,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv changed:\n got %q\nwant %q", got, want)
	}
}

func TestBuildArgsRefusesUnsafeInput(t *testing.T) {
	cases := map[string]func(*Run){
		"empty prompt":         func(r *Run) { r.Prompt = "" },
		"relative mcp config":  func(r *Run) { r.MCPConfigPath = "mcp.json" },
		"builtin tool allowed": func(r *Run) { r.AllowedTools = append(r.AllowedTools, "Bash") },
		"wildcard allowed":     func(r *Run) { r.AllowedTools = []string{"mcp__kubebay__*"} },
		"other server allowed": func(r *Run) { r.AllowedTools = []string{"mcp__other__list_resources"} },
		"no allowed tools":     func(r *Run) { r.AllowedTools = nil },
		"flag-looking prompt":  nil, // covered below: a prompt is one argv element, never parsed as a flag
	}
	for name, mut := range cases {
		if mut == nil {
			continue
		}
		r := baseRun()
		mut(&r)
		if _, err := BuildArgs(r); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}

func TestPromptIsOneArgvElementAndNoTokenInArgv(t *testing.T) {
	r := baseRun()
	r.Prompt = "--tools default; rm -rf / $(whoami)"
	got, err := BuildArgs(r)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, a := range got {
		if a == r.Prompt {
			n++
		}
		if strings.Contains(strings.ToLower(a), "bearer") {
			t.Fatalf("a credential in argv: %q", a)
		}
	}
	if n != 1 || got[0] != "-p" || got[1] != r.Prompt {
		t.Fatalf("prompt must be exactly one element right after -p: %q", got)
	}
	// No "--tools default" can appear as a separate flag value.
	for i, a := range got {
		if a == "--tools" && got[i+1] != "" {
			t.Fatalf("--tools must disable every built-in tool, got %q", got[i+1])
		}
	}
}
