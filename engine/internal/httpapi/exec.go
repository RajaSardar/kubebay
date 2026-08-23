package httpapi

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

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func preflightExec(ctx context.Context, cs *kubernetes.Clientset, ns, podName, container string) string {
	p, err := cs.CoreV1().Pods(ns).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return fmt.Sprintf("pod unavailable: %v", err)
	}
	if p.Status.Phase != corev1.PodRunning {
		return fmt.Sprintf("pod %s/%s is %s — terminal needs a Running pod", ns, podName, strings.ToLower(string(p.Status.Phase)))
	}
	if container == "" {
		return ""
	}
	for _, st := range p.Status.ContainerStatuses {
		if st.Name == container {
			if st.State.Running == nil {
				return fmt.Sprintf("container %q is not running yet", container)
			}
			return ""
		}
	}
	for _, c := range p.Spec.Containers {
		if c.Name == container {
			return fmt.Sprintf("container %q exists but has no runtime status yet", container)
		}
	}
	return fmt.Sprintf("container %q not found in pod (has: naming %d containers)", container, len(p.Spec.Containers))
}

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
			Stderr:    false,
			TTY:       true,
		}, scheme.ParameterCodec)

	execURL := req.URL()
	if pre := preflightExec(ctx, cs, spec.Namespace, spec.Pod, spec.Container); pre != "" {
		return fmt.Errorf("%s", pre)
	}

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
