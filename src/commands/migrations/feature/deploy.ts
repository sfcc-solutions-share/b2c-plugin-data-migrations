import * as fs from 'node:fs';
import * as path from 'node:path';
import {Args, Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {deployFeature, collectFeatures} from '../../../lib/features.js';

/**
 * Parse vars from multiple input sources.
 */
function parseVars(flags: {
  vars?: string[];
  'vars-file'?: string;
  'vars-json'?: string;
}): Record<string, unknown> {
  let result: Record<string, unknown> = {};

  if (flags['vars-file']) {
    const content = fs.readFileSync(path.resolve(flags['vars-file']), 'utf-8');
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

export default class FeatureDeploy extends InstanceCommand<typeof FeatureDeploy> {
  static args = {
    feature: Args.string({
      description: 'Feature name to deploy (prompts if not given)',
      required: false,
    }),
  };

  static description = 'Deploy a feature to instance';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> --features-dir ./my-features',
    '<%= config.bin %> <%= command.id %> my-feature --vars key1=value1',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
    'features-dir': Flags.string({
      description: 'Path to features directory',
      default: './features',
    }),
    'save-secrets': Flags.boolean({
      description: 'Save secrets in feature metadata on instance',
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
      this.error('Client ID is required. Set via --client-id or SFCC_CLIENT_ID.');
    }

    const flags = this.flags;
    const featuresDir = path.resolve(flags['features-dir']);
    const vars = parseVars(flags);
    let featureName = this.args.feature;

    // If no feature name given, prompt user to select from available features
    if (!featureName) {
      const features = await collectFeatures(featuresDir);
      const featuresInProject = features.map((f) => f.featureName);

      if (featuresInProject.length === 0) {
        this.error('No features found in project.');
      }

      try {
        const inquirer = await import('inquirer');
        const answers = await inquirer.default.prompt([
          {
            name: 'featureName',
            message: 'Which feature to deploy?',
            type: 'list',
            choices: featuresInProject,
          },
        ]);
        featureName = answers.featureName as string;
      } catch {
        this.error(
          'Feature name is required. Pass as argument or install inquirer for interactive selection.',
        );
      }
    }

    await deployFeature(this.instance, clientId, featureName!, {
      featuresDir,
      vars,
      saveSecrets: flags['save-secrets'],
      shortCode: this.resolvedConfig.values.shortCode,
    });
  }
}
