import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {siteArchiveImport} from '@salesforce/b2c-tooling-sdk/operations/jobs';
import {toolkitMetadata} from '../assets/toolkit-metadata.js';
import {featuresMetadata} from '../assets/features-metadata.js';
import {createArchiveFromTextMap} from './archive-utils.js';
import {
  B2C_TOOLKIT_DATA_VERSION,
  B2C_TOOLS_FEATURES_VERSION,
  getInstanceState,
  getInstanceFeatureState,
} from './state.js';
import type {
  ToolkitInstanceState,
  InstanceFeatureState,
  MigrationLifecycleFunctions,
  MigrationScriptArguments,
} from './types.js';

/**
 * Determines if migration bootstrap/upgrade is required for the given client.
 */
export function isMigrationBootstrapRequired(
  clientId: string,
  instanceState: ToolkitInstanceState | null,
): boolean {
  return (
    !instanceState ||
    !instanceState.version ||
    instanceState.version < B2C_TOOLKIT_DATA_VERSION ||
    !instanceState.clients ||
    !(clientId in instanceState.clients) ||
    (instanceState.clients?.[clientId]?.version ?? 0) < B2C_TOOLKIT_DATA_VERSION
  );
}

/**
 * Determines if feature bootstrap/upgrade is required for the given client.
 */
export function isFeatureBootstrapRequired(
  clientId: string,
  instanceState: InstanceFeatureState | null,
): boolean {
  return (
    !instanceState ||
    !instanceState.b2cToolsFeaturesVersion ||
    instanceState.b2cToolsFeaturesVersion < B2C_TOOLS_FEATURES_VERSION ||
    !instanceState.b2cToolsFeaturesBootstrappedClientIDs ||
    !(clientId in instanceState.b2cToolsFeaturesBootstrappedClientIDs) ||
    (instanceState.b2cToolsFeaturesBootstrappedClientIDs?.[clientId]?.version ?? 0) <
      B2C_TOOLS_FEATURES_VERSION
  );
}

/**
 * Bootstrap or upgrade the migration toolkit metadata on the instance.
 *
 * Imports metadata XML, records the client ID, and calls the onBootstrap lifecycle hook.
 *
 * NOTE: ensureDataAPIPermissions is NOT implemented; the client ID must already
 * have the necessary OCAPI Data API permissions configured.
 */
export async function bootstrapMigrations(
  instance: B2CInstance,
  clientId: string,
  lifecycleModule: MigrationLifecycleFunctions,
  scriptArgs: MigrationScriptArguments,
): Promise<void> {
  const logger = getLogger();

  const prefs = `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <custom-preferences>
        <development><preference preference-id="b2cToolkitDataVersion">0</preference></development>
    </custom-preferences>
</preferences>
`;

  const archiveBuffer = await createArchiveFromTextMap(
    new Map([
      ['preferences.xml', prefs],
      ['meta/system-objecttype-extensions.xml', toolkitMetadata],
    ]),
    'b2c-tools-bootstrap',
  );

  try {
    await siteArchiveImport(instance, archiveBuffer, {archiveName: 'b2c-tools-bootstrap'});
  } catch (e: unknown) {
    const err = e as {response?: {status?: number}};
    if (err.response?.status === 403) {
      throw new Error(
        `Got status 403: At minimum your client ID (${clientId}) needs OCAPI DATAAPI access for jobs and webdav write access to /impex; see README.md`,
      );
    }
    throw e;
  }

  logger.warn(
    'ensureDataAPIPermissions is not implemented in this plugin; ensure your client ID has the necessary permissions configured',
  );

  // Read fresh state and record client ID
  const instanceState = await getInstanceState(instance);
  if (!instanceState) {
    throw new Error('Failed to read instance state after bootstrap import');
  }

  instanceState.clients[clientId] = {
    ...instanceState.clients[clientId],
    version: B2C_TOOLKIT_DATA_VERSION,
  };

  // Call onBootstrap lifecycle hook
  if (typeof lifecycleModule.onBootstrap === 'function') {
    logger.info('Calling project onBootstrap...');
    await lifecycleModule.onBootstrap(scriptArgs, instanceState);
  }

  // Record in global preferences
  logger.debug(`Recording ${clientId} in metadata`);
  await instance.ocapi.PATCH(
    '/global_preferences/preference_groups/{group_id}/{instance_type}',
    {
      params: {path: {group_id: 'b2cToolkit', instance_type: 'development'}},
      body: {
        c_b2cToolkitDataVersion: B2C_TOOLKIT_DATA_VERSION,
        c_b2cToolsBootstrappedClientIDs: JSON.stringify(instanceState.clients, null, 2),
        c_b2cToolsVars: JSON.stringify(instanceState.vars, null, 2),
      } as unknown as Record<string, never>,
    },
  );
}

/**
 * Bootstrap or upgrade the features metadata on the instance.
 *
 * Imports the features custom object type and preferences, records the client ID.
 *
 * NOTE: ensureDataAPIPermissions is NOT implemented; the client ID must already
 * have the necessary OCAPI Data API permissions configured.
 */
export async function bootstrapFeatures(
  instance: B2CInstance,
  clientId: string,
): Promise<void> {
  const logger = getLogger();

  const prefs = `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <custom-preferences>
        <development><preference preference-id="b2cToolsFeaturesVersion">0</preference></development>
    </custom-preferences>
</preferences>
`;

  logger.info(`Bootstrapping features for ${clientId}...`);

  const archiveBuffer = await createArchiveFromTextMap(
    new Map([
      ['preferences.xml', prefs],
      ['meta/features.xml', featuresMetadata],
    ]),
    'b2c-tools-features-bootstrap',
  );

  try {
    await siteArchiveImport(instance, archiveBuffer, {
      archiveName: 'b2c-tools-features-bootstrap',
    });
  } catch (e: unknown) {
    const err = e as {response?: {status?: number}};
    if (err.response?.status === 403) {
      throw new Error(
        `Got status 403: At minimum your client ID (${clientId}) needs OCAPI DATAAPI access for jobs and webdav write access to /impex; see README.md`,
      );
    }
    throw e;
  }

  logger.warn(
    'ensureDataAPIPermissions is not implemented in this plugin; ensure your client ID has the necessary permissions configured',
  );

  // Read fresh state and record client ID
  const instanceFeatureState = await getInstanceFeatureState(instance);
  if (!instanceFeatureState) {
    throw new Error('Failed to read feature state after bootstrap import');
  }

  instanceFeatureState.b2cToolsFeaturesBootstrappedClientIDs[clientId] = {
    version: B2C_TOOLS_FEATURES_VERSION,
  };

  logger.debug(`Recording ${clientId} in metadata`);
  await instance.ocapi.PATCH(
    '/global_preferences/preference_groups/{group_id}/{instance_type}',
    {
      params: {path: {group_id: 'b2cToolkit', instance_type: 'development'}},
      body: {
        c_b2cToolsFeaturesVersion: B2C_TOOLS_FEATURES_VERSION,
        c_b2cToolsFeaturesBootstrappedClientIDs: JSON.stringify(
          instanceFeatureState.b2cToolsFeaturesBootstrappedClientIDs,
          null,
          2,
        ),
      } as unknown as Record<string, never>,
    },
  );
}
