// Package timeline keeps a local change timeline (backlog 82): Kubernetes
// events and object changes the informer pool observed, in one SQLite file
// under the user's config directory, with the field manager that made each
// change and honest "not recorded" gaps where nothing was watching.
//
// It stores metadata only: names, kinds, the paths that changed (never their
// values), and the manager. Kind Secret is never observed. It is desktop-only;
// a shared engine never opens it (httpapi.TimelineBlockReason).
package timeline

import "time"

// Change ops.
const (
	OpAdd    = "add"
	OpUpdate = "update"
	OpDelete = "delete"
	OpEvent  = "event"
)

const (
	// MaxQueryLimit bounds one page of changes.
	MaxQueryLimit = 500
	// DefaultQueryLimit is a page when the caller gives none.
	DefaultQueryLimit = 100
	// MaxMessage is the longest event message kept, after redaction.
	MaxMessage = 512
)

// FieldChange is one changed path. Never a value.
type FieldChange struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // added | removed | changed
}

// Change is one recorded object change or Kubernetes event.
type Change struct {
	ID      int64     `json:"id"`
	Cluster string    `json:"cluster"`
	TS      time.Time `json:"ts"`
	// ObjTime is the managedFields time of the change, or the event's last
	// timestamp. Nil when unknown.
	ObjTime      *time.Time    `json:"objTime,omitempty"`
	Group        string        `json:"group"`
	Version      string        `json:"version"`
	Resource     string        `json:"resource"`
	Kind         string        `json:"kind"`
	Namespace    string        `json:"namespace"`
	Name         string        `json:"name"`
	UID          string        `json:"uid,omitempty"`
	Op           string        `json:"op"`
	FieldManager string        `json:"fieldManager,omitempty"`
	Fields       []FieldChange `json:"fields,omitempty"`
	// MoreFields counts changed paths beyond the cap.
	MoreFields int `json:"moreFields,omitempty"`
	// MetadataOnly marks a change seen through a metadata-only watch: only
	// labels, annotation keys, finalizers and owners could be compared.
	MetadataOnly bool `json:"metadataOnly,omitempty"`
	// AfterGap marks a change seen after a watch relist: it may merge several
	// changes and its manager is not reliable.
	AfterGap bool `json:"afterGap,omitempty"`
	// Merged counts the updates folded into this row (1 when none were).
	Merged int `json:"merged,omitempty"`
	// Event rows.
	Reason       string `json:"reason,omitempty"`
	Type         string `json:"type,omitempty"`
	Message      string `json:"message,omitempty"`
	InvolvedKind string `json:"involvedKind,omitempty"`
	InvolvedName string `json:"involvedName,omitempty"`
}

// Query selects changes of one cluster, newest first.
type Query struct {
	Cluster   string
	Namespace string
	Kind      string
	Manager   string
	From, To  time.Time // zero = open
	Limit     int
	Cursor    string
}

// Page is one page of a query.
type Page struct {
	Changes    []Change `json:"changes"`
	NextCursor string   `json:"nextCursor,omitempty"`
}

// Span is a period a kind was watched in a namespace ("" = all namespaces).
type Span struct {
	Cluster   string    `json:"cluster"`
	Kind      string    `json:"kind"`
	Namespace string    `json:"namespace"`
	Start     time.Time `json:"start"`
	End       time.Time `json:"end"`
	// Reason is why the span closed; empty when the app stopped without
	// closing it (its End is then the last heartbeat).
	Reason string `json:"reason,omitempty"`
}

// Gap is a period nothing was recording a kind.
type Gap struct {
	From   time.Time `json:"from"`
	To     time.Time `json:"to"`
	Reason string    `json:"reason"`
}

// Facets are the distinct values a filter can offer.
type Facets struct {
	Kinds      []string `json:"kinds"`
	Namespaces []string `json:"namespaces"`
	Managers   []string `json:"managers"`
}

// Stats describes the store.
type Stats struct {
	Rows     int64 `json:"rows"`
	DBBytes  int64 `json:"dbBytes"`
	CapBytes int64 `json:"capBytes"`
	Evicted  int64 `json:"evicted"`
	// EvictedBefore: rows older than this were removed to stay under the
	// size cap, so nothing before it can be shown, whatever coverage says.
	EvictedBefore time.Time `json:"evictedBefore,omitempty"`
}

// Store is where changes and coverage live. Everything but store_test.go
// runs against MemStore.
type Store interface {
	Append(rows []Change) error
	PutSpans(spans []Span) error
	Query(q Query) (Page, error)
	Spans(cluster, kind string, from, to time.Time) ([]Span, error)
	Facets(cluster string) (Facets, error)
	// Prune deletes changes and spans older than before.
	Prune(before time.Time) (int64, error)
	Stats() (Stats, error)
	// Clear deletes a cluster's rows, or everything when cluster is "".
	Clear(cluster string) error
	Close() error
}
