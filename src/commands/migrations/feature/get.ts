import {Args, Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {getInstanceFeatureState} from '../../../lib/state.js';

export default class FeatureGet extends InstanceCommand<typeof FeatureGet> {
  static args = {
    feature: Args.string({
      description: 'Feature name to get',
      required: false,
    }),
  };

  static description = 'Get feature state from instance';

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
  };

  async run(): Promise<unknown> {
    this.requireOAuthCredentials();

    const {feature: featureName} = this.args;
    const state = await getInstanceFeatureState(this.instance);

    if (state === null) {
      this.error("Cannot access features; bootstrap with 'migrations feature bootstrap' subcommand");
    }

    if (featureName) {
      const feature = state.features.find((f) => f.featureName === featureName);
      if (!feature) {
        this.error('Cannot find feature on instance');
      }

      if (!this.jsonEnabled()) {
        this.log(JSON.stringify(feature, null, 2));
      }
      return feature;
    }

    if (!this.jsonEnabled()) {
      this.log(JSON.stringify(state, null, 2));
    }
    return state;
  }
}
