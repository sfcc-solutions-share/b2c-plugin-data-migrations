// Re-export key types and functions for use by migration scripts
export type {
  MigrationScriptArguments,
  MigrationHelpers,
  MigrationLifecycleFunctions,
  MigrateInstanceOptions,
  ToolkitInstanceState,
  FeatureDefinition,
  FeatureContext,
  FeatureState,
  InstanceFeatureState,
} from './lib/types.js';

export {buildHelpers} from './lib/helpers.js';
export {migrateInstance, collectMigrations} from './lib/migrations.js';
export {collectFeatures, deployFeature, removeFeature} from './lib/features.js';
export {
  getInstanceState,
  updateInstanceMigrations,
  getInstanceFeatureState,
  updateFeatureState,
} from './lib/state.js';
export {
  bootstrapMigrations,
  bootstrapFeatures,
  isMigrationBootstrapRequired,
  isFeatureBootstrapRequired,
} from './lib/bootstrap.js';
