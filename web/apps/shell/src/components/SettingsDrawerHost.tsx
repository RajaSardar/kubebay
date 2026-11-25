import { Component, Suspense, type ComponentType, type ReactNode } from "react";
import { Button, Drawer, InlineBanner, SkeletonLines } from "@kubebay/ui";

type DrawerProps = { onClose: () => void; onManageKubeconfigs: () => void };

class ChunkBoundary extends Component<{ fallback: (error: Error) => ReactNode; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/** Shows the lazily loaded settings drawer: a skeleton while its code loads, a banner with Retry if that fails. */
export function SettingsDrawerHost({ Drawer: Lazy, onRetry, onClose, onManageKubeconfigs }: DrawerProps & { Drawer: ComponentType<DrawerProps>; onRetry: () => void }) {
  return (
    <ChunkBoundary
      fallback={() => (
        <Drawer title="Settings" onClose={onClose}>
          <InlineBanner actions={<Button onClick={onRetry}>Retry</Button>}>Couldn&apos;t load settings.</InlineBanner>
        </Drawer>
      )}
    >
      <Suspense
        fallback={
          <Drawer title="Settings" onClose={onClose}>
            <SkeletonLines lines={6} />
          </Drawer>
        }
      >
        <Lazy onClose={onClose} onManageKubeconfigs={onManageKubeconfigs} />
      </Suspense>
    </ChunkBoundary>
  );
}
