import * as fs from 'node:fs';
import * as path from 'node:path';
import {Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {migrateInstance} from '../../lib/migrations.js';

/**
 * Parse vars from multiple input sources: --vars-file, --vars-json, and --vars flags.
 * Precedence: file < json < cli flags.
 */
function parseVars(flags: {
  vars?: string[];
  'vars-file'?: string;
  'vars-json'?: string;
}): Record<string, unknown> {
  let result: Record<string, unknown> = {};

  // 1. Load from file
  if (flags['vars-file']) {
    const filePath = path.resolve(flags['vars-file']);
    const content = fs.readFileSync(filePath, 'utf-8');
    result = {...result, ...JSON.parse(content)};
  }

  // 2. Merge inline JSON
  if (flags['vars-json']) {
    result = {...result, ...JSON.parse(flags['vars-json'])};
  }

  // 3. Merge CLI key=value pairs
  if (flags.vars) {
    for (const v of flags.vars) {
      const idx = v.indexOf('=');
      if (idx === -1) {
        throw new Error(`Invalid var format: "${v}". Expected key=value.`);
      }
      result[v.slice(0, idx)] = v.slice(idx + 1);
    }
  }

  return result;
}

export default class MigrationsRun extends InstanceCommand<typeof MigrationsRun> {
  static args = {};

  static description = 'Run and apply data migrations to a B2C Commerce instance';

  static examples = [
    '<%= config.bin %> <%= command.id %> -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --migrations-dir ./my-migrations',
    '<%= config.bin %> <%= command.id %> --exclude "^test-" --exclude "^dev-"',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
    'migrations-dir': Flags.string({
      description: 'Path to migrations directory',
      default: './migrations',
    }),
    'force-bootstrap': Flags.boolean({
      description: 'Force a bootstrap install/upgrade',
      default: false,
    }),
    'allow-bootstrap': Flags.boolean({
      description: 'Allow bootstrapping of instance',
      default: true,
      allowNo: true,
    }),
    exclude: Flags.string({
      char: 'x',
      description: 'Excluded directory patterns (regexp)',
      multiple: true,
    }),
    apply: Flags.boolean({
      description: 'Apply migrations to instance state',
      default: true,
      allowNo: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Show only migrations that would be applied',
      default: false,
    }),
    notes: Flags.boolean({
      description: 'Output migration notes',
      default: true,
      allowNo: true,
    }),
    vars: Flags.string({
      description: 'Variables as key=value pairs',
      multiple: true,
    }),
    'vars-file': Flags.string({
      description: 'Path to JSON vars file',
    }),
    'vars-json': Flags.string({
      description: 'Inline JSON vars string',
    }),
  };

  async run(): Promise<void> {
    this.requireOAuthCredentials();

    const clientId = this.resolvedConfig.values.clientId;
    if (!clientId) {
      this.error('Client ID is required for migrations. Set via --client-id or SFCC_CLIENT_ID.');
    }

    const flags = this.flags;
    const vars = parseVars(flags);
    const dir = path.resolve(flags['migrations-dir']);

    if (!fs.existsSync(dir)) {
      // Check if the user is already inside a migrations directory
      const cwd = process.cwd();
      const cwdHasMigrations =
        fs.existsSync(path.join(cwd, 'setup.js')) ||
        fs.readdirSync(cwd).some((f) => /^\d{8}T\d{6}/.test(f));
      const hint = cwdHasMigrations
        ? ` (it looks like the current directory is already a migrations directory; try --migrations-dir . or run from the project root)`
        : '';
      this.error(`Migrations directory does not exist: ${dir}${hint}`);
    }

    await migrateInstance(this.instance, clientId, dir, {
      exclude: flags.exclude,
      apply: flags.apply,
      dryRun: flags['dry-run'],
      forceBootstrap: flags['force-bootstrap'],
      allowBootstrap: flags['allow-bootstrap'],
      vars,
      showNotes: flags.notes,
      shortCode: this.resolvedConfig.values.shortCode,
    });
  }
}
