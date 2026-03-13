import * as path from 'node:path';
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {
  siteArchiveImport,
  siteArchiveExport,
  siteArchiveExportToBuffer,
  executeJob,
  waitForJob,
  type ExportDataUnitsConfiguration,
} from '@salesforce/b2c-tooling-sdk/operations/jobs';
import {
  findCartridges,
  uploadCartridges,
  deleteCartridges,
  reloadCodeVersion,
} from '@salesforce/b2c-tooling-sdk/operations/code';
import * as xml2js from 'xml2js';
import {createArchiveFromTextMap, extractArchiveToTextMap} from './archive-utils.js';
import {getInstanceFeatureState, updateFeatureState} from './state.js';
import type {MigrationHelpers, GlobalConfig} from './types.js';

/**
 * Import a site archive from a text map (Map<filename, content>).
 * Creates an in-memory zip and imports via the SDK.
 */
async function siteArchiveImportText(
  instance: B2CInstance,
  data: Map<string, string>,
  options: {archiveName?: string} = {},
): Promise<void> {
  const archiveName = options.archiveName ?? `text-import-${Date.now()}`;
  const buffer = await createArchiveFromTextMap(data, archiveName);
  await siteArchiveImport(instance, buffer, {archiveName});
}

/**
 * Export a site archive and return as a text map (Map<filename, content>).
 */
async function siteArchiveExportText(
  instance: B2CInstance,
  dataUnits: Partial<ExportDataUnitsConfiguration>,
): Promise<Map<string, string>> {
  const result = await siteArchiveExportToBuffer(instance, dataUnits);
  return extractArchiveToTextMap(result.data);
}

/**
 * Export a site archive and return as a map of filenames to parsed objects.
 * XML files are parsed via xml2js, JSON files via JSON.parse, others as strings.
 */
async function siteArchiveExportJSON(
  instance: B2CInstance,
  dataUnits: Partial<ExportDataUnitsConfiguration>,
): Promise<Map<string, unknown>> {
  const textMap = await siteArchiveExportText(instance, dataUnits);
  const jsonMap = new Map<string, unknown>();
  for (const [filename, contents] of textMap.entries()) {
    if (filename.endsWith('.json')) {
      try {
        jsonMap.set(filename, JSON.parse(contents));
      } catch {
        jsonMap.set(filename, {});
      }
    } else if (filename.endsWith('.xml')) {
      jsonMap.set(filename, await xml2js.parseStringPromise(contents));
    } else {
      jsonMap.set(filename, contents);
    }
  }
  return jsonMap;
}

/**
 * Import a site archive from a map of filenames to parsed objects.
 * XML files are built via xml2js.Builder, JSON files via JSON.stringify, others as strings.
 */
async function siteArchiveImportJSON(
  instance: B2CInstance,
  data: Map<string, unknown>,
  options: {archiveName?: string} = {},
): Promise<void> {
  const builder = new xml2js.Builder();
  const textMap = new Map<string, string>();
  for (const [filename, content] of data.entries()) {
    if (filename.endsWith('.json')) {
      textMap.set(filename, JSON.stringify(content, null, 2));
    } else if (filename.endsWith('.xml')) {
      textMap.set(filename, builder.buildObject(content));
    } else {
      textMap.set(filename, content as string);
    }
  }
  const archiveName = options.archiveName ?? `json-import-${Date.now()}`;
  const buffer = await createArchiveFromTextMap(textMap, archiveName);
  await siteArchiveImport(instance, buffer, {archiveName});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a helpers object pre-bound to the given instance.
 *
 * **Backward compatibility with b2c-tools:**
 * Existing migration scripts call helpers like `helpers.siteArchiveImport(env, path)`,
 * where `env` is the b2c-tools Environment object. Our wrappers accept and ignore
 * this first `env` argument, using the bound `instance` instead. This allows
 * existing setup.js and migration scripts to work without changes.
 *
 * Also exposes `helpers.CONFIG` with `MIGRATIONS_DIR`, `FEATURES_DIR`, and `VARS`
 * matching the b2c-tools global config pattern.
 */
export function buildHelpers(
  instance: B2CInstance,
  options: {
    migrationsDir?: string;
    featuresDir?: string;
    vars?: Record<string, unknown>;
  } = {},
): MigrationHelpers {
  const logger = getLogger();

  const CONFIG: GlobalConfig = {
    MIGRATIONS_DIR: path.resolve(options.migrationsDir ?? './migrations'),
    FEATURES_DIR: path.resolve(options.featuresDir ?? './features'),
    VARS: options.vars ?? {},
  };

  // Lazy-import migrateInstance to avoid circular dependency
  // (migrations.ts imports helpers.ts; helpers.migrateInstance would import migrations.ts)
  let _migrateInstanceFn: ((...args: unknown[]) => Promise<void>) | null = null;
  async function getMigrateInstance() {
    if (!_migrateInstanceFn) {
      const mod = await import('./migrations.js');
      _migrateInstanceFn = mod.migrateInstance as (...args: unknown[]) => Promise<void>;
    }
    return _migrateInstanceFn;
  }

  return {
    instance,
    CONFIG,

    // -----------------------------------------------------------------------
    // Jobs — backward-compat wrappers: accept (env, ...rest), ignore env
    // -----------------------------------------------------------------------

    // helpers.executeJob(env, jobId, params) → SDK executeJob(instance, jobId, { parameters: params })
    executeJob: async (_env: unknown, jobId: string, params?: unknown[]) => {
      const opts = params
        ? {parameters: params as {name: string; value: string}[]}
        : undefined;
      try {
        return await executeJob(instance, jobId, opts);
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('already running')) {
          logger.warn(`Job ${jobId} already running, waiting 10s and retrying...`);
          await sleep(10000);
          return executeJob(instance, jobId, opts);
        }
        throw e;
      }
    },

    // helpers.waitForJob(env, jobId, executionId) → SDK waitForJob(instance, jobId, executionId)
    waitForJob: async (_env: unknown, jobId: string, executionId: string) => {
      return waitForJob(instance, jobId, executionId);
    },

    // helpers.siteArchiveImport(env, target, opts?) → SDK siteArchiveImport(instance, target, opts?)
    siteArchiveImport: async (_env: unknown, target: unknown, opts?: unknown) => {
      return siteArchiveImport(
        instance,
        target as Parameters<typeof siteArchiveImport>[1],
        opts as Parameters<typeof siteArchiveImport>[2],
      );
    },

    // helpers.siteArchiveExport(env, dataUnits, filename?) → SDK siteArchiveExport(instance, dataUnits)
    siteArchiveExport: async (_env: unknown, dataUnits: unknown) => {
      return siteArchiveExport(instance, dataUnits as Partial<ExportDataUnitsConfiguration>);
    },

    // helpers.siteArchiveImportText(env, data, opts?) → create zip + import
    siteArchiveImportText: async (_env: unknown, data: Map<string, string>, opts?: {archiveName?: string}) => {
      return siteArchiveImportText(instance, data, opts);
    },

    // helpers.siteArchiveExportText(env, dataUnits) → export + extract
    siteArchiveExportText: async (_env: unknown, dataUnits: Partial<ExportDataUnitsConfiguration>) => {
      return siteArchiveExportText(instance, dataUnits);
    },

    // helpers.siteArchiveExportJSON(env, dataUnits) → export + parse XML/JSON
    siteArchiveExportJSON: async (_env: unknown, dataUnits: Partial<ExportDataUnitsConfiguration>) => {
      return siteArchiveExportJSON(instance, dataUnits);
    },

    // helpers.siteArchiveImportJSON(env, data, opts?) → build XML/JSON + import
    siteArchiveImportJSON: async (_env: unknown, data: Map<string, unknown>, opts?: {archiveName?: string}) => {
      return siteArchiveImportJSON(instance, data, opts);
    },

    // -----------------------------------------------------------------------
    // Code — backward-compat wrappers
    // -----------------------------------------------------------------------

    // findCartridges does NOT take env — pass through directly
    findCartridges,

    // helpers.uploadCartridges(env, cartridges) → SDK uploadCartridges(instance, cartridges)
    uploadCartridges: async (_env: unknown, cartridges: unknown) => {
      return uploadCartridges(instance, cartridges as Parameters<typeof uploadCartridges>[1]);
    },

    // helpers.deleteCartridges(env, cartridges) → SDK deleteCartridges(instance, cartridges)
    deleteCartridges: async (_env: unknown, cartridges: unknown) => {
      return deleteCartridges(instance, cartridges as Parameters<typeof deleteCartridges>[1]);
    },

    // helpers.reloadCodeVersion(env) → SDK reloadCodeVersion(instance)
    reloadCodeVersion: async (_env?: unknown) => {
      return reloadCodeVersion(instance);
    },

    // helpers.syncCartridges(env, cartridges, reload, opts) → upload + optional reload
    syncCartridges: async (_env: unknown, cartridges: unknown, reload?: boolean, _opts?: unknown) => {
      await uploadCartridges(instance, cartridges as Parameters<typeof uploadCartridges>[1]);
      if (reload) {
        await reloadCodeVersion(instance);
      }
    },

    // helpers.migrateInstance(env, dir, opts) → migrateInstance(instance, clientId, dir, opts)
    migrateInstance: async (_env: unknown, dir: string, opts?: unknown) => {
      const fn = await getMigrateInstance();
      // We don't have clientId here; use the instance's oauth clientId
      const clientId = instance.auth.oauth?.clientId ?? 'unknown';
      return fn(instance, clientId, dir, opts);
    },

    // -----------------------------------------------------------------------
    // Features — backward-compat wrappers
    // -----------------------------------------------------------------------

    // helpers.deployFeature(env, featureName, opts) → deployFeature(instance, clientId, featureName, opts)
    deployFeature: async (_env: unknown, featureName: string, opts?: unknown) => {
      const {deployFeature: _deployFeature} = await import('./features.js');
      const clientId = instance.auth.oauth?.clientId ?? 'unknown';
      return _deployFeature(instance, clientId, featureName, opts as Parameters<typeof _deployFeature>[3]);
    },

    // helpers.removeFeature(env, featureName, opts) → removeFeature(instance, featureName, opts)
    removeFeature: async (_env: unknown, featureName: string, opts?: unknown) => {
      const {removeFeature: _removeFeature} = await import('./features.js');
      return _removeFeature(instance, featureName, opts as Parameters<typeof _removeFeature>[2]);
    },

    // helpers.collectFeatures(dir) → collectFeatures(dir)
    collectFeatures: async (dir: string) => {
      const {collectFeatures: _collectFeatures} = await import('./features.js');
      return _collectFeatures(dir);
    },

    // helpers.getInstanceFeatureState(env) → getInstanceFeatureState(instance)
    getInstanceFeatureState: async (_env?: unknown) => {
      return getInstanceFeatureState(instance);
    },

    // helpers.updateFeatureState(env, featureName, vars, secretVars, saveSecrets)
    updateFeatureState: async (
      _env: unknown,
      featureName: string,
      vars: Record<string, unknown>,
      secretVars: string[] | undefined,
      saveSecrets: boolean,
    ) => {
      return updateFeatureState(instance, featureName, vars, secretVars, saveSecrets);
    },

    // -----------------------------------------------------------------------
    // Permission stubs (not implemented — log warning)
    // -----------------------------------------------------------------------

    ensureDataAPIPermissions: async (_env: unknown, _resources: unknown, testFn?: () => Promise<boolean>) => {
      logger.warn('ensureDataAPIPermissions is not implemented in this plugin; ensure your client ID has the necessary OCAPI Data API permissions');
      // Run the test function if provided to check if permissions are already in place
      if (typeof testFn === 'function') {
        try {
          await testFn();
        } catch (e) {
          logger.warn(`Permission test failed: ${e}. Ensure OCAPI permissions are configured.`);
        }
      }
    },

    ensureWebDAVPermissions: async (_env: unknown, _resources?: unknown) => {
      logger.warn('ensureWebDAVPermissions is not implemented in this plugin; ensure your client ID has WebDAV permissions configured');
    },

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    sleep,
  };
}
