import * as path from 'node:path';
import {Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {getInstanceFeatureState} from '../../../lib/state.js';
import {collectFeatures} from '../../../lib/features.js';

export default class FeatureCurrent extends InstanceCommand<typeof FeatureCurrent> {
  static description = 'List features currently installed on instance';

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %> -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> --available',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
    'features-dir': Flags.string({
      description: 'Path to features directory',
      default: './features',
    }),
    available: Flags.boolean({
      description: 'Only list features available in the local project',
      default: false,
    }),
  };

  async run(): Promise<unknown> {
    this.requireOAuthCredentials();

    const flags = this.flags;
    const state = await getInstanceFeatureState(this.instance);

    if (state === null) {
      this.error("Cannot access features; bootstrap with 'migrations feature bootstrap' subcommand");
    }

    let instanceFeatures = state.features as Array<{featureName: string; path?: string; vars: Record<string, unknown>; creationDate: Date; lastModified: Date}>;

    if (flags.available) {
      const dir = path.resolve(flags['features-dir']);
      const features = await collectFeatures(dir);
      const availableFeatures = features.map((f) => f.featureName);
      instanceFeatures = instanceFeatures.filter((f) =>
        availableFeatures.includes(f.featureName),
      );
      // Add path from local features to state
      for (const feature of instanceFeatures) {
        const featureDef = features.find((f) => f.featureName === feature.featureName);
        if (featureDef) {
          feature.path = featureDef.path;
        }
      }
    }

    if (this.jsonEnabled()) {
      return instanceFeatures;
    }

    if (instanceFeatures.length === 0) {
      this.log('No features installed on instance.');
    } else {
      for (const f of instanceFeatures) {
        this.log(f.featureName);
      }
    }

    return instanceFeatures;
  }
}
