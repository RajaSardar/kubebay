interface PageLoaderProps {
  message?: string;
  className?: string;
}

export function PageLoader({ message = "Loading…", className }: PageLoaderProps) {
  return (
    <div
      className={`page-loader${className ? ` ${className}` : ""}`}
      aria-busy="true"
      aria-label={message}
    >
      <span className="page-loader-spinner" aria-hidden="true" />
      <span className="page-loader-msg">{message}</span>
    </div>
  );
}
