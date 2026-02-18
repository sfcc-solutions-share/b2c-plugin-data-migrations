import type {B2CInstance} from '@salesforce/b2c-tooling-sdk/instance';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import type {ToolkitInstanceState, InstanceFeatureState, FeatureState} from './types.js';

export const B2C_TOOLKIT_DATA_VERSION = 7;
export const B2C_TOOLS_FEATURES_VERSION = 3;

// ---------------------------------------------------------------------------
// Migration State
// ---------------------------------------------------------------------------

/**
 * Read the toolkit instance state from global preferences.
 * Returns null if preferences are not accessible (403) or not found (404).
 */
export async function getInstanceState(instance: B2CInstance): Promise<ToolkitInstanceState | null> {
  const logger = getLogger();

  const {data, error, response} = await instance.ocapi.GET(
    '/global_preferences/preference_groups/{group_id}/{instance_type}',
    {params: {path: {group_id: 'b2cToolkit', instance_type: 'development'}}},
  );

  if (error || !data) {
    if (response?.status === 403) {
      logger.warn('No access to global_preferences; will attempt to update during bootstrap');
      return null;
    } else if (response?.status === 404) {
      logger.debug('No global_preferences found; update required');
      return null;
    }
    throw new Error(error?.fault?.message ?? 'Failed to read instance state');
  }

  const raw = data as Record<string, unknown>;

  let clients: Record<string, {version: number}> = {};
  try {
    clients = JSON.parse(raw.c_b2cToolsBootstrappedClientIDs as string);
  } catch {
    /* ignore; will recreate as json */
  }

  let vars: Record<string, unknown> = {};
  try {
    vars = JSON.parse(raw.c_b2cToolsVars as string);
  } catch {
    /* ignore; will recreate as json */
  }

  return {
    version: (raw.c_b2cToolkitDataVersion as number) ?? null,
    migrations: raw.c_b2cToolkitMigrations
      ? (raw.c_b2cToolkitMigrations as string).split(',')
      : [],
    clients,
    vars,
  };
}

/**
 * Update the migrations list on the instance.
 */
export async function updateInstanceMigrations(
  instance: B2CInstance,
  migrations: string[],
): Promise<void> {
  const {error, response} = await instance.ocapi.PATCH(
    '/global_preferences/preference_groups/{group_id}/{instance_type}',
    {
      params: {path: {group_id: 'b2cToolkit', instance_type: 'development'}},
      body: {c_b2cToolkitMigrations: migrations.join(',')} as unknown as Record<string, never>,
    },
  );

  if (error) {
    if (response?.status === 403) {
      throw new Error(
        'Permissions error; Ensure you have global_preferences configured for your client ID (run with --force-bootstrap to force a bootstrap upgrade)',
      );
    } else if (response?.status === 404) {
      throw new Error('Unable to set migrations');
    }
    throw new Error(error.fault?.message ?? 'Failed to update migrations');
  }
}

// ---------------------------------------------------------------------------
// Feature State
// ---------------------------------------------------------------------------

function featureStateFromCustomObject(obj: Record<string, unknown>): FeatureState {
  let vars: Record<string, unknown> = {};
  if (obj.c_vars && (obj.c_vars as string).length > 0) {
    vars = {...JSON.parse(obj.c_vars as string)};
  }
  if (obj.c_secretVars && (obj.c_secretVars as string).length > 0) {
    vars = {...vars, ...JSON.parse(obj.c_secretVars as string)};
  }

  return {
    featureName: obj.key_value_string as string,
    lastModified: new Date(obj.last_modified as string),
    creationDate: new Date(obj.creation_date as string),
    vars,
  };
}

/**
 * Read the instance feature state: global preferences + B2CToolsFeature custom objects.
 * Returns null if not accessible (403/404).
 */
export async function getInstanceFeatureState(
  instance: B2CInstance,
): Promise<InstanceFeatureState | null> {
  const logger = getLogger();

  // 1. Read global preferences
  const {data: prefsData, error: prefsError, response: prefsResp} = await instance.ocapi.GET(
    '/global_preferences/preference_groups/{group_id}/{instance_type}',
    {params: {path: {group_id: 'b2cToolkit', instance_type: 'development'}}},
  );

  if (prefsError || !prefsData) {
    if (prefsResp?.status === 403 || prefsResp?.status === 404) {
      logger.warn('No access to features; Bootstrap required');
      return null;
    }
    throw new Error(prefsError?.fault?.message ?? 'Failed to read feature state');
  }

  const raw = prefsData as Record<string, unknown>;

  let bootstrappedClientIDs: Record<string, {version: number}> = {};
  try {
    bootstrappedClientIDs = JSON.parse(raw.c_b2cToolsFeaturesBootstrappedClientIDs as string);
  } catch {
    /* ignore */
  }

  const state: InstanceFeatureState = {
    b2cToolsFeaturesVersion: (raw.c_b2cToolsFeaturesVersion as number) ?? null,
    b2cToolsFeaturesBootstrappedClientIDs: bootstrappedClientIDs,
    features: [],
  };

  // 2. Search custom objects
  const {data: searchData, error: searchError, response: searchResp} = await instance.ocapi.POST(
    '/custom_objects_search/{object_type}',
    {
      params: {path: {object_type: 'B2CToolsFeature'}},
      body: {query: {match_all_query: {}}, select: '(**)'},
    },
  );

  if (searchError) {
    if (searchResp?.status === 403 || searchResp?.status === 404) {
      logger.warn('No access to features; Bootstrap required');
      return null;
    }
    throw new Error(searchError.fault?.message ?? 'Failed to search features');
  }

  const searchResult = searchData as Record<string, unknown>;
  if ((searchResult.count as number) > 0) {
    const hits = searchResult.hits as Record<string, unknown>[];
    state.features = hits.map((hit) => featureStateFromCustomObject(hit));
  }

  return state;
}

/**
 * Update or create a feature state custom object on the instance.
 */
export async function updateFeatureState(
  instance: B2CInstance,
  featureName: string,
  vars: Record<string, unknown>,
  secretVars: string[] | undefined,
  saveSecrets: boolean,
): Promise<void> {
  const targetVars = {...vars};
  const targetSecretVars: Record<string, unknown> = {};

  if (secretVars) {
    for (const key of secretVars) {
      if (saveSecrets) {
        targetSecretVars[key] = targetVars[key];
        if (targetVars[key] !== undefined) {
          targetVars[key] = '*****';
        }
      } else if (targetVars[key] !== undefined) {
        delete targetVars[key];
      }
    }
  }

  // Check if the custom object already exists
  const {error: getError, response: getResp} = await instance.ocapi.GET(
    '/custom_objects/{object_type}/{key}',
    {params: {path: {object_type: 'B2CToolsFeature', key: featureName}}},
  );

  const exists = !(getError && getResp?.status === 404);

  const body = {
    c_vars: JSON.stringify(targetVars, null, 2),
    c_secretVars: JSON.stringify(targetSecretVars, null, 2),
  } as unknown as Record<string, never>;

  if (exists) {
    await instance.ocapi.PATCH('/custom_objects/{object_type}/{key}', {
      params: {path: {object_type: 'B2CToolsFeature', key: featureName}},
      body,
    });
  } else {
    await instance.ocapi.PUT('/custom_objects/{object_type}/{key}', {
      params: {path: {object_type: 'B2CToolsFeature', key: featureName}},
      body,
    });
  }
}
