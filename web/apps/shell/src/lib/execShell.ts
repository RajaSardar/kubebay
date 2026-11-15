export type ShellMode = "auto" | "bash" | "sh" | "ash" | "powershell" | "node";

// The pattern ExecTerm already used for pod exec: try a shell, fall back to
// the next candidate on a "not found"-shaped exit. The "node" mode reuses
// that exact ladder for the shell nsenter finally lands on -- it's the
// node's own filesystem after nsenter -m switches into it, so which shells
// exist there is just as unpredictable as inside an arbitrary container.
const SHELL_CANDIDATES: Record<ShellMode, string[][]> = {
  auto: [["bash", "-l"], ["sh"], ["ash"]],
  bash: [["bash", "-l"]],
  sh: [["sh"]],
  ash: [["ash"]],
  powershell: [["powershell"]],
  node: [
    ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "bash", "-l"],
    ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "sh", "-l"],
    ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "ash", "-l"],
  ],
};

export function shellCandidates(shell: ShellMode): string[][] {
  return SHELL_CANDIDATES[shell] ?? SHELL_CANDIDATES.auto;
}
