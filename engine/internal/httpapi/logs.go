package httpapi

import (
	"bufio"
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

type Channels struct {
	Clusters *clusters.Manager
}

func (c *Channels) clientset(ctx context.Context, cluster string) (*kubernetes.Clientset, error) {
	cfg, err := c.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(cfg)
}

func (c *Channels) OpenLogs(ctx context.Context, spec stream.ChanSpec, write func([]byte) error) error {
	cs, err := c.clientset(ctx, spec.Cluster)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	opts := &corev1.PodLogOptions{
		Container: spec.Container,
		Follow:    spec.Follow,
		Previous:  spec.Previous,
	}
	if spec.Tail > 0 {
		tail := spec.Tail
		opts.TailLines = &tail
	}
	rd, err := cs.CoreV1().Pods(spec.Namespace).GetLogs(spec.Pod, opts).Stream(ctx)
	if err != nil {
		return fmt.Errorf("log stream: %w", err)
	}
	defer rd.Close()

	sc := bufio.NewScanner(rd)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := make([]byte, len(sc.Bytes())+1)
		copy(line, sc.Bytes())
		line[len(line)-1] = '\n'
		if err := write(line); err != nil {
			return err
		}
	}
	return sc.Err()
}
