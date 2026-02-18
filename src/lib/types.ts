import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import type {Logger} from '@salesforce/b2c-tooling-sdk/logging';
import type {
  siteArchiveImport,
  siteArchiveExport,
  executeJob,
  waitForJob,
  ExportDataUnitsConfiguration,
} from '@salesforce/b2c-tooling-sdk/operations/jobs';
import type {
  findCartridges,
  uploadCartridges,
  deleteCartridges,
  reloadCodeVersion,
  CartridgeMapping,
} from '@salesforce/b2c-tooling-sdk/operations/code';
import type {LegacyEnvironment} from './environment.js';

// ---------------------------------------------------------------------------
// Instance State (Migrations)
// ---------------------------------------------------------------------------

export interface ToolkitInstanceState {
  /** c_b2cToolkitDataVersion */
  version: number | null;
  /** c_b2cToolkitMigrations split by ',' */
  migrations: string[];
  /** c_b2cToolsBootstrappedClientIDs parsed JSON */
  clients: Record<string, {version: number}>;
  /** c_b2cToolsVars parsed JSON */
  vars: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Instance State (Features)
// ---------------------------------------------------------------------------

export interface FeatureState {
  featureName: string;
  vars: Record<string, unknown>;
  creationDate: Date;
  lastModified: Date;
}

export interface InstanceFeatureState {
  b2cToolsFeaturesVersion: number | null;
  b2cToolsFeaturesBootstrappedClientIDs: Record<string, {version: number}>;
  features: FeatureState[];
}

// ---------------------------------------------------------------------------
// Migration Lifecycle
// ---------------------------------------------------------------------------

export interface MigrationScriptArguments {
  instance: B2CInstance;
  logger: Logger;
  helpers: MigrationHelpers;
  vars: Record<string, unknown>;
  /** Legacy b2c-tools Environment adapter for backward compat */
  env: LegacyEnvironment;
}

export interface MigrationLifecycleFunctions {
  init?(args: MigrationScriptArguments): Promise<void>;
  shouldBootstrap?(args: MigrationScriptArguments, state: ToolkitInstanceState): Promise<boolean>;
  onBootstrap?(args: MigrationScriptArguments, state: ToolkitInstanceState): Promise<void>;
  beforeAll?(
    args: MigrationScriptArguments,
    migrations: string[],
    willApply: boolean,
    dryRun: boolean,
  ): Promise<void>;
  beforeEach?(
    args: MigrationScriptArguments,
    migration: string,
    willApply: boolean,
  ): Promise<boolean>;
  afterEach?(
    args: MigrationScriptArguments,
    migration: string,
    willApply: boolean,
  ): Promise<void>;
  afterAll?(
    args: MigrationScriptArguments,
    migrationsRan: string[],
    willApply: boolean,
  ): Promise<void>;
  onFailure?(args: MigrationScriptArguments, migration: string, error: Error): Promise<void>;
}

// ---------------------------------------------------------------------------
// Migration Options
// ---------------------------------------------------------------------------

export interface MigrateInstanceOptions {
  /** Array of regular expression strings to exclude migrations */
  exclude?: string[];
  /** Should migrations be applied to the instance after running? (default: true) */
  apply?: boolean;
  /** Only output migrations to be run (default: false) */
  dryRun?: boolean;
  /** Force a bootstrap/upgrade (default: false) */
  forceBootstrap?: boolean;
  /** Allow bootstrap/upgrade (default: true) */
  allowBootstrap?: boolean;
  /** Vars to pass to migration scripts */
  vars?: Record<string, unknown>;
  /** Show notes from migration scripts (default: true) */
  showNotes?: boolean;
  /** SCAPI short code for legacy env.scapi support */
  shortCode?: string;
}

// ---------------------------------------------------------------------------
// Feature Definitions
// ---------------------------------------------------------------------------

export interface FeatureContext {
  featureHelpers: FeatureHelpers;
  featuresDir: string;
  saveSecrets: boolean;
  instanceState: InstanceFeatureState;
}

export interface FeatureDefinition {
  featureName: string;
  path: string;
  requires?: string[];
  defaultVars?: Record<string, unknown>;
  secretVars?: string[];
  questions?:
    | unknown[]
    | ((args: MigrationScriptArguments, ctx: FeatureContext) => Promise<unknown[]>);
  excludeMigrations?: string[];
  excludeCartridges?: string[];
  beforeDeploy?(args: MigrationScriptArguments): Promise<void>;
  remove?(args: MigrationScriptArguments, ctx: FeatureContext): Promise<void>;
  finish?(args: MigrationScriptArguments, ctx: FeatureContext): Promise<void>;
}

export interface DeployFeatureOptions {
  featuresDir: string;
  vars?: Record<string, unknown>;
  saveSecrets?: boolean;
  /** SCAPI short code for legacy env.scapi support */
  shortCode?: string;
}

export interface RemoveFeatureOptions {
  featuresDir: string;
  vars?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global Config (backward-compatible with b2c-tools CONFIG)
// ---------------------------------------------------------------------------

export interface GlobalConfig {
  MIGRATIONS_DIR: string;
  FEATURES_DIR: string;
  VARS: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers Facade
// ---------------------------------------------------------------------------

/**
 * The MigrationHelpers interface provides backward-compatible helper functions.
 *
 * **Backward compatibility:** Existing b2c-tools scripts call helpers with `env`
 * as the first argument (e.g. `helpers.siteArchiveImport(env, path)`). These
 * wrappers accept and ignore the first `env` argument, using the bound instance
 * instead. This allows existing setup.js and migration scripts to work unchanged.
 */
export interface MigrationHelpers {
  instance: B2CInstance;

  /** Global config with MIGRATIONS_DIR, FEATURES_DIR, VARS */
  CONFIG: GlobalConfig;

  // Jobs — accept (env, ...args) for backward compat, env is ignored
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeJob: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitForJob: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siteArchiveImport: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siteArchiveExport: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siteArchiveImportText: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siteArchiveExportText: (...args: any[]) => Promise<Map<string, string>>;

  // Code
  findCartridges: typeof findCartridges;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadCartridges: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteCartridges: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reloadCodeVersion: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncCartridges: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrateInstance: (...args: any[]) => Promise<void>;

  // Features
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getInstanceFeatureState: (...args: any[]) => Promise<InstanceFeatureState | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateFeatureState: (...args: any[]) => Promise<void>;

  // Stubs for permissions (not implemented — log warning)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ensureDataAPIPermissions: (...args: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ensureWebDAVPermissions: (...args: any[]) => Promise<void>;

  // Utilities
  sleep: (ms: number) => Promise<void>;
}

export interface FeatureHelpers {
  deployFeature: (
    instance: B2CInstance,
    clientId: string,
    featureName: string,
    options?: Partial<DeployFeatureOptions>,
  ) => Promise<void>;
  removeFeature: (
    instance: B2CInstance,
    featureName: string,
    options: RemoveFeatureOptions,
  ) => Promise<void>;
  updateFeatureState: MigrationHelpers['updateFeatureState'];
  collectFeatures: (dir: string) => Promise<FeatureDefinition[]>;
}

// Re-export SDK types used in public API
export type {B2CInstance, Logger, CartridgeMapping, ExportDataUnitsConfiguration};
