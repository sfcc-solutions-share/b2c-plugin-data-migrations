import * as fs from 'node:fs';
import * as path from 'node:path';
import {Args, Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {runMigrationScript} from '../../lib/migrations.js';

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

  if (flags['vars-file']) {
    const filePath = path.resolve(flags['vars-file']);
    const content = fs.readFileSync(filePath, 'utf-8');
    result = {...result, ...JSON.parse(content)};
  }

  if (flags['vars-json']) {
    result = {...result, ...JSON.parse(flags['vars-json'])};
  }

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

export default class MigrationsRunScript extends InstanceCommand<typeof MigrationsRunScript> {
  static args = {
    file: Args.string({
      description: 'Path to a migration script (.js file)',
      required: true,
    }),
  };

  static description = 'Run a single migration script against a B2C Commerce instance';

  static examples = [
    '<%= config.bin %> <%= command.id %> ./migrations/20240605T082733_pwdless_login.js -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> ./migrations/my-script.js --vars siteId=RefArch',
    '<%= config.bin %> <%= command.id %> ./migrations/my-script.js --vars-file ./vars.json',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
    apply: Flags.boolean({
      description: 'Record the migration as applied in instance state',
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

    const flags = this.flags;
    const {file} = this.args;
    const resolvedFile = path.resolve(file);

    if (!fs.existsSync(resolvedFile)) {
      this.error(`Migration script not found: ${resolvedFile}`);
    }

    if (path.extname(resolvedFile) !== '.js') {
      this.error(`Expected a .js migration script, got: ${path.basename(resolvedFile)}`);
    }

    const vars = parseVars(flags);

    await runMigrationScript(this.instance, resolvedFile, {
      vars,
      shortCode: this.resolvedConfig.values.shortCode,
      apply: flags.apply,
    });
  }
}
