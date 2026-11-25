import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi, emptyRun, reduceRun, type InvestigationRequest, type RunView } from "./aiInvestigate";

export type Phase = "idle" | "starting" | "running" | "ended" | "error";

/**
 * One investigation: start it, follow its stream, stop it. Leaving the page
 * aborts the stream, which stops the run engine-side; a run never outlives
 * the panel that shows it.
 */
export function useInvestigation() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<RunView>(emptyRun());
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async (req: InvestigationRequest) => {
    setPhase("starting");
    setRun(emptyRun());
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { id } = await aiApi.start(req);
      idRef.current = id;
      setPhase("running");
      await aiApi.stream(id, (e) => setRun((v) => reduceRun(v, e)), ctrl.signal);
      setPhase("ended");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const stop = useCallback(async () => {
    if (idRef.current) await aiApi.stop(idRef.current).catch(() => undefined);
  }, []);

  return { phase, run, error, start, stop };
}
