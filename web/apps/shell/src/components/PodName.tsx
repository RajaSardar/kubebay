import { splitPodName } from "../lib/podName";

/** A pod's full name, with its generated end (hash, random characters or ordinal) set apart. */
export function PodName({ name }: { name: string }) {
  const { base, suffix } = splitPodName(name);
  return (
    <>
      {base}
      {suffix && <span className="pod-suffix">{suffix}</span>}
    </>
  );
}
