// Backlog 61: several pods share a name up to a generated end. This finds that
// end by the shapes Kubernetes gives it, so lists can set it apart.
//
//   Deployment   web-7d9f8c6b5d-x2k4q   ReplicaSet hash, then five characters
//   DaemonSet    node-exporter-9fz7k    five characters
//   StatefulSet  db-0                   ordinal
//
// The random characters come from a set without vowels or look-alikes
// (bcdfghjklmnpqrstvwxz2456789), which keeps a plain word from being read as one.
const RANDOM5 = "[bcdfghjklmnpqrstvwxz2456789]{5}";
const DEPLOYMENT = new RegExp(`^(.+?)(-[bcdfghjklmnpqrstvwxz2456789]{6,10}-${RANDOM5})$`);
const FIVE = new RegExp(`^(.+?)(-${RANDOM5})$`);
const ORDINAL = /^(.+?)(-\d+)$/;

export function splitPodName(name: string): { base: string; suffix: string } {
  for (const re of [DEPLOYMENT, FIVE, ORDINAL]) {
    const m = re.exec(name);
    if (m) return { base: m[1]!, suffix: m[2]! };
  }
  return { base: name, suffix: "" };
}
