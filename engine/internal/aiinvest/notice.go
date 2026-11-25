package aiinvest

// NoticeVersion is bumped whenever Notice changes in substance; everyone is
// asked again.
const NoticeVersion = 1

// Notice is the first-run text, accepted once per user.
const Notice = "Investigate with AI runs Claude Code, the command-line tool you installed yourself, on this computer. " +
	"Kubebay sends it the issue's text, and Claude Code can then read this cluster through Kubebay's read-only tools: " +
	"object status, events, logs and manifests within the cluster and namespace of the issue (Secret values are never available). " +
	"Claude Code sends that text and whatever those tools return to Anthropic, under your own Claude account and its terms. " +
	"Kubebay stores no API key, uses no other AI provider and runs no hosted service. " +
	"Nothing is changed in your cluster by the run: a fix it suggests is text, and you apply it yourself through Kubebay's own diff and confirmation. " +
	"You can turn this off in Settings at any time."

// InstallHelp is shown when claude is not found.
const InstallHelp = "Claude Code was not found on this computer. Install it from https://docs.claude.com/en/docs/claude-code/overview, " +
	"sign in once by running `claude` in a terminal, then open this panel again. Kubebay does not install it for you."
