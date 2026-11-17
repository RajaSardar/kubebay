import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Modal, Row, Stack } from "@kubebay/ui";
import { api } from "../lib/api";
import {
  compareSemver,
  readLastSeen,
  releasesToShow,
  WHATS_NEW_RELEASES,
  writeLastSeen,
  type WhatsNewRelease,
} from "../lib/whatsNew";

const vPrefixed = (v: string) => (v.startsWith("v") ? v : `v${v}`);

/**
 * After an update (by hand or automatic), lists what changed in every release
 * since the version this machine last showed it for, once. The running version
 * comes from the engine; a first run, a dev build and an unchanged version show
 * nothing. Dismissing remembers the version.
 */
export function WhatsNew({ releases = WHATS_NEW_RELEASES }: { releases?: WhatsNewRelease[] }) {
  const engine = useQuery({ queryKey: ["engine-version"], queryFn: api.version, staleTime: Infinity, retry: false });
  const current = engine.data?.version;
  const [dismissed, setDismissed] = useState(false);
  const [lastSeen] = useState(readLastSeen);

  const toShow = current ? releasesToShow(releases, lastSeen, current) : [];

  // First run: nothing to show, so remember where we are. A new version the changelog
  // doesn't cover is remembered too, so the window waits for the next one that does.
  useEffect(() => {
    if (!current || toShow.length > 0) return;
    const cmp = lastSeen ? compareSemver(current, lastSeen) : compareSemver(current, current);
    if (cmp === null || (lastSeen && cmp <= 0)) return;
    writeLastSeen(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current || dismissed || toShow.length === 0) return null;

  const dismiss = () => {
    writeLastSeen(current);
    setDismissed(true);
  };
  const newest = toShow[0]!;
  const oldest = toShow[toShow.length - 1]!;
  const several = toShow.length > 1;
  const title = several
    ? `What's new in Kubebay ${vPrefixed(oldest.version)} to ${vPrefixed(newest.version)}`
    : `What's new in Kubebay ${vPrefixed(newest.version)}`;

  return (
    <Modal label={title} title={title} onClose={dismiss} placement="center" size="wide">
      <Stack gap={3}>
        <div data-testid="whatsnew-scroll" style={{ maxHeight: "55vh", overflowY: "auto" }}>
          <Stack gap={3}>
            {toShow.map((r) => (
              <Stack key={r.version} gap={2}>
                {several && <h3 style={{ margin: 0 }}>{vPrefixed(r.version)}</h3>}
                {r.sections.map((s) => (
                  <Stack key={s.heading} gap={1}>
                    <h4 className="small muted" style={{ margin: 0 }}>
                      {s.heading}
                    </h4>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {s.items.map((i, n) => (
                        <li key={n}>
                          <strong>{i.title}</strong>
                          {i.summary && <> {i.summary}</>}
                        </li>
                      ))}
                    </ul>
                  </Stack>
                ))}
              </Stack>
            ))}
          </Stack>
        </div>
        <Row justify="between" gap={2} align="center">
          <a
            className="small"
            href={`https://github.com/RajaSardar/kubebay/releases/tag/${vPrefixed(newest.version)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full release notes
          </a>
          <Button variant="primary" onClick={dismiss}>
            Got it
          </Button>
        </Row>
      </Stack>
    </Modal>
  );
}
