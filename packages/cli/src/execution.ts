import { ProofRequest } from "@prq/core";

/** Process-reported context, not an attestation of the host or running application. */
export function executionContext(env: NodeJS.ProcessEnv = process.env) {
  return ProofRequest.shape.execution.unwrap().parse({
    location: env.PRQ_EXECUTION_LOCATION ?? (env.CI === "true" || env.CI === "1" ? "ci" : "local"),
    executor: env.PRQ_EXECUTOR ?? "cli",
    application_revision: "unknown",
  });
}
