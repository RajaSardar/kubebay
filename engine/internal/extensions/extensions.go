// Package extensions reads ~/.kubebay/extensions.yaml (backlog KB-13): extra
// table columns and row actions the user declares for any resource. The file
// is the user's own, never downloaded. Nothing in it runs in the engine: the
// shell fills in the templates, opens a URL action in the browser, and types a
// command action into the local shell for the user to run.
//
// Parse keeps every valid entry and reports each invalid one by number, so one
// typo doesn't take the whole file down.
package extensions

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"sigs.k8s.io/yaml"
)

const (
	maxFileBytes = 256 << 10
	maxEntries   = 100
	maxHeader    = 40
	maxLabel     = 60
	maxTemplate  = 2000
	maxPath      = 500
)

// Column is an extra column on the tables of one resource.
type Column struct {
	// Resource is the plural resource name, optionally with its group, the way
	// kubectl takes it: "pods", "deployments.apps", "nodepools.karpenter.sh".
	Resource string `json:"resource"`
	Header   string `json:"header"`
	// JSONPath uses the subset the shell evaluates: .a.b keys (\. escapes a dot
	// in a key), [N] indexes and [?(@.key=="value")] filters.
	JSONPath string `json:"jsonPath"`
}

// Action is a row-menu item on the tables of one resource. Exactly one of
// URL and Run is set.
type Action struct {
	Resource string `json:"resource"`
	Label    string `json:"label"`
	URL      string `json:"url,omitempty"`
	Run      string `json:"run,omitempty"`
	// Contexts limits the action to these kubeconfig contexts; * matches any run
	// of characters. Empty means every context.
	Contexts []string `json:"contexts,omitempty"`
}

// File is what the engine serves: the valid entries and what's wrong with the rest.
type File struct {
	Path    string   `json:"path"`
	Exists  bool     `json:"exists"`
	Columns []Column `json:"columns"`
	Actions []Action `json:"actions"`
	Errors  []string `json:"errors"`
}

// Load reads and parses the file at path. A missing file is not an error.
func Load(path string) File {
	f := File{Path: path, Columns: []Column{}, Actions: []Action{}, Errors: []string{}}
	fh, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return f
	}
	f.Exists = true
	if err != nil {
		f.Errors = append(f.Errors, fmt.Sprintf("can't read %s: %v", path, err))
		return f
	}
	defer fh.Close()
	data, err := io.ReadAll(io.LimitReader(fh, maxFileBytes+1))
	if err != nil {
		f.Errors = append(f.Errors, fmt.Sprintf("can't read %s: %v", path, err))
		return f
	}
	if len(data) > maxFileBytes {
		f.Errors = append(f.Errors, fmt.Sprintf("%s is larger than %d KiB", path, maxFileBytes>>10))
		return f
	}
	p := Parse(data)
	p.Path, p.Exists = path, true
	return p
}

var topLevelKeys = []string{"version", "columns", "actions"}

// Parse validates a file's contents.
func Parse(data []byte) File {
	f := File{Columns: []Column{}, Actions: []Action{}, Errors: []string{}}
	fail := func(format string, a ...any) { f.Errors = append(f.Errors, fmt.Sprintf(format, a...)) }

	if len(bytes.TrimSpace(data)) == 0 {
		return f
	}
	js, err := yaml.YAMLToJSON(data)
	if err != nil {
		msg := strings.TrimPrefix(err.Error(), "error converting YAML to JSON: ")
		fail("not valid YAML: %s", strings.TrimPrefix(msg, "yaml: "))
		return f
	}
	if string(js) == "null" {
		return f
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(js, &top); err != nil {
		fail("the file must be a mapping with version, columns and actions")
		return f
	}
	for _, k := range sortedKeys(top) {
		if !contains(topLevelKeys, k) {
			fail("unknown top-level key %q%s", k, suggest(k, topLevelKeys))
		}
	}
	if raw, ok := top["version"]; ok {
		var v json.Number
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if err := dec.Decode(&v); err != nil || v.String() != "1" {
			fail("version %s isn't one this Kubebay reads; it reads version 1", strings.Trim(string(raw), `"`))
			return f
		}
	}

	for i, raw := range entries(top["columns"], "columns", &f.Errors) {
		where := fmt.Sprintf("column %d", i+1)
		if i == maxEntries {
			fail("at most %d columns are read; the rest are ignored", maxEntries)
			break
		}
		var c Column
		if !decodeEntry(raw, &c, where, []string{"resource", "header", "jsonPath"}, &f.Errors) {
			continue
		}
		if err := c.validate(); err != nil {
			fail("%s%s: %v", where, quoted(c.Header), err)
			continue
		}
		f.Columns = append(f.Columns, c)
	}
	for i, raw := range entries(top["actions"], "actions", &f.Errors) {
		where := fmt.Sprintf("action %d", i+1)
		if i == maxEntries {
			fail("at most %d actions are read; the rest are ignored", maxEntries)
			break
		}
		var a Action
		if !decodeEntry(raw, &a, where, []string{"resource", "label", "url", "run", "contexts"}, &f.Errors) {
			continue
		}
		if err := a.validate(); err != nil {
			fail("%s%s: %v", where, quoted(a.Label), err)
			continue
		}
		f.Actions = append(f.Actions, a)
	}
	return f
}

func quoted(s string) string {
	if s == "" {
		return ""
	}
	return fmt.Sprintf(" (%q)", s)
}

// entries reads a top-level list, reporting one that isn't a list.
func entries(raw json.RawMessage, name string, errs *[]string) []json.RawMessage {
	if raw == nil || string(raw) == "null" {
		return nil
	}
	var list []json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil {
		*errs = append(*errs, fmt.Sprintf("%s must be a list", name))
		return nil
	}
	return list
}

func decodeEntry(raw json.RawMessage, into any, where string, allowed []string, errs *[]string) bool {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		*errs = append(*errs, fmt.Sprintf("%s must be a mapping", where))
		return false
	}
	ok := true
	for _, k := range sortedKeys(m) {
		if !contains(allowed, k) {
			*errs = append(*errs, fmt.Sprintf("%s: unknown field %q%s", where, k, suggest(k, allowed)))
			ok = false
		}
	}
	if !ok {
		return false
	}
	if err := json.Unmarshal(raw, into); err != nil {
		var te *json.UnmarshalTypeError
		if errors.As(err, &te) {
			*errs = append(*errs, fmt.Sprintf("%s: %s must be %s", where, te.Field, kindOf(te.Type.String())))
		} else {
			*errs = append(*errs, fmt.Sprintf("%s: %v", where, err))
		}
		return false
	}
	return true
}

func kindOf(goType string) string {
	if strings.HasPrefix(goType, "[]") {
		return "a list of text"
	}
	return "text"
}

func sortedKeys(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func suggest(k string, allowed []string) string {
	for _, a := range allowed {
		if strings.EqualFold(a, k) {
			return fmt.Sprintf(" (did you mean %q?)", a)
		}
	}
	return ""
}

var resourceRE = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)

func validResource(r string) error {
	if r == "" {
		return errors.New("resource is required")
	}
	if len(r) > 253 || !resourceRE.MatchString(r) {
		return fmt.Errorf("resource %q must be a lowercase plural resource name, optionally with its group (pods, deployments.apps)", r)
	}
	return nil
}

func printable(s string) bool {
	for _, r := range s {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return false
		}
	}
	return true
}

func validText(name, s string, limit int) error {
	switch {
	case strings.TrimSpace(s) == "":
		return fmt.Errorf("%s is required", name)
	case utf8.RuneCountInString(s) > limit:
		return fmt.Errorf("%s is longer than %d characters", name, limit)
	case !printable(s):
		return fmt.Errorf("%s must be one line of printable text", name)
	}
	return nil
}

func (c Column) validate() error {
	if err := validResource(c.Resource); err != nil {
		return err
	}
	if err := validText("header", c.Header, maxHeader); err != nil {
		return err
	}
	if c.JSONPath == "" {
		return errors.New("jsonPath is required")
	}
	if len(c.JSONPath) > maxPath {
		return fmt.Errorf("jsonPath is longer than %d characters", maxPath)
	}
	path, err := parsePath(c.JSONPath)
	if err != nil {
		return err
	}
	// The Secrets table loads metadata only, so Secret data never reaches the
	// browser; a column can't change that.
	if c.Resource == "secrets" && !strings.HasPrefix(path, ".metadata.") {
		return errors.New("columns on secrets can read only .metadata: Kubebay never loads Secret data into a table")
	}
	return nil
}

// filterRE is one [?(@.key=="value")] step, as lib/printerPath.ts reads it.
var filterRE = regexp.MustCompile(`^\[\?\(@\.[A-Za-z0-9_.\-/]+\s*==\s*(?:"[^"]*"|'[^']*')\)\]`)
var indexRE = regexp.MustCompile(`^\[[0-9]+\]`)

const pathHelp = `jsonPath supports .a.b keys (\. for a dot inside a key), [N] indexes and [?(@.key=="value")] filters`

// parsePath checks a path against the subset the shell evaluates and returns
// it without the optional {braces}.
func parsePath(raw string) (string, error) {
	p := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(raw), "{"), "}"))
	if !strings.HasPrefix(p, ".") {
		return "", fmt.Errorf("jsonPath %q must start with a dot; %s", raw, pathHelp)
	}
	for i := 0; i < len(p); {
		switch p[i] {
		case '.':
			i++
			start := i
			for i < len(p) && p[i] != '.' && p[i] != '[' {
				if p[i] == '\\' {
					i++
				}
				i++
			}
			if i == start || i > len(p) {
				return "", fmt.Errorf("jsonPath %q has an empty key; %s", raw, pathHelp)
			}
		case '[':
			m := filterRE.FindString(p[i:])
			if m == "" {
				m = indexRE.FindString(p[i:])
			}
			if m == "" {
				return "", fmt.Errorf("jsonPath %q: %s", raw, pathHelp)
			}
			i += len(m)
		default:
			return "", fmt.Errorf("jsonPath %q: %s", raw, pathHelp)
		}
	}
	return p, nil
}

func (a Action) validate() error {
	if err := validResource(a.Resource); err != nil {
		return err
	}
	if err := validText("label", a.Label, maxLabel); err != nil {
		return err
	}
	for _, c := range a.Contexts {
		if strings.TrimSpace(c) == "" || len(c) > 253 || !printable(c) {
			return fmt.Errorf("contexts must be kubeconfig context names (* matches anything), not %q", c)
		}
	}
	switch {
	case (a.URL == "") == (a.Run == ""):
		return errors.New("set exactly one of url or run")
	case a.URL != "":
		return validURL(a.URL)
	default:
		return validRun(a.Run)
	}
}

func validTemplate(name, t string) error {
	if len(t) > maxTemplate {
		return fmt.Errorf("%s is longer than %d characters", name, maxTemplate)
	}
	if !printable(t) {
		return fmt.Errorf("%s must be one line of printable text", name)
	}
	return nil
}

func validURL(u string) error {
	if err := validTemplate("url", u); err != nil {
		return err
	}
	lower := strings.ToLower(u)
	var rest string
	switch {
	case strings.HasPrefix(lower, "https://"):
		rest = u[len("https://"):]
	case strings.HasPrefix(lower, "http://"):
		rest = u[len("http://"):]
	default:
		return fmt.Errorf("url must start with http:// or https://, written out in the template")
	}
	host := rest
	if i := strings.IndexAny(rest, "/?#"); i >= 0 {
		host = rest[:i]
	}
	if host == "" {
		return errors.New("url has no host")
	}
	// Values from the cluster fill in the path and query, never where the link goes.
	if strings.Contains(host, "{{") {
		return errors.New("url's host must be written out: placeholders can go in the path and query only")
	}
	_, err := placeholders(u)
	return err
}

// validRun checks that every placeholder in a command stands where Kubebay's
// quoting keeps it one argument: outside quotes, not after a backslash or $.
func validRun(run string) error {
	if err := validTemplate("run", run); err != nil {
		return err
	}
	spans, err := placeholders(run)
	if err != nil {
		return err
	}
	at := map[int]string{}
	for _, s := range spans {
		at[s.start] = s.text
	}
	const (
		bare = iota
		single
		double
	)
	state := bare
	for i := 0; i < len(run); i++ {
		if text, ok := at[i]; ok {
			switch {
			case state != bare:
				return fmt.Errorf("%s is inside quotes; Kubebay quotes each value itself, so put it outside quotes", text)
			case i > 0 && run[i-1] == '$':
				return fmt.Errorf("%s follows a $; Kubebay quotes each value itself, so it can't follow $", text)
			}
			i += len(text) - 1
			continue
		}
		c := run[i]
		switch state {
		case bare:
			switch c {
			case '\\':
				if _, next := at[i+1]; next {
					return fmt.Errorf("%s follows a backslash; Kubebay quotes each value itself", at[i+1])
				}
				i++
			case '\'':
				state = single
			case '"':
				state = double
			}
		case single:
			if c == '\'' {
				state = bare
			}
		case double:
			switch c {
			case '\\':
				i++
			case '"':
				state = bare
			}
		}
	}
	return nil
}

type span struct {
	start int
	text  string
}

var labelKeyRE = regexp.MustCompile(`^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$`)

const placeholderHelp = "use {{name}}, {{namespace}}, {{kind}}, {{context}}, {{label:KEY}} or {{annotation:KEY}}"

// placeholders finds each {{…}} in a template and checks it's one the shell fills in.
func placeholders(t string) ([]span, error) {
	var out []span
	for i := 0; ; {
		j := strings.Index(t[i:], "{{")
		if j < 0 {
			return out, nil
		}
		start := i + j
		end := strings.Index(t[start:], "}}")
		if end < 0 {
			return nil, fmt.Errorf("unclosed {{ in %q", t)
		}
		text := t[start : start+end+2]
		inner := text[2 : len(text)-2]
		switch {
		case inner == "name" || inner == "namespace" || inner == "kind" || inner == "context":
		case strings.HasPrefix(inner, "label:") || strings.HasPrefix(inner, "annotation:"):
			kind, key, _ := strings.Cut(inner, ":")
			if len(key) > 316 || !labelKeyRE.MatchString(key) {
				return nil, fmt.Errorf("%s: %q isn't a valid %s key", text, key, kind)
			}
		default:
			return nil, fmt.Errorf("unknown placeholder %q: %s", text, placeholderHelp)
		}
		out = append(out, span{start: start, text: text})
		i = start + len(text)
	}
}
