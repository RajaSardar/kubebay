package httpapi

import (
	"context"
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func shouldFallback(err error) bool {
	if err == nil {
		return false
	}
	return apierrors.IsBadRequest(err) ||
		apierrors.IsNotFound(err) ||
		apierrors.IsMethodNotSupported(err) ||
		apierrors.IsUnsupportedMediaType(err)
}

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

type chanWriter struct {
	write func([]byte) error
}

func (w chanWriter) Write(p []byte) (int, error) {
	buf := make([]byte, len(p))
	copy(buf, p)
	if err := w.write(buf); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *Channels) OpenExec(ctx context.Context, spec stream.ChanSpec, write func([]byte) error, stdin io.Reader, resize <-chan stream.TermSize) error {
	cfg, err := c.Clusters.RestConfigWithIdentity(spec.Cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return fmt.Errorf("client: %w", err)
	}
	if len(spec.Command) == 0 {
		spec.Command = []string{"sh"}
	}

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
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	execURL := req.URL()
	wsExec, errW := remotecommand.NewWebSocketExecutor(cfg, "GET", execURL.String())
	if errW != nil {
		return fmt.Errorf("websocket executor: %w", errW)
	}
	spdyExec, errS := remotecommand.NewSPDYExecutor(cfg, "POST", execURL)
	if errS != nil {
		return fmt.Errorf("spdy executor: %w", errS)
	}
	exec, err := remotecommand.NewFallbackExecutor(wsExec, spdyExec, func(err error) bool {
		return apierrors.IsBadRequest(err) || shouldFallback(err)
	})
	if err != nil {
		return fmt.Errorf("executor: %w", err)
	}

	out := chanWriter{write: write}
	opts := remotecommand.StreamOptions{
		Stdin:             stdin,
		Stdout:            out,
		Stderr:            out,
		Tty:               true,
		TerminalSizeQueue: sizeQueue{ch: resize},
	}
	if err := exec.StreamWithContext(ctx, opts); err != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return fmt.Errorf("session: %w", err)
		}
	}
	return nil
}
