// Small readers for .github/workflows/*.yml, shared by the KB-02 guard tests.
// They read the files as text: the workflows keep jobs at two spaces and steps
// at six, as every workflow in this repo does.

// The lines of one top-level job, by its key under `jobs:`, up to the next
// line at the jobs' indent (another job, or a comment about it).
export function jobBlock(yaml, name) {
  const all = yaml.split("\n");
  const start = all.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return "";
  const end = all.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return all.slice(start, end < 0 ? undefined : end).join("\n");
}

// The job's steps, each as its own text.
export function steps(job) {
  return job.split(/\n(?= {6}- )/).slice(1);
}

// Whether the perf job's Budgets step fails the job on a breach: it passes an
// exact `--fail` token (perf-budgets.mjs checks argv.includes("--fail")) and
// nothing swallows the failure.
export function budgetsFail(ciYaml) {
  const step = steps(jobBlock(ciYaml, "perf")).find((s) => s.includes("scripts/perf-budgets.mjs"));
  if (!step || /continue-on-error:\s*true/.test(step)) return false;
  const command = step
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n")
    .replace(/\\\n/g, " ");
  if (/\|\|\s*true\b/.test(command)) return false;
  return command.split(/\s+/).includes("--fail");
}
