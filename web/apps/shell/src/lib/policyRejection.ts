export interface PolicyCause {
  type?: string;
  message?: string;
  field?: string;
}

export interface PolicyRejectionDetail {
  engine: string;
  webhook: string;
  message: string;
  causes?: PolicyCause[];
}

/**
 * Thrown by api.applyYaml when the engine detected a validating admission
 * webhook (Kyverno, Gatekeeper, or another) denying the apply — carries the
 * structured detail so YamlTab can render an active pre-flight guardrail
 * card instead of a generic error string.
 */
export class PolicyRejectionError extends Error {
  rejection: PolicyRejectionDetail;
  constructor(rejection: PolicyRejectionDetail) {
    super(rejection.message);
    this.name = "PolicyRejectionError";
    this.rejection = rejection;
  }
}

/**
 * Thrown by api.applyYaml when a field the user edited also changed on the
 * cluster after the editor loaded it (engine 409 "changed-since-load"). The
 * edit was not applied; YamlTab offers a reload instead of an overwrite.
 */
export class StaleEditError extends Error {
  paths: string[];
  constructor(paths: string[], message = "these fields changed on the cluster since the editor loaded them") {
    super(message);
    this.name = "StaleEditError";
    this.paths = paths;
  }
}
