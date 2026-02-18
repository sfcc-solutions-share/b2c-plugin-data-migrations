import * as fs from 'node:fs';
import * as path from 'node:path';
import {Args, Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {removeFeature} from '../../../lib/features.js';
import {getInstanceFeatureState} from '../../../lib/state.js';

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

export default class FeatureRemove extends InstanceCommand<typeof FeatureRemove> {
  static args = {
    feature: Args.string({
      description: 'Feature name to remove (prompts if not given)',
      required: false,
    }),
  };

  static description = 'Remove a feature from instance';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
    'features-dir': Flags.string({
      description: 'Path to features directory',
      default: './features',
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
    const featuresDir = path.resolve(flags['features-dir']);
    const vars = parseVars(flags);
    let featureName = this.args.feature;

    // If no feature name given, prompt user to select from installed features
    if (!featureName) {
      const instanceState = await getInstanceFeatureState(this.instance);

      if (instanceState === null || instanceState.features.length === 0) {
        this.log('No features installed on this instance.');
        return;
      }

      const featuresOnInstance = instanceState.features.map((f) => f.featureName);

      try {
        const inquirer = await import('inquirer');
        const answers = await inquirer.default.prompt([
          {
            name: 'featureName',
            message: 'Which feature to remove?',
            type: 'list',
            choices: featuresOnInstance,
          },
        ]);
        featureName = answers.featureName as string;
      } catch {
        this.error(
          'Feature name is required. Pass as argument or install inquirer for interactive selection.',
        );
      }
    }

    await removeFeature(this.instance, featureName!, {
      featuresDir,
      vars,
    });
  }
}
