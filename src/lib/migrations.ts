import * as fs from 'node:fs';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {siteArchiveImport} from '@salesforce/b2c-tooling-sdk/operations/jobs';
import {buildHelpers} from './helpers.js';
import {LegacyEnvironment} from './environment.js';
import {
  B2C_TOOLKIT_DATA_VERSION,
  getInstanceState,
  updateInstanceMigrations,
} from './state.js';
import {isMigrationBootstrapRequired, bootstrapMigrations} from './bootstrap.js';
import type {
  MigrationLifecycleFunctions,
  MigrationScriptArguments,
  MigrateInstanceOptions,
} from './types.js';

const _require = createRequire(import.meta.url);

/**
 * Find all migration directories and scripts in the given dir.
 * Excludes entries matching the exclude patterns and the special `setup.js` file.
 */
export async function collectMigrations(dir: string, exclude: string[] = []): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, {withFileTypes: true});
  return entries
    .filter((d) => {
      // valid migrations are directories (impex) or javascript files
      return (
        (d.isDirectory() || path.extname(d.name) === '.js') &&
        exclude.every((re) => !d.name.match(re))
      );
    })
    .filter((entry) => entry.name !== 'setup.js')
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en', {numeric: false}));
}

/**
 * Run migrations against an instance.
 *
 * This is the core migration engine, ported from b2c-tools' `migrateInstance()`.
 * It collects migrations from disk, compares against instance state, and applies
 * any pending migrations in order.
 */
export async function migrateInstance(
  instance: B2CInstance,
  clientId: string,
  dir: string,
  {
    exclude = [],
    apply = true,
    dryRun = false,
    forceBootstrap = false,
    allowBootstrap = true,
    vars = {},
    showNotes = true,
    shortCode,
  }: MigrateInstanceOptions = {},
): Promise<void> {
  const logger = getLogger();

  const helpers = buildHelpers(instance, {migrationsDir: dir, vars});
  const env = new LegacyEnvironment(instance, {shortCode});
  const migrationScriptArguments: MigrationScriptArguments = {
    instance,
    logger,
    helpers,
    vars,
    env,
  };

  // Collect persisted log messages
  const logMessages: string[] = [];
  const logCapture = (level: string, message: string) => {
    logMessages.push(`${new Date().toISOString()} ${level}: ${message}`);
  };

  // Load setup.js lifecycle module if present
  let lifeCycleModule: MigrationLifecycleFunctions = {};
  const setupPath = path.join(dir, 'setup.js');
  if (fs.existsSync(setupPath)) {
    lifeCycleModule = _require(path.resolve(setupPath));
  }

  // Call init lifecycle hook
  if (typeof lifeCycleModule.init === 'function') {
    logger.debug('Calling lifecycle function init');
    await lifeCycleModule.init(migrationScriptArguments);
  }

  // Collect project migrations
  const projectMigrations = await collectMigrations(dir, exclude);
  logger.debug(`Project Migrations ${projectMigrations.join(',')}`);
  logCapture('debug', `Project Migrations ${projectMigrations.join(',')}`);

  // Get instance state
  logger.info('Getting instance migration state...');
  logCapture('info', 'Getting instance migration state...');
  let instanceState = await getInstanceState(instance);

  // Check bootstrap
  let bootstrapRequired = isMigrationBootstrapRequired(clientId, instanceState);

  if (typeof lifeCycleModule.shouldBootstrap === 'function' && !bootstrapRequired) {
    try {
      logger.debug('Calling lifecycle function shouldBootstrap');
      const result = await lifeCycleModule.shouldBootstrap(migrationScriptArguments, instanceState!);
      if (result === true) {
        logger.debug('Bootstrapping as result of shouldBootstrap lifecycle method was true');
        bootstrapRequired = true;
      }
    } catch (e) {
      logger.debug(`Lifecycle function shouldBootstrap threw exception (will bootstrap): ${e}`);
      bootstrapRequired = true;
    }
  }

  if (bootstrapRequired && !allowBootstrap) {
    throw new Error('instance bootstrap or upgrade required but allow-bootstrap set to false');
  } else if (forceBootstrap || bootstrapRequired) {
    logger.warn('Toolkit metadata bootstrap/upgrade required...');
    logCapture('warn', 'Toolkit metadata bootstrap/upgrade required...');
    await bootstrapMigrations(instance, clientId, lifeCycleModule, migrationScriptArguments);
    instanceState = await getInstanceState(instance);
  } else if (instanceState && instanceState.version && instanceState.version > B2C_TOOLKIT_DATA_VERSION) {
    throw new Error(
      'Instance is using a b2c-tools version greater than currently installed; upgrade required',
    );
  }

  if (!instanceState) {
    throw new Error('Failed to read instance state');
  }

  logger.debug(JSON.stringify(instanceState, null, 2));

  let instanceMigrations = instanceState.migrations.slice();
  const migrationsToApply = projectMigrations.filter((m) => !instanceMigrations.includes(m));

  // Call beforeAll lifecycle hook
  if (typeof lifeCycleModule.beforeAll === 'function') {
    logger.debug('Calling lifecycle function beforeAll');
    await lifeCycleModule.beforeAll(migrationScriptArguments, migrationsToApply, apply, dryRun);
  }

  const migrationsRan: string[] = [];

  if (migrationsToApply.length === 0) {
    const last = instanceMigrations.length > 0 ? instanceMigrations[instanceMigrations.length - 1] : 'none';
    logger.info(`No migrations required. Instance is up to date (last: ${last})`);
    logCapture('info', `No migrations required. Instance is up to date (last: ${last})`);
  } else {
    logger.info(
      `${migrationsToApply.length} Migrations Required:\n      ${migrationsToApply.join('\n      ')}`,
    );
    logCapture(
      'info',
      `${migrationsToApply.length} Migrations Required: ${migrationsToApply.join(', ')}`,
    );

    if (dryRun) {
      logger.warn('Dry run requested. Will not run migrations.');
      logCapture('warn', 'Dry run requested. Will not run migrations.');
    } else {
      logger.info(`Running migrations on ${instance.config.hostname}...`);
      logCapture('info', `Running migrations on ${instance.config.hostname}...`);
    }

    for (const migration of migrationsToApply) {
      const now = Date.now();

      const target = path.join(dir, migration);
      const fileStat = await fs.promises.stat(target);

      // Output notes
      if (fileStat.isDirectory()) {
        const noteFile = path.join(target, 'notes.txt');
        if (fs.existsSync(noteFile) && showNotes) {
          const notes = fs.readFileSync(noteFile).toString();
          logger.info(`[${migration}] Notes:\n${notes}\n`);
          logCapture('info', `[${migration}] Notes:\n${notes}`);
        }
      } else {
        const migrationScript = _require(path.resolve(target));
        if (typeof migrationScript?.notes === 'string' && showNotes) {
          logger.info(`[${migration}] Notes:\n${migrationScript.notes}\n`);
          logCapture('info', `[${migration}] Notes:\n${migrationScript.notes}`);
        }
      }

      if (dryRun) {
        continue;
      }

      // Call beforeEach lifecycle hook
      let runMigration = true;
      if (typeof lifeCycleModule.beforeEach === 'function') {
        logger.debug('Calling lifecycle function beforeEach');
        runMigration = await lifeCycleModule.beforeEach(
          migrationScriptArguments,
          migration,
          apply,
        );
      }

      if (runMigration !== false) {
        try {
          if (fileStat.isDirectory()) {
            await siteArchiveImport(instance, path.join(dir, migration));
          } else {
            const migrationScript = _require(path.resolve(target));
            if (typeof migrationScript !== 'function') {
              throw new Error(`${target} is not a valid migration; should export a function`);
            }
            await migrationScript.call(null, migrationScriptArguments);
          }
        } catch (e) {
          logger.error(`[${migration}] Unable to execute migration`);
          logCapture('error', `[${migration}] Unable to execute migration: ${e}`);
          if (typeof lifeCycleModule.onFailure === 'function') {
            logger.warn('Calling lifecycle function onFailure');
            await lifeCycleModule.onFailure(migrationScriptArguments, migration, e as Error);
            logger.warn(`[${migration}] onFailure handled exception, ignoring error...`);
            logCapture('warn', `[${migration}] onFailure handled exception, ignoring error...`);
          } else {
            throw e;
          }
        }
      } else {
        logger.warn(`[${migration}] skipping execution due to lifecycle function...`);
        logCapture('warn', `[${migration}] skipping execution due to lifecycle function...`);
      }

      instanceMigrations.push(migration);

      if (apply) {
        // Re-read instance state — it may have been updated by a script
        instanceState = await getInstanceState(instance);
        if (instanceState) {
          const currentInstanceMigrations = instanceState.migrations.slice();
          logger.debug(`current instance migrations: ${instanceMigrations}`);
          // Merge any migrations that may have been added since we last checked
          instanceMigrations = Array.from(
            new Set(currentInstanceMigrations.concat(instanceMigrations)),
          );
        }
        logger.debug(`Applying new migrations: ${instanceMigrations}`);
        await updateInstanceMigrations(instance, instanceMigrations);
      }

      // Call afterEach lifecycle hook
      if (typeof lifeCycleModule.afterEach === 'function') {
        logger.debug('Calling lifecycle function afterEach');
        await lifeCycleModule.afterEach(migrationScriptArguments, migration, apply);
      }

      const timeToRun = Date.now() - now;
      migrationsRan.push(migration);
      logger.info(`[${migration}] Migrated in (${timeToRun / 1000}s)`);
      logCapture('info', `[${migration}] Migrated in (${timeToRun / 1000}s)`);
    }
  }

  // Call afterAll lifecycle hook
  if (!dryRun && typeof lifeCycleModule.afterAll === 'function') {
    logger.debug('Calling lifecycle function afterAll');
    await lifeCycleModule.afterAll(migrationScriptArguments, migrationsRan, apply);
  }

  // Write logs to instance
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '');
    await instance.webdav.put(
      `/IMPEX/log/b2c-tools/migration-${timestamp}.log`,
      Buffer.from(logMessages.join('\n')),
    );
  } catch {
    // Ignore log write failures
  }
}
