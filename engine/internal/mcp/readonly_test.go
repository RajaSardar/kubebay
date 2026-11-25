package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
)

func gatedServer(t *testing.T, writes *atomic.Bool) (*Handler, *int, *[]string) {
	t.Helper()
	writeCalls := 0
	var refused []string
	reg := NewRegistryGated(func() bool { return writes.Load() })
	reg.Add(Tool{Name: "peek", Access: AccessRead, Description: "reads", InputSchema: json.RawMessage(`{"type":"object"}`),
		Handler: func(context.Context, json.RawMessage, CallInfo) (Result, error) { return TextResult("ok"), nil }})
	reg.Add(Tool{Name: "change", Access: AccessWrite, Description: "writes", InputSchema: json.RawMessage(`{"type":"object"}`),
		Handler: func(context.Context, json.RawMessage, CallInfo) (Result, error) {
			writeCalls++
			return TextResult("done"), nil
		}})
	h := &Handler{Tools: reg, Name: "kubebay", Version: "test",
		Instructions: "reads and proposals", ReadOnlyInstructions: "reads only",
		OnRefuse: func(ci CallInfo) { refused = append(refused, ci.Tool+"/"+ci.RequestID) }}
	return h, &writeCalls, &refused
}

func listNames(t *testing.T, h *Handler) map[string]map[string]any {
	t.Helper()
	_, out, _ := do(t, h, exchange{headers: modernHeaders("tools/list", ""), body: modernBody(1, "tools/list", "")})
	names := map[string]map[string]any{}
	for _, x := range result(t, out)["tools"].([]any) {
		m := x.(map[string]any)
		names[m["name"].(string)] = m
	}
	return names
}

func TestReadOnlyHidesAndRefusesWriteTools(t *testing.T) {
	var w atomic.Bool
	h, writeCalls, refused := gatedServer(t, &w)

	names := listNames(t, h)
	if _, ok := names["change"]; ok {
		t.Fatalf("write tool listed while read-only: %v", names)
	}
	if _, ok := names["peek"]; !ok {
		t.Fatalf("read tool missing: %v", names)
	}
	_, out, _ := do(t, h, exchange{headers: modernHeaders("tools/call", "change"), body: modernBody(2, "tools/call", `"name":"change","arguments":{}`)})
	r := result(t, out)
	if r["isError"] != true {
		t.Fatalf("refusal must be an isError tool result: %v", r)
	}
	text := r["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, ErrReadOnly.Error()) || strings.Contains(text, "unknown tool") {
		t.Fatalf("want the read-only refusal, got %q", text)
	}
	if *writeCalls != 0 {
		t.Fatal("write handler ran in read-only")
	}
	if len(*refused) != 1 || (*refused)[0] != "change/2" {
		t.Fatalf("OnRefuse = %v", *refused)
	}
	// Legacy transport shares the gate.
	_, out, _ = do(t, h, exchange{body: `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"change","arguments":{}}}`})
	if result(t, out)["isError"] != true || *writeCalls != 0 {
		t.Fatalf("legacy call not refused: %v", out)
	}
}

func TestWritesOnKeepsTodaysBehaviourLive(t *testing.T) {
	var w atomic.Bool
	w.Store(true)
	h, writeCalls, refused := gatedServer(t, &w)
	names := listNames(t, h)
	if _, ok := names["change"]; !ok {
		t.Fatalf("write tool should list when writes are on: %v", names)
	}
	if names["change"]["annotations"].(map[string]any)["readOnlyHint"] != false {
		t.Fatal("write tool must not claim readOnlyHint")
	}
	if names["peek"]["annotations"].(map[string]any)["readOnlyHint"] != true {
		t.Fatal("read tool keeps readOnlyHint")
	}
	do(t, h, exchange{headers: modernHeaders("tools/call", "change"), body: modernBody(2, "tools/call", `"name":"change","arguments":{}`)})
	if *writeCalls != 1 || len(*refused) != 0 {
		t.Fatalf("calls=%d refused=%v", *writeCalls, *refused)
	}
	// Flipping off takes effect at once, no restart.
	w.Store(false)
	if _, ok := listNames(t, h)["change"]; ok {
		t.Fatal("toggle off must hide at once")
	}
}

func TestInstructionsFollowTheMode(t *testing.T) {
	var w atomic.Bool
	h, _, _ := gatedServer(t, &w)
	disc := func() string {
		_, out, _ := do(t, h, exchange{headers: modernHeaders("server/discover", ""), body: modernBody(1, "server/discover", "")})
		return result(t, out)["instructions"].(string)
	}
	if disc() != "reads only" {
		t.Fatalf("read-only instructions: %q", disc())
	}
	w.Store(true)
	if disc() != "reads and proposals" {
		t.Fatalf("writes instructions: %q", disc())
	}
}

func TestAddPanicsWithoutAccess(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("a tool with no Access must not register")
		}
	}()
	NewRegistry().Add(Tool{Name: "x"})
}
