# b2c-plugin-data-migrations

An [oclif](https://oclif.io/) plugin for the [B2C CLI](https://github.com/SalesforceCommerceCloud/b2c-developer-tooling) that provides data migration and feature management commands for Salesforce B2C Commerce instances.

This plugin is a port of the migration and feature system from [b2c-tools](https://github.com/SalesforceCommerceCloud/b2c-tools), redesigned to work as a plugin for the B2C CLI using `@salesforce/b2c-tooling-sdk`.

## Installation

```bash
b2c plugins install sfcc-solutions-share/b2c-plugin-data-migrations
```

### Peer Dependencies

- `@oclif/core` ^4
- `@salesforce/b2c-tooling-sdk` >=0.8.0
- Node.js >=22.0.0

Optional: `inquirer` for interactive feature deployment prompts.

## Prerequisites

Migrations require an OAuth API client ID with OCAPI Data API access and WebDAV write access. A freshly launched On-Demand Sandbox already has the necessary permissions when using the same client ID it was launched with.

### OCAPI Data API

```json
{
    "_v": "18.1",
    "clients": [
        {
            "client_id": "...",
            "resources": [
                {
                    "methods": ["get"],
                    "read_attributes": "(**)",
                    "resource_id": "/code_versions",
                    "write_attributes": "(**)"
                },
                {
                    "methods": ["patch", "delete"],
                    "read_attributes": "(**)",
                    "resource_id": "/code_versions/*",
                    "write_attributes": "(**)"
                },
                {
                    "methods": ["post"],
                    "read_attributes": "(**)",
                    "resource_id": "/jobs/*/executions",
                    "write_attributes": "(**)"
                },
                {
                    "methods": ["get"],
                    "read_attributes": "(**)",
                    "resource_id": "/jobs/*/executions/*",
                    "write_attributes": "(**)"
                },
                {
                    "methods": ["get", "patch"],
                    "read_attributes": "(**)",
                    "resource_id": "/global_preferences/preference_groups/*",
                    "write_attributes": "(**)"
                },
                {
                    "methods": ["get", "put", "patch", "delete"],
                    "read_attributes": "(**)",
                    "resource_id": "/custom_objects/*",
                    "write_attributes": "(**)"
                }
            ]
        }
    ]
}
```

### WebDAV

*Note: WebDAV access will prefer username/password (i.e. access key) authentication if provided. The following is only required for API client ID authentication.*

```json
{
    "clients": [
        {
            "client_id": "...",
            "permissions": [
                {
                    "path": "/impex",
                    "operations": ["read_write"]
                },
                {
                    "path": "/cartridges",
                    "operations": ["read_write"]
                }
            ]
        }
    ]
}
```

## Why Migrations?

B2C Commerce development involves multiple collaborators making metadata and configuration changes across instances. Common problems include:

- Collaborators uploading code changes without the necessary supporting metadata
- No standard procedure for distributing and tracking data changes across environments
- Static site import/export (impex) archives offer no runtime configuration
- Redundant imports may overwrite manual changes or produce hard-to-track defects

Data migrations solve these problems by providing an idempotent, version-controlled system for applying changes to B2C instances. Each migration is applied exactly once, and the system tracks what has been run on each instance. Migrations can include both static impex data and dynamic scripts with full access to the OCAPI and WebDAV APIs.

## Running Migrations

```bash
# Apply pending migrations to an instance
b2c migrations run -s my-sandbox.demandware.net

# Preview what would run without applying
b2c migrations run --dry-run

# Run from a custom directory
b2c migrations run --migrations-dir ./my-migrations

# Exclude migrations by pattern
b2c migrations run --exclude "^test-" --exclude "^dev-"

# Run migrations without recording them as applied
b2c migrations run --no-apply

# Pass variables to migration scripts
b2c migrations run --vars siteId=RefArch --vars-json '{"apiKey":"abc123"}'
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--migrations-dir` | `./migrations` | Path to migrations directory |
| `--exclude`, `-x` | | Excluded migration patterns (regexp). Can be specified multiple times. |
| `--apply` / `--no-apply` | `true` | Whether to record migrations as applied on the instance |
| `--dry-run` | `false` | Show only what migrations would run |
| `--force-bootstrap` | `false` | Force a metadata bootstrap/upgrade on the instance |
| `--allow-bootstrap` / `--no-allow-bootstrap` | `true` | Allow automatic bootstrapping when required |
| `--notes` / `--no-notes` | `true` | Display migration notes |
| `--vars` | | Variables as `key=value` pairs (multiple allowed) |
| `--vars-file` | | Path to a JSON file with variables |
| `--vars-json` | | Inline JSON string with variables |

Instance connection flags (from `@salesforce/b2c-tooling-sdk`) are also available: `--server`/`-s`, `--client-id`, `--client-secret`, `--code-version`, `--short-code`, etc.

## Writing Migrations

Migrations live in a directory (default: `./migrations`). Each entry is either a **directory** (static impex) or a **JavaScript file** (script).

Migrations are sorted alphabetically and executed in order. Use a timestamp prefix to ensure correct ordering:

```
migrations/
  20240101T000000_initial-metadata/
    meta/
      system-objecttype-extensions.xml
  20240115T120000_add-custom-object.js
  20240201T090000_configure-service.js
  setup.js                              # Optional lifecycle hooks
```

A special `setup.js` file (if present) is not treated as a migration. See [Lifecycle Functions](#lifecycle-functions-setupjs).

### Directory Migrations (Static Impex)

A directory in standard B2C site import/export format. It will be zipped and imported via the `sfccm-site-archive-import` job.

Include an optional `notes.txt` file to display notes when the migration runs.

### Script Migrations (.js)

A JavaScript file that exports an async function:

```js
module.exports = async function ({ instance, env, logger, helpers, vars }) {
    // Import a custom object definition
    const data = new Map();
    data.set('meta/custom-objecttype-definitions.xml', `<?xml version="1.0" encoding="UTF-8"?>
        <metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">
            <!-- ... -->
        </metadata>
    `);
    await helpers.siteArchiveImportText(env, data);

    // Execute a job
    await helpers.executeJob(env, 'my-custom-job');

    logger.info('Migration complete');
};

// Optional: display notes when this migration runs
module.exports.notes = 'This migration adds the MyCustomObject type.';
```

## Migration Script Arguments

All migration scripts and lifecycle functions receive a `MigrationScriptArguments` object:

| Argument | Description |
|----------|-------------|
| `instance` | `B2CInstance` from `@salesforce/b2c-tooling-sdk`. The authenticated instance with direct SDK access. |
| `env` | Legacy environment adapter with axios-like HTTP clients. See [Legacy Environment](#legacy-environment). |
| `logger` | SDK logger with `.info()`, `.warn()`, `.error()`, `.debug()` methods. |
| `helpers` | Convenience helpers for common operations. See [Helpers Reference](#helpers-reference). |
| `vars` | Variables passed via `--vars`, `--vars-file`, or `--vars-json` flags. |

For new scripts, prefer using `instance` directly for SDK operations. The `env` object is provided for backward compatibility with scripts written for b2c-tools.

## Lifecycle Functions (setup.js)

If a `setup.js` file exists in the migrations directory, it can export lifecycle hooks that run at various stages of the migration process:

```js
module.exports = {
    // Called before any other operation. Use for custom initialization.
    init: async function({env, logger, helpers, vars}) {},

    // Return true to force a bootstrap regardless of current state.
    // Use this for custom setup that needs to run on version changes.
    shouldBootstrap: async function({env, logger, helpers, vars}, instanceState) {
        return false;
    },

    // Runs after bootstrap metadata is imported.
    // Use for additional setup like custom permissions.
    onBootstrap: async function({env, logger, helpers, vars}, instanceState) {},

    // Runs before all migrations. The migrations array can be mutated
    // to change what will run.
    beforeAll: async function({env, logger, helpers, vars}, migrationsToRun, willApply, dryRun) {},

    // Runs before each migration. Return false to skip (migration is
    // still recorded as applied).
    beforeEach: async function({env, logger, helpers, vars}, migration, willApply) {
        return true;
    },

    // Runs after each migration.
    afterEach: async function({env, logger, helpers, vars}, migration, willApply) {},

    // Runs after all migrations complete (skipped during dry-run).
    afterAll: async function({env, logger, helpers, vars}, migrationsRan, willApply) {},

    // Runs when a migration throws an error. Re-throw to stop execution,
    // or swallow the error to continue with the next migration.
    onFailure: async function({env, logger, helpers, vars}, migration, error) {
        throw error;
    },
};
```

## Variables (Vars)

Variables provide runtime configuration to migration scripts and lifecycle functions. They are accessible via the `vars` argument.

### Input Sources

Variables can be provided through three mechanisms, merged in this order of precedence (later wins):

1. **File** (`--vars-file vars.json`) -- load from a JSON file
2. **Inline JSON** (`--vars-json '{"key": "value"}'`) -- inline JSON string
3. **CLI pairs** (`--vars key=value`) -- individual key=value pairs (multiple allowed)

### Example

```bash
b2c migrations run \
    --vars-file ./config/base-vars.json \
    --vars-json '{"environment": "staging"}' \
    --vars siteId=RefArch \
    --vars apiKey=abc123
```

```js
// In a migration script:
module.exports = async function ({ logger, vars }) {
    logger.info(`Configuring site: ${vars.siteId}`);
    logger.info(`Environment: ${vars.environment}`);
};
```

## Bootstrapping

The migration system is self-bootstrapping. On first run (or when the metadata version changes), it automatically imports the required custom attributes to `OrganizationPreferences`:

- `c_b2cToolkitDataVersion` -- metadata format version
- `c_b2cToolkitMigrations` -- comma-separated list of applied migrations
- `c_b2cToolsBootstrappedClientIDs` -- JSON tracking which client IDs have bootstrapped
- `c_b2cToolsVars` -- JSON for instance-wide variables

Bootstrap is tracked per client ID, so multiple teams using different API clients can safely share an instance.

Use `--force-bootstrap` to re-import metadata (e.g., after a plugin version upgrade). Use `--no-allow-bootstrap` to prevent automatic bootstrapping and fail if it would be required.

## Helpers Reference

The `helpers` object provides convenience functions for common operations. For backward compatibility with b2c-tools scripts, most helpers accept an `env` first argument that is ignored (the bound `instance` is used instead).

### Jobs

| Helper | Signature | Description |
|--------|-----------|-------------|
| `executeJob` | `(env, jobId, params?)` | Execute a B2C job. Auto-retries once if the job is already running. |
| `waitForJob` | `(env, jobId, executionId)` | Wait for a job execution to complete. |
| `siteArchiveImport` | `(env, target, opts?)` | Import a site archive (file path or buffer). |
| `siteArchiveExport` | `(env, dataUnits)` | Export a site archive to the instance. |
| `siteArchiveImportText` | `(env, dataMap, opts?)` | Import from `Map<filename, textContent>`. Creates an in-memory zip. |
| `siteArchiveExportText` | `(env, dataUnits)` | Export and return as `Map<filename, textContent>`. |
| `siteArchiveImportJSON` | `(env, dataMap, opts?)` | Import from `Map<filename, object>`. Auto-builds XML/JSON. |
| `siteArchiveExportJSON` | `(env, dataUnits)` | Export and return as `Map<filename, object>`. Auto-parses XML/JSON. |

### Code

| Helper | Signature | Description |
|--------|-----------|-------------|
| `findCartridges` | `(dir)` | Find cartridge directories. **Does not accept `env`.** |
| `uploadCartridges` | `(env, cartridges)` | Upload cartridges to the instance's code version. |
| `deleteCartridges` | `(env, cartridges)` | Delete cartridges from the instance. |
| `reloadCodeVersion` | `(env)` | Reload the active code version. |
| `syncCartridges` | `(env, cartridges, reload?)` | Upload cartridges and optionally reload the code version. |

### Features

| Helper | Signature | Description |
|--------|-----------|-------------|
| `deployFeature` | `(env, featureName, opts?)` | Deploy a feature to the instance. |
| `removeFeature` | `(env, featureName, opts?)` | Remove a feature from the instance. |
| `collectFeatures` | `(dir)` | Collect feature definitions from a directory. **Does not accept `env`.** |
| `getInstanceFeatureState` | `(env)` | Read the current feature state from the instance. |
| `updateFeatureState` | `(env, name, vars, secretVars, saveSecrets)` | Update a feature's state on the instance. |

### Utilities

| Helper | Signature | Description |
|--------|-----------|-------------|
| `sleep` | `(ms)` | Promise-based delay. |
| `CONFIG` | | Object with `MIGRATIONS_DIR`, `FEATURES_DIR`, `VARS` paths. |
| `instance` | | Direct access to the `B2CInstance` object. |

### Permission Stubs

`ensureDataAPIPermissions` and `ensureWebDAVPermissions` are stubs that log warnings. Configure OCAPI and WebDAV permissions manually on your API client.

## Legacy Environment

The `env` object provides backward-compatible axios-like HTTP clients for migration scripts ported from b2c-tools. Responses are wrapped to match the axios format (`{ data, status, statusText, headers }`).

| Property | Description |
|----------|-------------|
| `env.ocapi` | OCAPI Data API client. Methods: `.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`. Base path: `/s/-/dw/data/v25_6`. |
| `env.webdav` | WebDAV client. Methods: `.get()`, `.put()`, `.post()`, `.delete()`, `.request()`. Supports both path strings and axios-style config objects (`{method, url}`). |
| `env.scapi` | SCAPI client (lazy-initialized, requires `shortCode` in config). |
| `env.server` | Instance hostname. |
| `env.clientID` | OAuth client ID. |
| `env.codeVersion` | Active code version. |

For new scripts, prefer using `instance` directly with the SDK APIs. The `env` adapter is provided so existing b2c-tools scripts work without modification.

## Features

Features are self-contained packages that bundle cartridges, migrations, and configuration into a single deployable unit. They support interactive deployment with configurable prompts, secret variable management, and stateful tracking on the instance.

For comprehensive documentation on creating and managing features, see [FEATURES.md](./FEATURES.md).

### Feature Commands

- **`migrations feature deploy [FEATURE]`** -- Deploy a feature to an instance
- **`migrations feature remove [FEATURE]`** -- Remove a feature from an instance
- **`migrations feature update`** -- Redeploy all features installed on an instance
- **`migrations feature list`** -- List available features in the project
- **`migrations feature current`** -- Show features deployed on an instance
- **`migrations feature get [FEATURE]`** -- Get details of a deployed feature
- **`migrations feature bootstrap`** -- Bootstrap feature metadata on an instance

## Commands Reference

| Command | Description |
|---------|-------------|
| `b2c migrations run` | Run and apply data migrations to a B2C Commerce instance |
| `b2c migrations feature deploy [FEATURE]` | Deploy or update a feature on an instance |
| `b2c migrations feature remove [FEATURE]` | Remove a deployed feature |
| `b2c migrations feature update` | Redeploy all installed features |
| `b2c migrations feature list` | List locally available features (no instance required) |
| `b2c migrations feature current` | List features deployed on an instance |
| `b2c migrations feature get [FEATURE]` | Get configuration/state of a deployed feature |
| `b2c migrations feature bootstrap` | Manually bootstrap feature metadata |

## Migration from b2c-tools

This plugin ports the migration and feature system from [b2c-tools](https://github.com/SalesforceCommerceCloud/b2c-tools). If migrating an existing project:

### Command Mapping

| b2c-tools | This plugin |
|-----------|-------------|
| `b2c-tools import migrate` | `b2c migrations run` |
| `b2c-tools feature deploy` | `b2c migrations feature deploy` |
| `b2c-tools feature remove` | `b2c migrations feature remove` |
| `b2c-tools feature update` | `b2c migrations feature update` |
| `b2c-tools feature list` | `b2c migrations feature list` |
| `b2c-tools feature current` | `b2c migrations feature current` |
| `b2c-tools feature get` | `b2c migrations feature get` |

### Backward Compatibility

- **Migration scripts** work without changes. The `env` parameter and all `helpers` methods are fully compatible.
- **setup.js lifecycle files** work without changes.
- **feature.js definitions** work without changes.
- All helper methods accept an `env` first argument (ignored) to match the b2c-tools calling convention.
- The `CONFIG` object on helpers matches the b2c-tools global config pattern.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Clean build output
npm run clean
```

## License

MIT
