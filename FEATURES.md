# Features

Features are self-contained packages for deploying optional functionality to B2C Commerce instances. A feature bundles cartridges, its own set of [migrations](./README.md#writing-migrations), and a definition file that describes the configuration needed to deploy (or remove) the functionality.

Deploying a complete piece of functionality to a B2C instance often requires multiple coordinated steps: uploading cartridges, importing metadata, configuring services, and setting site preferences. Features automate this by packaging everything into a single deployable unit with interactive configuration and state tracking.

When a feature is deployed, its configuration (vars) is stored in a `B2CToolsFeature` custom object on the instance. This allows features to be updated, inspected, and removed cleanly.

## Getting Started

```bash
# List available features in the project
b2c migrations feature list

# Deploy a feature interactively
b2c migrations feature deploy -s my-sandbox.demandware.net

# Deploy a specific feature
b2c migrations feature deploy "My Feature" -s my-sandbox.demandware.net

# Check what's deployed
b2c migrations feature current -s my-sandbox.demandware.net

# Remove a feature
b2c migrations feature remove "My Feature" -s my-sandbox.demandware.net
```

## Feature Directory Structure

Features are stored in a features directory (default: `./features`). Each subdirectory containing a `feature.js` file is treated as a feature.

```
features/
  my-feature/
    feature.js                             # Feature definition (required)
    migrations/                            # Optional: feature-specific migrations
      setup.js                             # Optional: lifecycle hooks for feature migrations
      20240101T000000_initial-setup/
        meta/
          system-objecttype-extensions.xml
      20240115T120000_configure-service.js
    cartridges/                            # Optional: cartridges to deploy
      plugin_myfeature/
        cartridge/
          ...
```

The `feature.js` file is the only required file. The `migrations/` and `cartridges/` directories are optional.

## Feature Definition (feature.js)

The `feature.js` file exports an object describing the feature:

```js
module.exports = {
    // Required: unique name/identifier for this feature
    featureName: 'My Feature',

    // Optional: other features that should be deployed first (informational)
    requires: [],

    // Optional: default variable values
    defaultVars: {
        enableLogging: true,
    },

    // Optional: variable keys to treat as secrets (stored in password field)
    secretVars: ['apiSecret'],

    // Optional: called before deployment starts
    beforeDeploy: async function({env, logger, helpers, vars}) {
        // Pre-flight validation or setup
        // Note: vars will not contain feature-specific values yet
    },

    // Optional: interactive questions (inquirer format)
    // Can be a static array or an async function for dynamic questions
    questions: [
        {
            name: 'siteId',
            message: 'Which site?',
            type: 'list',
            choices: ['RefArch', 'SiteGenesis'],
        },
        {
            name: 'apiKey',
            message: 'API Key?',
        },
        {
            name: 'apiSecret',
            message: 'API Secret?',
        },
    ],

    // Optional: exclude specific migrations by regexp
    excludeMigrations: ['^_.*'],

    // Optional: exclude specific cartridges from deployment
    excludeCartridges: ['plugin_debug'],

    // Optional: called after migrations and cartridge deployment
    finish: async function({env, logger, helpers, vars}, ctx) {
        // Post-deploy setup: add cartridges to site path, reload code, etc.
        // vars contains the fully merged values including interactive answers
        await env.ocapi.post(`sites/${vars.siteId}/cartridges`, {
            name: 'plugin_myfeature',
            position: 'last',
        });

        // Remove vars that shouldn't be persisted
        delete vars.tempValue;
    },

    // Optional: called when removing the feature
    remove: async function({env, logger, helpers, vars}, ctx) {
        // Cleanup: remove cartridges from site path, undo configuration, etc.
        await env.ocapi.delete(`sites/${vars.siteId}/cartridges/plugin_myfeature`);
    },
};
```

### Property Reference

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `featureName` | `string` | Yes | Unique identifier for the feature. Used as the custom object key. |
| `requires` | `string[]` | No | Other feature names that should be deployed first. |
| `defaultVars` | `object` | No | Default variable values, merged first in the precedence chain. |
| `secretVars` | `string[]` | No | Var keys to mask when storing on the instance. |
| `questions` | `array \| function` | No | Inquirer-format questions or async function returning questions. |
| `excludeMigrations` | `string[]` | No | Regexp patterns to exclude feature migrations. |
| `excludeCartridges` | `string[]` | No | Cartridge names to exclude from deployment. |
| `beforeDeploy` | `async function(args)` | No | Called before any deployment steps. |
| `finish` | `async function(args, ctx)` | No | Called after migrations and cartridges, before state is saved. |
| `remove` | `async function(args, ctx)` | No | Called when the feature is being removed. |

## Variable Precedence and Questions

Feature vars are merged in this order (later values win):

1. `defaultVars` from the feature definition
2. Previously saved vars from the instance (on update/redeploy)
3. Vars passed via CLI (`--vars`, `--vars-file`, `--vars-json`)
4. Interactive answers from `questions` prompts

### Static Questions

Provide an array of [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) question objects:

```js
questions: [
    { name: 'siteId', message: 'Site ID?', type: 'input' },
    { name: 'enableFeature', message: 'Enable?', type: 'confirm', default: true },
],
```

The current merged vars are provided as defaults, so previously entered values are pre-filled on redeployment.

### Dynamic Questions

Provide an async function to generate questions based on instance state:

```js
questions: async function({env, logger, helpers, vars}, ctx) {
    // Query the instance for available sites
    const sites = await env.ocapi.get('sites?select=(**)');
    const siteIds = sites.data.data.map(s => s.id);

    return [
        {
            name: 'siteId',
            message: 'Which site?',
            type: 'list',
            choices: siteIds,
        },
    ];
},
```

### Non-Interactive Deployment

If `inquirer` is not installed or unavailable, questions are skipped. Provide all required values via `--vars` flags for CI/CD scenarios:

```bash
b2c migrations feature deploy "My Feature" \
    --vars siteId=RefArch \
    --vars apiKey=abc123 \
    --vars apiSecret=secret456
```

## Secret Variables

Variables listed in `secretVars` receive special handling during state persistence:

- Secret values are stored in a `password`-type custom object attribute (`c_secretVars`), which is not readable through normal Business Manager interfaces.
- The regular `c_vars` attribute stores `"*****"` as a placeholder for each secret key.
- When feature state is read back, values from both fields are merged, making secrets available during redeployment and updates.

Use `--no-save-secrets` on deploy/update to prevent secret values from being persisted:

```bash
b2c migrations feature deploy "My Feature" --no-save-secrets
```

## Feature State Management

Feature state is stored in a `B2CToolsFeature` custom object type on the instance (organization scope, no staging).

Each deployed feature gets one custom object record keyed by `featureName` with these attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `c_vars` | Text | JSON string with feature configuration (secrets masked) |
| `c_secretVars` | Password | JSON string with secret values |
| `creationDate` | DateTime | When the feature was first deployed |
| `lastModified` | DateTime | When the feature was last updated |

### Bootstrap

The first feature deployment automatically bootstraps the custom object type and supporting preferences on the instance. You can also bootstrap manually:

```bash
b2c migrations feature bootstrap -s my-sandbox.demandware.net
```

Bootstrap metadata includes:

- `B2CToolsFeature` custom object type definition
- `c_b2cToolsFeaturesVersion` preference attribute
- `c_b2cToolsFeaturesBootstrappedClientIDs` preference attribute

Bootstrap is tracked per client ID, supporting multiple teams on the same instance.

## Feature Migrations

Place migrations in the `migrations/` subdirectory of the feature. These work identically to [top-level migrations](./README.md#writing-migrations):

- Same naming convention (`YYYYMMDDTHHMMSS_description`)
- Support both directory (impex) and script (.js) formats
- Optional `setup.js` with lifecycle hooks
- Migration state is tracked in the same `OrganizationPreferences` as regular migrations

The key difference is that feature migrations receive the fully merged feature vars, including defaults, saved state, and interactive answers:

```js
// features/my-feature/migrations/20240101T000000_configure-service.js
module.exports = async function ({ env, logger, helpers, vars }) {
    // vars.siteId, vars.apiKey, etc. are available from the feature definition
    logger.info(`Configuring service for site: ${vars.siteId}`);
};
```

Use `excludeMigrations` in the feature definition to skip specific migrations by regexp pattern.

## Feature Cartridges

Place cartridge source code in the `cartridges/` subdirectory of the feature. Cartridges are discovered automatically and uploaded to the instance's active code version during deployment.

Use `excludeCartridges` in the feature definition to skip specific cartridges by name.

If the active code version is not configured, it is auto-detected from the instance.

## Deployment Flow

When `migrations feature deploy` runs, the following steps occur in order:

1. **beforeDeploy** -- call the `beforeDeploy` lifecycle hook (if defined)
2. **Bootstrap** -- check if feature metadata needs bootstrapping; import if needed
3. **Merge vars** -- merge in order: `defaultVars` < saved instance state < CLI vars
4. **Questions** -- run interactive questions (if defined); merge answers into vars
5. **Migrations** -- run feature migrations from the `migrations/` directory (if present)
6. **Cartridges** -- discover and upload cartridges from the `cartridges/` directory (if present)
7. **finish** -- call the `finish` lifecycle hook (if defined)
8. **Save state** -- persist feature vars and secret vars to the `B2CToolsFeature` custom object

## Lifecycle Hook Arguments

All lifecycle hooks receive `MigrationScriptArguments` as the first argument (`{ instance, env, logger, helpers, vars }`). See the [README](./README.md#migration-script-arguments) for details.

The `finish` and `remove` hooks receive a second `FeatureContext` argument:

| Property | Description |
|----------|-------------|
| `featureHelpers` | Object with `deployFeature`, `removeFeature`, `updateFeatureState`, `collectFeatures` for programmatic feature management. |
| `featuresDir` | Resolved path to the features directory. |
| `saveSecrets` | Boolean indicating whether secrets will be persisted. |
| `instanceState` | Current `InstanceFeatureState` with version, bootstrapped client IDs, and features array. |

## Commands Reference

### `migrations feature deploy [FEATURE]`

Deploy or update a feature. If no feature name is given and `inquirer` is available, prompts for selection.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--features-dir` | `./features` | Path to features directory |
| `--save-secrets` / `--no-save-secrets` | `true` | Whether to persist secret values |
| `--vars` | | Variables as `key=value` pairs (multiple) |
| `--vars-file` | | Path to JSON vars file |
| `--vars-json` | | Inline JSON vars string |

```bash
b2c migrations feature deploy "My Feature" -s my-sandbox.demandware.net
b2c migrations feature deploy --vars siteId=RefArch --vars apiKey=abc123
b2c migrations feature deploy --features-dir ./custom-features
```

### `migrations feature remove [FEATURE]`

Remove a feature from an instance. Calls the feature's `remove` hook (if defined) and deletes the custom object. If no name is given, prompts for selection from installed features.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--features-dir` | `./features` | Path to features directory |
| `--vars` | | Variables as `key=value` pairs (multiple) |
| `--vars-file` | | Path to JSON vars file |
| `--vars-json` | | Inline JSON vars string |

```bash
b2c migrations feature remove "My Feature" -s my-sandbox.demandware.net
```

### `migrations feature update`

Redeploy all features that are both locally available and currently installed on the instance. Calls `beforeDeploy` for all features first, then deploys each one.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--features-dir` | `./features` | Path to features directory |
| `--save-secrets` / `--no-save-secrets` | `true` | Whether to persist secret values |
| `--vars` | | Variables as `key=value` pairs (multiple) |
| `--vars-file` | | Path to JSON vars file |
| `--vars-json` | | Inline JSON vars string |

```bash
b2c migrations feature update -s my-sandbox.demandware.net
```

### `migrations feature list`

List features available in the local project directory. Does not require an instance connection.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--features-dir` | `./features` | Path to features directory |
| `--json` | | Output as JSON |

```bash
b2c migrations feature list
b2c migrations feature list --json
```

### `migrations feature current`

Show features currently deployed on an instance.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--features-dir` | `./features` | Path to features directory |
| `--available` | `false` | Only show features that are also available locally |
| `--json` | | Output as JSON |

```bash
b2c migrations feature current -s my-sandbox.demandware.net
b2c migrations feature current --available --json
```

### `migrations feature get [FEATURE]`

Get detailed state of a deployed feature. If no feature name is given, returns state for all features.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | | Output as JSON |

```bash
b2c migrations feature get "My Feature" -s my-sandbox.demandware.net
b2c migrations feature get --json
```

### `migrations feature bootstrap`

Manually bootstrap feature metadata on an instance. Usually not needed as `deploy` auto-bootstraps.

```bash
b2c migrations feature bootstrap -s my-sandbox.demandware.net
```
