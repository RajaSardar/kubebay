import { Card } from "@kubebay/ui";
import { ImageSignatureCheck } from "./ImageSignatureCheck";

/**
 * Intelligence roadmap Tier 2 #17: is a signature published for each image
 * digest actually running? Complements #32's "is verification enforced?".
 * Runs only on request because it contacts every image's registry.
 */
export function RunningImageSignaturesCard({ cluster }: { cluster: string }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <ImageSignatureCheck cluster={cluster} title={<strong>Running image signatures</strong>} />
    </Card>
  );
}
