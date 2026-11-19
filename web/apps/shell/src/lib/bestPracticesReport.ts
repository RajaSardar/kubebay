import { summarize, type BestPracticeCheck, type CoverageItem } from "./bestPractices";

export interface BestPracticesReportInput {
  cluster: string;
  generatedAt: string;
  checks: BestPracticeCheck[];
  coverage: CoverageItem[];
}

const LABEL = { pass: "Pass", fail: "Fail", unknown: "Unknown", ignored: "Ignored" } as const;

export function reportToJSON(r: BestPracticesReportInput): string {
  return JSON.stringify(
    {
      tool: "kubebay best practices",
      cluster: r.cluster,
      generatedAt: r.generatedAt,
      summary: summarize(r.checks),
      coverage: r.coverage,
      checks: r.checks.map((c) => ({
        id: c.id,
        group: c.group,
        title: c.title,
        severity: c.severity,
        status: c.status,
        detail: c.detail,
        why: c.why,
        offenders: c.allOffenders ?? c.offenders ?? [],
        reference: c.reference,
        exceptions: c.exceptions,
      })),
    },
    null,
    2,
  );
}

export function reportToMarkdown(r: BestPracticesReportInput): string {
  const s = summarize(r.checks);
  const lines = [
    `# Best practices: ${r.cluster}`,
    "",
    `Generated ${r.generatedAt}.`,
    "",
    `${s.score}% pass: ${s.pass} pass, ${s.fail} fail, ${s.unknown} unknown. ${s.ignored} ignored and left out of the score.`,
    "",
    "## Workload coverage",
    "",
    ...r.coverage.map((c) => `- ${c.kind}: ${c.read ? c.count : "not read"}`),
    "",
    "## Checks",
    "",
    "| Check | Severity | Status | Detail |",
    "| --- | --- | --- | --- |",
    ...r.checks.map((c) => {
      const tag = c.reference ? ` (${c.reference}, reference)` : "";
      const why = c.exceptions?.length ? ` Ignored: ${c.exceptions.map((e) => (e.namespace ? `${e.namespace}: ` : "") + e.reason).join("; ")}.` : "";
      return `| ${esc(c.title)}${tag} | ${c.severity} | ${LABEL[c.status]} | ${esc(c.detail + why)} |`;
    }),
    "",
    "The CIS ids are references to the CIS Kubernetes Benchmark, not a compliance result.",
    "",
  ];
  return lines.join("\n");
}

function esc(t: string): string {
  return t.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
