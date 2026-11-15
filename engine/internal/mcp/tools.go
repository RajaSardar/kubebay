package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
)

// CallInfo identifies one tools/call for the tool and the audit log. With no
// sessions in the protocol, the client's own name, version and the JSON-RPC
// request id are what an entry can carry.
type CallInfo struct {
	Tool          string
	ClientName    string
	ClientVersion string
	RequestID     string
}

// Content is one item of a tool result.
type Content struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// Result is a tool's answer. IsError marks a failure the model should see.
type Result struct {
	Content           []Content `json:"content"`
	StructuredContent any       `json:"structuredContent,omitempty"`
	IsError           bool      `json:"isError,omitempty"`
}

// TextResult is a result with one text item.
func TextResult(text string) Result { return Result{Content: []Content{{Type: "text", Text: text}}} }

// argError marks bad arguments: reported to the model as a tool error, like
// any other tool failure, so it can correct the call.
type argError struct{ msg string }

func (e argError) Error() string { return e.msg }

// ArgError is a tool's way to reject its arguments.
func ArgError(msg string) error { return argError{msg} }

// IsArgError reports whether err came from ArgError.
func IsArgError(err error) bool {
	var a argError
	return errors.As(err, &a)
}

// Handler runs a tool. Args is the raw arguments object ("{}" when absent).
type ToolHandler func(ctx context.Context, args json.RawMessage, call CallInfo) (Result, error)

// Tool is one read-only tool.
type Tool struct {
	Name        string
	Title       string
	Description string
	InputSchema json.RawMessage
	Handler     ToolHandler
}

type toolAnnotations struct {
	ReadOnlyHint   bool `json:"readOnlyHint"`
	IdempotentHint bool `json:"idempotentHint"`
	OpenWorldHint  bool `json:"openWorldHint"`
}

type toolDescriptor struct {
	Name        string          `json:"name"`
	Title       string          `json:"title,omitempty"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	Annotations toolAnnotations `json:"annotations"`
}

// Registry holds the tools, listed in name order so clients can cache them.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

func NewRegistry() *Registry { return &Registry{tools: map[string]Tool{}} }

func (r *Registry) Add(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[t.Name] = t
}

// Get returns the tool registered under name.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

func (r *Registry) list() []toolDescriptor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]toolDescriptor, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, toolDescriptor{
			Name:        t.Name,
			Title:       t.Title,
			Description: t.Description,
			InputSchema: t.InputSchema,
			// Every Kubebay tool only reads; all of them talk to a cluster.
			Annotations: toolAnnotations{ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: true},
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
