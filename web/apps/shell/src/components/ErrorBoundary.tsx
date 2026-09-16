import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Remounts the boundary's children (and clears the error) whenever this changes. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

// Without this, any uncaught render error unmounts the whole React tree and
// leaves a blank screen with no way to recover short of a full app restart.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[kubebay] render crash", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
        <div className="empty-state" style={{ maxWidth: 600 }}>
          <p>⚠️ Something went wrong rendering this view</p>
          <p className="muted small mono" style={{ wordBreak: "break-word", marginTop: 8, padding: "8px 12px", backgroundColor: "rgba(0,0,0,0.1)", borderRadius: "4px" }}>
            {error.message || "Unknown error"}
          </p>
          {error.stack && (
            <p className="muted small mono" style={{ wordBreak: "break-all", marginTop: 12, fontSize: "10px", maxHeight: "200px", overflowY: "auto" }}>
              {error.stack}
            </p>
          )}
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              type="button"
              className="ns-clear"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="ns-clear"
              style={{ opacity: 0.5 }}
              onClick={() => window.location.href = "/"}
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
