import {Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {bootstrapFeatures} from '../../../lib/bootstrap.js';

export default class FeatureBootstrap extends InstanceCommand<typeof FeatureBootstrap> {
  static description = 'Bootstrap instance for feature installation';

  static examples = [
    '<%= config.bin %> <%= command.id %> -s my-sandbox.demandware.net',
  ];

  static flags = {
    ...InstanceCommand.baseFlags,
  };

  async run(): Promise<void> {
    this.requireOAuthCredentials();

    const clientId = this.resolvedConfig.values.clientId;
    if (!clientId) {
      this.error('Client ID is required. Set via --client-id or SFCC_CLIENT_ID.');
    }

    await bootstrapFeatures(this.instance, clientId);
    this.log('Feature bootstrap complete.');
  }
}
