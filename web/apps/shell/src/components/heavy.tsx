import { lazy, Suspense, type ComponentProps } from "react";
import type { ExecTerm as ExecTermImpl } from "./ExecTerm";
import type { YamlTab as YamlTabImpl } from "./YamlTab";
import type { KedaWizard as KedaWizardImpl } from "./KedaWizard";

// xterm (~330 kB) and the Monaco loader only matter once a shell, YAML tab, or
// the KEDA wizard is actually opened, so they are kept out of the initial
// chunk (and out of every test file's module graph that imports GenericDrawer
// transitively without opening one of these — a real regression this file's
// pattern exists to prevent, not just a bundle-size nicety). Re-exported
// under the original names so call sites stay unchanged.

const ExecTermLazy = lazy(() => import("./ExecTerm").then((m) => ({ default: m.ExecTerm })));
const YamlTabLazy = lazy(() => import("./YamlTab").then((m) => ({ default: m.YamlTab })));
const KedaWizardLazy = lazy(() => import("./KedaWizard").then((m) => ({ default: m.KedaWizard })));

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

export function KedaWizard(props: ComponentProps<typeof KedaWizardImpl>) {
  return (
    <Suspense fallback={<div className="tab-loading" />}>
      <KedaWizardLazy {...props} />
    </Suspense>
  );
}
