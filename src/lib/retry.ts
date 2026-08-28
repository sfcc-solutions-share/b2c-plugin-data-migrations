import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {siteArchiveImport} from '@salesforce/b2c-tooling-sdk/operations/jobs';

/**
 * Transient site-archive import failures worth retrying.
 *
 * - "the job is already running" — the `sfcc-site-archive-import` job is
 *   instance-wide, not site-scoped, so a concurrent deploy (or a prior job that
 *   has not released server-side yet) makes the SDK's raw `POST
 *   /jobs/.../executions` fail immediately. The SDK's `siteArchiveImport`
 *   bypasses `executeJob`, so it does NOT inherit `executeJob`'s built-in
 *   wait-for-running retry — this wrapper supplies it.
 * - The reset/hang-up messages are transient network drops; retrying either
 *   succeeds or converges on the "already running" case if the job did start
 *   server-side.
 *
 * Matched case-insensitively against the error message.
 */
const RETRIABLE_IMPORT_ERRORS = [
  'the job is already running',
  'already running',
  'the connection was reset',
  'socket hang up',
];

/**
 * Poll interval between retries.
 */
const IMPORT_RETRY_INTERVAL_MS = 30_000;

/**
 * Ceiling on total retry wait (15 mins)
 */
const IMPORT_MAX_WAIT_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableImportError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return RETRIABLE_IMPORT_ERRORS.some((needle) => message.includes(needle));
}

/**
 * Wraps the SDK `siteArchiveImport`, retrying on transient failures.
 *
 * Retries while the import fails with a retriable message (see
 * {@link RETRIABLE_IMPORT_ERRORS}): an instance-wide "already running" collision
 * from a concurrent deploy, or a network reset/hang-up mid-import. Each retry
 * doubles as a poll — it either succeeds once the condition clears or fails
 * again with a retriable message. Any other failure re-raises without retrying.
 *
 * Signature-compatible with the SDK `siteArchiveImport`.
 *
 * @param instance - B2C instance to import to
 * @param target - Source to import (directory path, zip file path, Buffer, or remote filename)
 * @param options - Import options (passed through to the SDK)
 * @returns The SDK import result
 */
export async function siteArchiveImportWithRetry(
  instance: B2CInstance,
  target: Parameters<typeof siteArchiveImport>[1],
  options?: Parameters<typeof siteArchiveImport>[2],
): Promise<Awaited<ReturnType<typeof siteArchiveImport>>> {
  const logger = getLogger();
  const deadline = Date.now() + IMPORT_MAX_WAIT_MS;

  while (true) {
    try {
      return await siteArchiveImport(instance, target, options);
    } catch (e: unknown) {
      if (!isRetriableImportError(e) || Date.now() >= deadline) {
        throw e;
      }
      const waitSeconds = Math.round(IMPORT_RETRY_INTERVAL_MS / 1000);
      logger.warn(
        `Site-archive import failed with a transient error; retrying in ${waitSeconds}s: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      await sleep(IMPORT_RETRY_INTERVAL_MS);
    }
  }
}
