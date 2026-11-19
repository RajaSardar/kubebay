import { useState } from "react";
import { Button, Modal, Row, Stack } from "@kubebay/ui";
import { reportToJSON, reportToMarkdown } from "../lib/bestPracticesReport";
import type { BestPracticeCheck, CoverageItem } from "../lib/bestPractices";
import { save, stamp } from "./FindingsExport";

const FORMATS = [
  { label: "JSON", ext: "json", type: "application/json", write: reportToJSON },
  { label: "Markdown", ext: "md", type: "text/markdown", write: reportToMarkdown },
] as const;

/**
 * Saves the best-practices result, ignored checks and coverage included, as JSON
 * or Markdown. The file is built here and sent nowhere.
 */
export function BestPracticesExport({ cluster, checks, coverage }: { cluster: string; checks: BestPracticeCheck[]; coverage: CoverageItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Export report
      </Button>
      {open && (
        <Modal label="Export best practices" title="Export best practices" placement="center" onClose={() => setOpen(false)}>
          <Stack gap={3}>
            <div className="muted small">
              The checklist as it stands now: every check with its status and severity, what the workload checks covered, and the checks you
              ignored with your reasons. The file is saved on this machine and sent nowhere.
            </div>
            <Row gap={2} wrap>
              {FORMATS.map((f) => (
                <Button
                  key={f.ext}
                  onClick={() => {
                    const at = new Date();
                    save(
                      `kubebay-best-practices-${cluster.replace(/[^A-Za-z0-9._-]+/g, "-")}-${stamp(at)}.${f.ext}`,
                      f.type,
                      f.write({ cluster, generatedAt: at.toISOString(), checks, coverage }),
                    );
                  }}
                >
                  {`Save ${f.label}`}
                </Button>
              ))}
            </Row>
          </Stack>
        </Modal>
      )}
    </>
  );
}
