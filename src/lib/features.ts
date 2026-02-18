import * as fs from 'node:fs';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {
  findCartridges,
  uploadCartridges,
  getActiveCodeVersion,
} from '@salesforce/b2c-tooling-sdk/operations/code';
import {buildHelpers} from './helpers.js';
import {LegacyEnvironment} from './environment.js';
import {getInstanceFeatureState, updateFeatureState} from './state.js';
import {isFeatureBootstrapRequired, bootstrapFeatures} from './bootstrap.js';
import {migrateInstance} from './migrations.js';
import type {
  FeatureDefinition,
  FeatureContext,
  FeatureHelpers,
  DeployFeatureOptions,
  RemoveFeatureOptions,
  MigrationScriptArguments,
} from './types.js';

const _require = createRequire(import.meta.url);

/**
 * Scan a features directory for subdirectories containing `feature.js`.
 * Returns an array of feature definitions with resolved paths.
 */
export async function collectFeatures(dir: string): Promise<FeatureDefinition[]> {
  if (!fs.existsSync(dir)) {
    throw new Error(`Features dir (${dir}) does not exist`);
  }

  const logger = getLogger();
  logger.debug('Searching for features...');

  const entries = await fs.promises.readdir(dir, {withFileTypes: true});
  return entries
    .filter(
      (d) =>
        d.isDirectory() && fs.existsSync(path.resolve(dir, d.name, 'feature.js')),
    )
    .map((d) => {
      const featureModule = _require(path.resolve(dir, d.name, 'feature.js'));
      return {
        path: path.resolve(dir, d.name),
        ...featureModule,
      };
    });
}

/**
 * Build the FEATURE_HELPERS object that gets passed to feature lifecycle callbacks.
 */
function buildFeatureHelpers(): FeatureHelpers {
  return {
    deployFeature,
    removeFeature,
    updateFeatureState,
    collectFeatures,
  };
}

/**
 * Deploy a feature to an instance.
 *
 * This runs the feature's migrations, syncs cartridges, calls lifecycle hooks,
 * and updates the feature state custom object.
 */
export async function deployFeature(
  instance: B2CInstance,
  clientId: string,
  featureName: string,
  {featuresDir, vars = {}, saveSecrets = true, shortCode}: Partial<DeployFeatureOptions> = {},
): Promise<void> {
  const logger = getLogger();

  if (!featuresDir) {
    throw new Error('featuresDir is required');
  }

  const projectFeatures = await collectFeatures(featuresDir);
  const feature = projectFeatures.find((f) => f.featureName === featureName);

  if (!feature) {
    throw new Error(`Cannot find feature ${featureName} in project`);
  }

  const helpers = buildHelpers(instance, {featuresDir});
  const env = new LegacyEnvironment(instance, {shortCode});
  const scriptArgs: MigrationScriptArguments = {
    instance,
    logger,
    helpers,
    vars,
    env,
  };

  // Call beforeDeploy
  if (typeof feature.beforeDeploy === 'function') {
    await feature.beforeDeploy(scriptArgs);
  }

  // Get instance feature state and bootstrap if needed
  let instanceState = await getInstanceFeatureState(instance);

  if (isFeatureBootstrapRequired(clientId, instanceState)) {
    logger.warn('Feature metadata bootstrap/upgrade required...');
    await bootstrapFeatures(instance, clientId);
    instanceState = await getInstanceFeatureState(instance);
  }

  if (!instanceState) {
    throw new Error('Failed to read feature state');
  }

  const instanceFeatureState = instanceState.features.find(
    (f) => f.featureName === featureName,
  );

  if (!instanceFeatureState) {
    logger.info(`Installing ${featureName}...`);
  } else {
    logger.info(`Updating ${featureName}...`);
  }

  // 1. Merge vars: defaults < instance state < incoming
  let featureVars = {
    ...feature.defaultVars,
    ...(instanceFeatureState ? instanceFeatureState.vars : {}),
    ...vars,
  };

  // 2. Handle questions
  const featureContext: FeatureContext = {
    featureHelpers: buildFeatureHelpers(),
    featuresDir,
    saveSecrets,
    instanceState,
  };

  let questions: unknown[] | undefined;
  if (typeof feature.questions === 'function') {
    questions = await feature.questions(
      {...scriptArgs, vars: featureVars},
      featureContext,
    );
    // Instance state may have been modified by an advanced feature init
    instanceState = (await getInstanceFeatureState(instance)) ?? instanceState;
  } else {
    questions = feature.questions;
  }

  if (questions && questions.length > 0) {
    // Dynamic import of @inquirer/prompts for interactive question asking
    // Questions follow the inquirer format with name/type/message properties
    try {
      const inquirer = await import('inquirer');
      const answers = await inquirer.default.prompt(
        questions as Parameters<typeof inquirer.default.prompt>[0],
        featureVars,
      );
      featureVars = {...featureVars, ...answers};
    } catch {
      logger.warn(
        'inquirer not available; skipping interactive questions. Pass all vars via --vars flags.',
      );
    }
  }

  // 3. Apply feature migrations
  const featureMigrationDir = path.resolve(feature.path, 'migrations');
  if (fs.existsSync(featureMigrationDir)) {
    logger.info('Applying feature migrations...');
    await migrateInstance(instance, clientId, featureMigrationDir, {
      exclude: feature.excludeMigrations ?? [],
      vars: featureVars,
      shortCode,
    });
  }

  // 4. Deploy feature cartridges
  const cartridgeMappings = findCartridges(feature.path);
  if (cartridgeMappings.length) {
    const excludeCartridges = feature.excludeCartridges ?? [];
    const filtered = cartridgeMappings
      .map((c) => ({
        name: c.dest,
        dest: c.dest,
        src: path.resolve(feature.path, c.src),
      }))
      .filter((c) => !excludeCartridges.includes(c.dest));

    if (filtered.length) {
      // Get active code version if not set
      const activeVersion = await getActiveCodeVersion(instance);
      if (!activeVersion) {
        throw new Error('Unable to determine active code version');
      }

      logger.info('Syncing feature cartridges...');
      logger.debug(`Cartridges: ${filtered.map((c) => c.dest).join(',')}`);
      await uploadCartridges(instance, filtered);
    }
  }

  // 5. Call finish lifecycle hook
  if (typeof feature.finish === 'function') {
    await feature.finish(
      {...scriptArgs, vars: featureVars},
      {
        featureHelpers: buildFeatureHelpers(),
        featuresDir,
        saveSecrets,
        instanceState,
      },
    );
  }

  // 6. Update feature state on instance
  logger.info('Updating feature state on instance...');
  await updateFeatureState(instance, featureName, featureVars, feature.secretVars, saveSecrets);

  logger.info(`Feature "${featureName}" deployed to ${instance.config.hostname}`);
}

/**
 * Remove a feature from an instance.
 *
 * Calls the feature's remove lifecycle hook and deletes the custom object.
 */
export async function removeFeature(
  instance: B2CInstance,
  featureName: string,
  {featuresDir, vars = {}}: RemoveFeatureOptions,
): Promise<void> {
  const logger = getLogger();

  const features = await collectFeatures(featuresDir);
  const instanceState = await getInstanceFeatureState(instance);

  if (instanceState === null) {
    logger.warn('No features installed on this instance; skipping feature updates...');
    return;
  }

  const feature = features.find((f) => f.featureName === featureName);

  if (!feature) {
    throw new Error(`Cannot find feature "${featureName}"`);
  }

  const featureState = instanceState.features.find((f) => f.featureName === featureName);

  if (!featureState) {
    throw new Error(`"${featureName}" not deployed to instance ${instance.config.hostname}`);
  }

  if (typeof feature.remove === 'function') {
    logger.info('Calling feature removal method...');

    const helpers = buildHelpers(instance, {featuresDir});
    const featureVars = {...feature.defaultVars, ...featureState.vars, ...vars};
    const env = new LegacyEnvironment(instance);

    await feature.remove(
      {instance, logger, helpers, vars: featureVars, env},
      {
        featureHelpers: buildFeatureHelpers(),
        featuresDir,
        saveSecrets: true,
        instanceState,
      },
    );
  }

  logger.info('Deleting Feature...');
  await instance.ocapi.DELETE('/custom_objects/{object_type}/{key}', {
    params: {path: {object_type: 'B2CToolsFeature', key: featureName}},
  });
}
