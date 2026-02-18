import * as fs from 'node:fs';
import * as path from 'node:path';
import {Flags} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {getLogger} from '@salesforce/b2c-tooling-sdk/logging';
import {collectFeatures, deployFeature} from '../../../lib/features.js';
import {getInstanceFeatureState} from '../../../lib/state.js';
import {buildHelpers} from '../../../lib/helpers.js';
import {LegacyEnvironment} from '../../../lib/environment.js';

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

export default class FeatureUpdate extends InstanceCommand<typeof FeatureUpdate> {
  static description = 'Redeploy all features installed on instance';

  static examples = [
    '<%= config.bin %> <%= command.id %> -s my-sandbox.demandware.net',
    '<%= config.bin %> <%= command.id %> --features-dir ./my-features',
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

    const logger = getLogger();
    const flags = this.flags;
    const featuresDir = path.resolve(flags['features-dir']);
    const vars = parseVars(flags);

    const features = await collectFeatures(featuresDir);
    const helpers = buildHelpers(this.instance, {featuresDir, vars});
    const env = new LegacyEnvironment(this.instance, {
      shortCode: this.resolvedConfig.values.shortCode,
    });

    // Call beforeDeploy for each feature
    for (const feature of features) {
      if (typeof feature.beforeDeploy === 'function') {
        await feature.beforeDeploy({
          instance: this.instance,
          logger,
          helpers,
          vars,
          env,
        });
      }
    }

    const instanceState = await getInstanceFeatureState(this.instance);

    if (instanceState === null) {
      logger.warn('No features installed on this instance; skipping feature updates...');
      return;
    }

    const featureNames = features.map((f) => f.featureName);
    const featuresToUpdate = instanceState.features
      .filter((f) => featureNames.includes(f.featureName))
      .map((f) => f.featureName);

    if (featuresToUpdate.length === 0) {
      logger.warn('No common features installed on this instance');
      return;
    }

    logger.info('Updating features...');

    for (const featureName of featuresToUpdate) {
      await deployFeature(this.instance, clientId, featureName, {
        featuresDir,
        vars,
        saveSecrets: flags['save-secrets'],
        shortCode: this.resolvedConfig.values.shortCode,
      });
    }
  }
}
