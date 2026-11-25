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

// Access says whether a tool can change cluster state (or create a proposal
// for one). It is required: a tool registered without it panics at Add, so no
// tool can reach an assistant unclassified.
type Access int

const (
	accessUnset Access = iota
	// AccessRead only reads.
	AccessRead
	// AccessWrite can change state or touch proposals; hidden and refused
	// while writes are off.
	AccessWrite
)

// ErrReadOnly is what a refused write-tool call tells the model.
var ErrReadOnly = errors.New("kubebay MCP is read-only: this tool can change cluster state and is turned off in Kubebay")

// Tool is one tool.
type Tool struct {
	Access      Access
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
	// writes is asked on every list and call; the one source of truth is its
	// owner, so a toggle works without a restart. Nil means writes allowed.
	writes func() bool
}

func NewRegistry() *Registry { return &Registry{tools: map[string]Tool{}} }

// NewRegistryGated returns a registry whose write tools exist only while
// writes() is true.
func NewRegistryGated(writes func() bool) *Registry {
	return &Registry{tools: map[string]Tool{}, writes: writes}
}

// WritesAllowed reports whether write tools are on right now.
func (r *Registry) WritesAllowed() bool { return r.writes == nil || r.writes() }

// Refuses reports whether t may not run now: the single gate for list and call.
func (r *Registry) Refuses(t Tool) bool { return t.Access == AccessWrite && !r.WritesAllowed() }

func (r *Registry) Add(t Tool) {
	if t.Access != AccessRead && t.Access != AccessWrite {
		panic("mcp: tool " + t.Name + " registered without an Access classification")
	}
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
		if r.Refuses(t) {
			continue
		}
		out = append(out, toolDescriptor{
			Name:        t.Name,
			Title:       t.Title,
			Description: t.Description,
			InputSchema: t.InputSchema,
			// Read tools only read; a write tool (listed only while writes are
			// on) changes nothing by itself, so it is not destructive.
			Annotations: toolAnnotations{ReadOnlyHint: t.Access == AccessRead, IdempotentHint: t.Access == AccessRead, OpenWorldHint: true},
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
