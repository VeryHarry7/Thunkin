import type { IngestPort } from "../types";
import type { Job } from "@/lib/contracts";
import type { ProviderOutput } from "@/lib/provider";

/**
 * A development stand-in for AGENT-05's asset pipeline.
 *
 * It does nothing, so a job completes `ingesting → ready` with no asset row.
 * That is enough to prove the lifecycle end to end; it is not enough to show
 * anyone a picture, which is exactly AGENT-05's job.
 */
export const noopIngest: IngestPort = {
  async ingest(_job: Job, _outputs: ProviderOutput[]): Promise<void> {
    // Intentionally empty.
  },
};
