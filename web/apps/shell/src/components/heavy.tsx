import { lazy, Suspense, type ComponentProps } from "react";
import type { ExecTerm as ExecTermImpl } from "./ExecTerm";
import type { YamlTab as YamlTabImpl } from "./YamlTab";

// xterm (~330 kB) and the Monaco loader only matter once a shell or YAML tab is
// actually opened, so they are kept out of the initial chunk. Re-exported under
// the original names so call sites stay unchanged.

const ExecTermLazy = lazy(() => import("./ExecTerm").then((m) => ({ default: m.ExecTerm })));
const YamlTabLazy = lazy(() => import("./YamlTab").then((m) => ({ default: m.YamlTab })));

export function ExecTerm(props: ComponentProps<typeof ExecTermImpl>) {
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <ExecTermLazy {...props} />
    </Suspense>
  );
}

export function YamlTab(props: ComponentProps<typeof YamlTabImpl>) {
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <YamlTabLazy {...props} />
    </Suspense>
  );
}
