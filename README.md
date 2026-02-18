# b2c-plugin-data-migrations

An [oclif](https://oclif.io/) plugin for the [B2C CLI](https://github.com/SalesforceCommerceCloud/b2c-developer-tooling) that provides data migration and feature management commands for Salesforce B2C Commerce instances.

This plugin is a port of the migration and feature system from [b2c-tools](https://github.com/SalesforceCommerceCloud/b2c-tools), designed to work as a plugin for the B2C CLI with `@salesforce/b2c-tooling-sdk`.

## Installation

```bash
# Link the plugin into your b2c-cli installation
b2c plugins link /path/to/b2c-plugin-data-migrations
```

## Peer Dependencies

- `@oclif/core` ^4
- `@salesforce/b2c-tooling-sdk` (any version)

## Commands

### Migrations

- **`migrations run`** — Run and apply data migrations to a B2C Commerce instance

### Features

- **`migrations feature deploy`** — Deploy a feature to an instance
- **`migrations feature remove`** — Remove a feature from an instance
- **`migrations feature update`** — Redeploy all features installed on an instance
- **`migrations feature list`** — List available features in the project
- **`migrations feature current`** — Show features deployed on an instance
- **`migrations feature get`** — Get details of a deployed feature
- **`migrations feature bootstrap`** — Bootstrap feature metadata on an instance

## Migration Scripts

Migration scripts are JavaScript files that export a function receiving `MigrationScriptArguments`:

```js
module.exports = async function ({ instance, env, logger, helpers, vars }) {
  // instance - B2CInstance from @salesforce/b2c-tooling-sdk
  // env      - Legacy environment adapter with .ocapi, .webdav, .scapi clients
  // logger   - SDK logger
  // helpers  - Convenience helpers for common operations
  // vars     - Variables passed via --vars flags
};
```

### Legacy Environment (`env`)

The `env` object provides backward-compatible axios-like HTTP clients for scripts migrated from b2c-tools:

- **`env.ocapi`** — OCAPI Data API client (`.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`)
- **`env.webdav`** — WebDAV client (`.get()`, `.put()`, `.post()`, `.delete()`, `.request()`)
- **`env.scapi`** — SCAPI client (requires `shortCode` in config)
- **`env.server`** — Instance hostname
- **`env.clientID`** — OAuth client ID
- **`env.codeVersion`** — Active code version

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Clean build output
npm run clean
```
