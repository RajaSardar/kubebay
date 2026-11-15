package httpapi

import (
	"fmt"
	"net/http"

	"github.com/RajaSardar/kubebay/engine/internal/extensions"
)

// ExtensionsAPI serves ~/.kubebay/extensions.yaml (backlog KB-13), read on
// every request so an edit shows up without a restart. The engine only parses
// and validates it: the shell fills in the templates, and a command action is
// typed into the local shell for the user to run.
type ExtensionsAPI struct {
	Path string
	// Disabled, when set, is why extensions are off in this deployment.
	Disabled string
	// LocalShell reports whether command actions have a shell to go to.
	LocalShell func() LocalShellStatus
}

// ExtensionsBlockReason: the file is the engine host's, which in server mode
// belongs to no logged-in user.
func ExtensionsBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "extensions come from a file on the engine's machine, so they're off when OIDC is configured"
	case inCluster:
		return "extensions come from a file on the engine's machine, so they're off in in-cluster mode"
	}
	return ""
}

type extensionCommands struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	Shell     string `json:"shell,omitempty"`
}

type extensionsReply struct {
	extensions.File
	Disabled string            `json:"disabled,omitempty"`
	Commands extensionCommands `json:"commands"`
}

func (e *ExtensionsAPI) HandleGet(w http.ResponseWriter, _ *http.Request) {
	if e.Disabled != "" {
		writeJSON(w, extensionsReply{
			File:     extensions.File{Columns: []extensions.Column{}, Actions: []extensions.Action{}, Errors: []string{}},
			Disabled: e.Disabled,
			Commands: extensionCommands{Reason: e.Disabled},
		})
		return
	}
	writeJSON(w, extensionsReply{File: extensions.Load(e.Path), Commands: e.commands()})
}

// quotingShells are the shells the shell's quoting is right for: POSIX single
// quotes, with each backslash outside them so fish reads the same value.
var quotingShells = map[string]bool{"sh": true, "bash": true, "zsh": true, "dash": true, "ksh": true, "mksh": true, "fish": true}

func (e *ExtensionsAPI) commands() extensionCommands {
	var st LocalShellStatus
	if e.LocalShell != nil {
		st = e.LocalShell()
	}
	switch {
	case st.Available && quotingShells[st.Shell]:
		return extensionCommands{Available: true, Shell: st.Shell}
	case st.Available && st.Shell == "":
		return extensionCommands{Reason: "command actions are off because Kubebay couldn't tell which shell the local shell starts"}
	case st.Available:
		return extensionCommands{Reason: fmt.Sprintf("command actions quote values for sh, bash, zsh, ksh and fish, and the local shell here is %s", st.Shell)}
	case st.Reason != "":
		return extensionCommands{Reason: "command actions run in the local shell, which isn't available: " + st.Reason}
	default:
		return extensionCommands{Reason: "command actions run in the local shell, and this engine wasn't started with --local-shell"}
	}
}
