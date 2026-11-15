import { Spinner } from "@kubebay/ui";

interface PageLoaderProps {
  message?: string;
  className?: string;
}

/** A wait with no shape to sketch (a graph, a matrix, a report): the spinner and what it waits for. */
export function PageLoader({ message = "Loading…", className }: PageLoaderProps) {
  return (
    <div className={`page-loader${className ? ` ${className}` : ""}`} aria-busy="true">
      <Spinner label={message} size={28} />
      <span className="page-loader-msg" aria-hidden="true">{message}</span>
    </div>
  );
}
