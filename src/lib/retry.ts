import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {
  siteArchiveImport,
  siteArchiveExport,
  siteArchiveExportToBuffer,
} from '@salesforce/b2c-tooling-sdk/operations/jobs';

/**
 * Transient site-archive job failures worth retrying.
 *
 * - "the job is already running" — the `sfcc-site-archive-import` and
 *   `sfcc-site-archive-export` jobs are instance-wide, not site-scoped, so a
 *   concurrent deploy (or a prior job that has not released server-side yet)
 *   makes the SDK's raw `POST /jobs/.../executions` fail immediately. The SDK's
 *   `siteArchiveImport`/`siteArchiveExport` bypass `executeJob`, so they do NOT
 *   inherit `executeJob`'s built-in wait-for-running retry — these wrappers
 *   supply it.
 * - The reset/hang-up messages are transient network drops; retrying either
 *   succeeds or converges on the "already running" case if the job did start
 *   server-side.
 *
 * Matched case-insensitively against the error message.
 */
const RETRIABLE_JOB_ERRORS = [
  'the job is already running',
  'already running',
  'the connection was reset',
  'socket hang up',
];

/**
 * Poll interval between retries.
 */
const RETRY_INTERVAL_MS = 30_000;

/**
 * Ceiling on total retry wait (15 mins)
 */
const MAX_WAIT_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableJobError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return RETRIABLE_JOB_ERRORS.some((needle) => message.includes(needle));
}

/**
 * Run a site-archive job operation, retrying on transient failures.
 *
 * Retries while `run` fails with a retriable message (see
 * {@link RETRIABLE_JOB_ERRORS}): an instance-wide "already running" collision
 * from a concurrent deploy, or a network reset/hang-up mid-operation. Each retry
 * doubles as a poll — it either succeeds once the condition clears or fails
 * again with a retriable message. Any other failure re-raises without retrying.
 *
 * @param operationLabel - Human-readable label used in the retry log line
 * @param run - The SDK operation to (re)invoke
 * @returns The operation result
 */
async function runWithRetry<T>(operationLabel: string, run: () => Promise<T>): Promise<T> {
  const logger = getLogger();
  const deadline = Date.now() + MAX_WAIT_MS;

  while (true) {
    try {
      return await run();
    } catch (e: unknown) {
      if (!isRetriableJobError(e) || Date.now() >= deadline) {
        throw e;
      }
      const waitSeconds = Math.round(RETRY_INTERVAL_MS / 1000);
      logger.warn(
        `${operationLabel} failed with a transient error; retrying in ${waitSeconds}s: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Wraps the SDK `siteArchiveImport`, retrying on transient failures.
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
  return runWithRetry('Site-archive import', () => siteArchiveImport(instance, target, options));
}

/**
 * Wraps the SDK `siteArchiveExport`, retrying on transient failures.
 *
 * Signature-compatible with the SDK `siteArchiveExport`.
 *
 * @param instance - B2C instance to export from
 * @param dataUnits - Data units configuration specifying what to export
 * @param options - Export options (passed through to the SDK)
 * @returns The SDK export result
 */
export async function siteArchiveExportWithRetry(
  instance: B2CInstance,
  dataUnits: Parameters<typeof siteArchiveExport>[1],
  options?: Parameters<typeof siteArchiveExport>[2],
): Promise<Awaited<ReturnType<typeof siteArchiveExport>>> {
  return runWithRetry('Site-archive export', () => siteArchiveExport(instance, dataUnits, options));
}

/**
 * Wraps the SDK `siteArchiveExportToBuffer`, retrying on transient failures.
 *
 * Signature-compatible with the SDK `siteArchiveExportToBuffer`.
 *
 * @param instance - B2C instance to export from
 * @param dataUnits - Data units configuration specifying what to export
 * @param options - Export and download options (passed through to the SDK)
 * @returns The SDK export result with archive data buffer
 */
export async function siteArchiveExportToBufferWithRetry(
  instance: B2CInstance,
  dataUnits: Parameters<typeof siteArchiveExportToBuffer>[1],
  options?: Parameters<typeof siteArchiveExportToBuffer>[2],
): Promise<Awaited<ReturnType<typeof siteArchiveExportToBuffer>>> {
  return runWithRetry('Site-archive export', () =>
    siteArchiveExportToBuffer(instance, dataUnits, options),
  );
}
