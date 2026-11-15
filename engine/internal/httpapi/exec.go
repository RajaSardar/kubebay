package httpapi

// exec.go — WebSocket-to-Kubernetes-exec terminal bridge
//
// Architecture
// ────────────
// Kubebay does NOT expose a dedicated /api/exec HTTP endpoint.  Instead, exec
// runs over the existing /ws multiplexed WebSocket connection (hub.go).  A
// single persistent WS connection can carry N simultaneous exec terminals, log
// streams, and watch subscriptions.
//
// Wire protocol (client → engine)
//   1. Client sends a JSON text frame:
//        {"type":"chan-open","kind":"exec","id":"t1","cluster":"my-k8s",
//         "namespace":"default","pod":"nginx-xxx","container":"nginx",
//         "command":["bash"],"cols":220,"rows":50}
//      - "cols" and "rows" seed the initial PTY size.
//      - "command" defaults to ["sh"] when absent.
//
//   2. Engine replies: {"type":"ack","id":"t1","message":"channel open"}
//
//   3. Stdin: binary frames, envelope [4-byte big-endian ID length | ID bytes | payload]
//        The hub decodes the envelope and pipes payload → exec stdin.
//
//   4. Resize: text frame:
//        {"type":"chan-resize","id":"t1","cols":220,"rows":60}
//
//   5. Close terminal: text frame:
//        {"type":"chan-close","id":"t1"}
//
// Wire protocol (engine → client)
//   - Terminal output: msgpack binary frame:
//        {type:"chan-data", id:"t1", data:<bytes>}
//     Both k8s stdout and stderr are routed here (TTY merges them).
//   - Session end: text frame:
//        {"type":"chan-closed","id":"t1","message":"done"}
//     On error: message carries the error string.
//
// k8s exec transport
// ──────────────────
// We try WebSocket subprotocol first (available on kube-apiserver ≥ 1.29) and
// fall back to SPDY automatically via remotecommand.NewFallbackExecutor.
// WebSocket is preferred because it works through HTTP/2 reverse proxies (e.g.
// AWS ALB) that do not support SPDY's H2-over-H1 upgrade hack.
//
// TTY vs raw mode
// ───────────────
// We always open a TTY (Stdin:true, Stdout:true, Stderr:false, TTY:true).
// With TTY:true the kernel-side PTY merges stderr into stdout, so a single
// output channel is sufficient.  If a future caller needs non-TTY execution
// (e.g. scripted one-shot commands with separate stdout/stderr), add a
// spec.TTY bool field and branch on it here.

import (
	"context"
	"fmt"
	"io"
	"strings"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// ─── Preflight ────────────────────────────────────────────────────────────────

// preflightExec verifies the pod and container are in a state where exec will
// succeed, returning a human-readable error string or "" on success.  We do
// this before building the executor so we can surface actionable messages
// (e.g. "pod is Pending") instead of the cryptic errors the API server returns.
func preflightExec(ctx context.Context, cs *kubernetes.Clientset, ns, podName, container string) string {
	p, err := cs.CoreV1().Pods(ns).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Sprintf("pod %s/%s not found", ns, podName)
		}
		if apierrors.IsForbidden(err) {
			// RBAC: the engine's service account (or impersonated identity) lacks
			// pods/get.  Surface a clear message so the user knows to fix RBAC.
			return fmt.Sprintf("RBAC denied: cannot get pod %s/%s — check pods/get permission", ns, podName)
		}
		return fmt.Sprintf("pod unavailable: %v", err)
	}

	if p.Status.Phase != corev1.PodRunning {
		return fmt.Sprintf("pod %s/%s is %s — terminal requires a Running pod",
			ns, podName, strings.ToLower(string(p.Status.Phase)))
	}

	if container == "" {
		// No container specified; k8s will pick the first container.
		return ""
	}

	// Check runtime status of the requested container.
	for _, st := range p.Status.ContainerStatuses {
		if st.Name != container {
			continue
		}
		if st.State.Running == nil {
			if st.State.Waiting != nil {
				return fmt.Sprintf("container %q is waiting: %s", container, st.State.Waiting.Reason)
			}
			if st.State.Terminated != nil {
				return fmt.Sprintf("container %q has terminated (exit %d)", container, st.State.Terminated.ExitCode)
			}
			return fmt.Sprintf("container %q is not running yet", container)
		}
		return ""
	}

	// Container appears in spec but has no runtime status — still initialising.
	for _, c := range p.Spec.Containers {
		if c.Name == container {
			return fmt.Sprintf("container %q exists but has no runtime status yet (still initialising?)", container)
		}
	}

	// Container name does not exist in the pod at all.
	names := make([]string, 0, len(p.Spec.Containers))
	for _, c := range p.Spec.Containers {
		names = append(names, c.Name)
	}
	return fmt.Sprintf("container %q not found in pod %s/%s (available: %s)",
		container, ns, podName, strings.Join(names, ", "))
}

// ─── Executor fallback logic ──────────────────────────────────────────────────

// shouldFallback returns true when the WebSocket executor error indicates the
// server does not support the WebSocket subprotocol and we should retry with
// SPDY.  Older kube-apiserver versions (< 1.29) and some distributions return
// a 400 Bad Request or 403 Forbidden on the websocket upgrade attempt.
func shouldFallback(err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsBadRequest(err) ||
		apierrors.IsNotFound(err) ||
		apierrors.IsMethodNotSupported(err) ||
		apierrors.IsUnsupportedMediaType(err) ||
		apierrors.IsForbidden(err) {
		return true
	}
	// Catch untyped websocket handshake errors that are not wrapped as API
	// Status errors — e.g. "websocket: bad handshake" with embedded 403.
	msg := err.Error()
	return strings.Contains(msg, "websocket: bad handshake") ||
		strings.Contains(msg, "403")
}

// ─── TerminalSizeQueue ────────────────────────────────────────────────────────

// sizeQueue implements remotecommand.TerminalSizeQueue.
//
// remotecommand calls Next() in a dedicated goroutine.  It blocks waiting for
// the next resize event.  Returning nil signals that the terminal has been
// closed and remotecommand should stop calling Next().
//
// The channel is closed by hub.go when the exec context is cancelled (either
// the client closed the channel or the WebSocket died), which causes Next() to
// return nil and unblock remotecommand's size goroutine cleanly.
//
// Initial size seeding: hub.go writes the initial Cols/Rows into the channel
// before starting this goroutine, so the first Next() call returns the correct
// dimensions immediately without waiting for a user resize event.
type sizeQueue struct {
	ch <-chan stream.TermSize
}

func (q sizeQueue) Next() *remotecommand.TerminalSize {
	s, ok := <-q.ch
	if !ok {
		return nil
	}
	return &remotecommand.TerminalSize{Width: s.Cols, Height: s.Rows}
}

// ─── stdout/stderr writer ─────────────────────────────────────────────────────

// chanWriter adapts a func([]byte)error send callback to io.Writer, which is
// the interface expected by remotecommand.StreamOptions.Stdout / .Stderr.
//
// Note on buffer ownership: remotecommand guarantees it does not reuse the
// slice passed to Write() before Write() returns.  We therefore pass the
// received slice directly to write() without copying.  The write callback
// (hub.go sendData → coder/websocket Write) completes synchronously before
// returning, so there is no use-after-return.
type chanWriter struct {
	write func([]byte) error
}

func (w chanWriter) Write(p []byte) (int, error) {
	if err := w.write(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// ─── OpenExec ─────────────────────────────────────────────────────────────────

// OpenExec opens a k8s exec session and bridges it bidirectionally until the
// context is cancelled or the remote command exits.
//
// Parameters:
//   - ctx: cancelled when the client closes the channel or the WebSocket dies.
//   - spec: target cluster/namespace/pod/container/command and initial PTY size.
//   - write: send terminal output bytes to the frontend (hub wraps this into a
//     msgpack chan-data frame).
//   - stdin: pipe from hub.go; binary frames from the frontend arrive here.
//   - resize: channel carrying terminal resize events; seeded with the initial
//     size by hub.go before this function is called.
//
// Error handling:
//   - "pod not found" / "RBAC denied" / "container not running": preflightExec
//     returns a descriptive string which is wrapped as an error and returned to
//     the caller.  Hub converts this to a chan-closed frame with the error text.
//   - context.Canceled / context.DeadlineExceeded: the client closed the
//     channel; we return ctx.Err() which hub treats as a normal close.
//   - All other errors from StreamWithContext are wrapped and returned; hub
//     sends them as the chan-closed message text.
func (c *Channels) OpenExec(
	ctx context.Context,
	spec stream.ChanSpec,
	write func([]byte) error,
	stdin io.Reader,
	resize <-chan stream.TermSize,
) error {
	cfg, err := c.Clusters.RestConfigWithIdentity(spec.Cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}

	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return fmt.Errorf("client: %w", err)
	}

	// Default command to "sh" when the client did not specify one.
	if len(spec.Command) == 0 {
		spec.Command = []string{"sh"}
	}

	// Build the exec URL.  We use GET for WebSocket and POST for SPDY; the
	// method is baked into the executor, not the URL.
	req := cs.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(spec.Namespace).
		Name(spec.Pod).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: spec.Container,
			Command:   spec.Command,
			Stdin:     true,
			Stdout:    true,
			// Stderr:false with TTY:true is correct: the PTY merges stderr into
			// the stdout stream.  Setting both Stderr:true and TTY:true causes
			// some API server versions to reject the request.
			Stderr: false,
			TTY:    true,
		}, scheme.ParameterCodec)

	execURL := req.URL()

	// Preflight: verify the pod/container state before dialling.
	// This gives the user a clear message rather than a cryptic API error.
	if msg := preflightExec(ctx, cs, spec.Namespace, spec.Pod, spec.Container); msg != "" {
		return fmt.Errorf("%s", msg)
	}

	// Audit log the exec action before opening the stream.
	c.Audit.Record(audit.Entry{
		Action:    "exec",
		Cluster:   spec.Cluster,
		Namespace: spec.Namespace,
		Resource:  spec.Pod,
		Detail:    fmt.Sprintf("container=%s command=%s", spec.Container, strings.Join(spec.Command, " ")),
	})

	// ── Build executor with WS-first, SPDY fallback ───────────────────────
	//
	// NewWebSocketExecutor uses the "v5.channel.k8s.io" subprotocol (kube ≥1.29).
	// NewSPDYExecutor uses the legacy SPDY/3.1 upgrade (all versions).
	// NewFallbackExecutor wraps both: on a WS error that matches shouldFallback,
	// it transparently retries with SPDY.
	wsExec, errW := remotecommand.NewWebSocketExecutor(cfg, "GET", execURL.String())
	if errW != nil {
		return fmt.Errorf("websocket executor: %w", errW)
	}

	spdyExec, errS := remotecommand.NewSPDYExecutor(cfg, "POST", execURL)
	if errS != nil {
		return fmt.Errorf("spdy executor: %w", errS)
	}

	exec, err := remotecommand.NewFallbackExecutor(wsExec, spdyExec, shouldFallback)
	if err != nil {
		return fmt.Errorf("executor: %w", err)
	}

	// ── Bridge ────────────────────────────────────────────────────────────
	//
	// remotecommand.StreamWithContext runs three internal goroutines:
	//   1. stdin pump:  reads from opts.Stdin, writes to k8s channel 0.
	//   2. stdout pump: reads from k8s channel 1, writes to opts.Stdout.
	//   3. resize pump: calls opts.TerminalSizeQueue.Next() in a loop.
	//
	// All three are cancelled when ctx is cancelled or the remote command exits.
	out := chanWriter{write: write}
	opts := remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: out,
		// Stderr is the same writer: even though TTY merges streams on the k8s
		// side, having a non-nil Stderr here ensures any out-of-band errors from
		// the executor itself reach the client.
		Stderr:            out,
		Tty:               true,
		TerminalSizeQueue: sizeQueue{ch: resize},
	}

	if err := exec.StreamWithContext(ctx, opts); err != nil {
		// Distinguish "client cancelled" from real errors.  When the context is
		// done we return ctx.Err() so hub.go sends a clean chan-closed frame
		// with "context canceled" rather than a noise error string.
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return fmt.Errorf("session: %w", err)
		}
	}
	return nil
}
