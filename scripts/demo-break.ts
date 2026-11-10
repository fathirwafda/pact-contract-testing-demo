/**
 * Breaking-change demo. Runs provider verification with ORDER_SERVICE_BREAKING_CHANGE=rename-stock,
 * which makes the provider send `quantityAvailable` instead of `stock`. Only the environment of the
 * child process changes, so nothing is left broken afterwards.
 *
 * Exit code 0 means the contract caught the change (the expected outcome); 1 means it did not.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const pactDir = path.join(root, 'pacts');

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('npx', args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status,
    output: stripVTControlCharacters(`${result.stdout}${result.stderr}`),
  };
}

if (!existsSync(pactDir) || !readdirSync(pactDir).some((file) => file.endsWith('.json'))) {
  console.log('No pact files yet, running the consumer tests first...');
  const consumer = run(['vitest', 'run', '--project', 'consumer']);
  if (consumer.status !== 0) {
    console.error(consumer.output);
    process.exit(1);
  }
}

console.log('Verifying the provider with ORDER_SERVICE_BREAKING_CHANGE=rename-stock');
console.log('(the provider renames `stock` to `quantityAvailable` in product responses)\n');

const verification = run(['vitest', 'run', '--project', 'provider'], {
  ORDER_SERVICE_BREAKING_CHANGE: 'rename-stock',
});

const failures = /Failures:[\s\S]*?There were \d+ pact failures?/.exec(verification.output);
const pactHeader = /^Verifying a pact between (\S+) and order-service/gm;
const consumers = [...verification.output.matchAll(pactHeader)].map((match) => match[1]);

if (verification.status === 0 || !failures) {
  console.error('Verification did not fail. The contract did not catch the rename.');
  console.error(verification.output);
  process.exit(1);
}

console.log(`Consumers verified: ${consumers.join(', ')}\n`);
console.log(failures[0]);
console.log('\nResult: the contract caught the breaking change, as expected.');
console.log(
  'Only mobile-app reads `stock`, so only its contract fails; web-frontend is unaffected.',
);
console.log('The provider code is unchanged. Run `npm run test:provider` to see it pass again.');
