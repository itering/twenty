const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const requireServer = createRequire('/app/packages/twenty-server/package.json');
const { ConfigService } = requireServer('@nestjs/config');
const { ConfigVariables, validate } = requireServer(
  './dist/engine/core-modules/twenty-config/config-variables.js',
);
const { EnvironmentConfigDriver } = requireServer(
  './dist/engine/core-modules/twenty-config/drivers/environment-config.driver.js',
);
const { TwentyConfigService } = requireServer(
  './dist/engine/core-modules/twenty-config/twenty-config.service.js',
);
const { SignInUpService } = requireServer(
  './dist/engine/core-modules/auth/services/sign-in-up.service.js',
);

const variable = 'MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY';
const baseEnvironment = {
  PG_DATABASE_URL: 'postgres://test:test@localhost/test',
  REDIS_URL: 'redis://localhost:6379',
};

async function verifyLimit(environment, expectedLimit) {
  const configuration = validate(environment);
  const environmentDriver = new EnvironmentConfigDriver(
    new ConfigService(configuration),
    new ConfigVariables(),
  );
  const databaseDriver = {
    get: () => {
      throw new Error(
        'Workspace limit must never be read from database settings',
      );
    },
  };
  const twentyConfigService = new TwentyConfigService(
    environmentDriver,
    databaseDriver,
  );

  assert.equal(twentyConfigService.get(variable), expectedLimit);
  const service = Object.assign(Object.create(SignInUpService.prototype), {
    enterprisePlanService: { isValid: () => false },
    twentyConfigService,
  });
  await service.assertWorkspaceCountWithinLimit(expectedLimit - 1);
  await assert.rejects(
    service.assertWorkspaceCountWithinLimit(expectedLimit),
    new RegExp(`Cannot create more than ${expectedLimit} workspaces`),
  );
  await assert.rejects(
    service.assertWorkspaceCountWithinLimit(expectedLimit + 1),
    new RegExp(`Cannot create more than ${expectedLimit} workspaces`),
  );
}

async function verify() {
  await verifyLimit(baseEnvironment, 999);
  await verifyLimit({ ...baseEnvironment, [variable]: '3' }, 3);
  await verifyLimit({ ...baseEnvironment, [variable]: '1' }, 1);
  await verifyLimit({ ...baseEnvironment, [variable]: '1200' }, 1200);

  for (const value of [
    '',
    ' ',
    'nope',
    '0',
    '-1',
    '1.5',
    'Infinity',
    '9007199254740992',
  ]) {
    assert.throws(
      () => validate({ ...baseEnvironment, [variable]: value }),
      /Config variables validation failed/,
      `Invalid workspace limit must fail startup validation: ${JSON.stringify(value)}`,
    );
  }
  console.log(
    'Workspace configuration passed: default 999; custom 1, 3, 1200; boundaries; invalid values; environment-only lookup.',
  );
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
