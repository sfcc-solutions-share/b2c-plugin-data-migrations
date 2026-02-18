import * as path from 'node:path';
import {Command, Flags} from '@oclif/core';
import {collectFeatures} from '../../../lib/features.js';

export default class FeatureList extends Command {
  static description = 'List available features in the project';

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --features-dir ./my-features',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    'features-dir': Flags.string({
      description: 'Path to features directory',
      default: './features',
    }),
  };

  async run(): Promise<unknown> {
    const {flags} = await this.parse(FeatureList);
    const dir = path.resolve(flags['features-dir']);

    const features = await collectFeatures(dir);

    if (this.jsonEnabled()) {
      return features;
    }

    if (features.length === 0) {
      this.log('No features found.');
    } else {
      for (const f of features) {
        this.log(f.featureName);
      }
    }

    return features;
  }
}
