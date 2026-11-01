import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const target = process.argv[2];
if (!['clsx', 'todomvc'].includes(target)) throw new Error('Usage: node run.mjs clsx|todomvc');
const binary = resolve(process.env.PRQ_BINARY ?? join(here, '../../packages/cli/dist/index.js'));
const targets = resolve(process.env.PRQ_TARGET_ROOT ?? '/tmp/prq-external-targets');
if (!targets.startsWith('/private/tmp/') && !targets.startsWith('/tmp/')) throw new Error('Use a disposable target root beneath /tmp.');
const repo = join(targets, target);
const config = manifest.repositories[target];
const output = resolve(process.env.PRQ_EXTERNAL_OUTPUT ?? join(targets, 'results', target));
await mkdir(output, { recursive: true });
const secretless = { ...process.env }; delete secretless.OPENAI_API_KEY;
const executionEnv = target === 'clsx' ? { ...secretless, PATH: `${join(targets, 'runtime/node_modules/node/bin')}:${process.env.PATH}` } : secretless;
async function run(command, args, options = {}) {
  const started = Date.now();
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? repo, env: options.env ?? executionEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject);
    child.on('close', code => resolveResult({ command, args, exit_code: code, stdout, stderr, duration_ms: Date.now() - started }));
  });
}
async function required(command, args, options) {
  const result = await run(command, args, options);
  if (result.exit_code !== 0) throw new Error(`${command} did not complete: ${result.stderr}`);
  return result;
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
await mkdir(targets, { recursive: true });
if (!(await exists(join(repo, '.git')))) {
  await required('git', ['init', repo], { cwd: targets });
  await required('git', ['remote', 'add', 'origin', config.url]);
  await required('git', ['fetch', '--depth', '1', 'origin', config.commit]);
  await required('git', ['checkout', '--detach', config.commit]);
}
const head = (await required('git', ['rev-parse', 'HEAD'])).stdout.trim();
if (head !== config.commit) throw new Error(`Expected pinned upstream HEAD ${config.commit}; found ${head}. Use a new temporary root.`);
if ((await required('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()) throw new Error('Tracked target files are already modified.');
const toolHash = createHash('sha256').update(await readFile(binary)).digest('hex');
const setup = [];
if (target === 'clsx') {
  if (!(await exists(join(targets, 'runtime/node_modules/node/bin/node')))) {
    await cp(join(here, 'locks/runtime'), join(targets, 'runtime'), { recursive: true });
    setup.push(await required('npm', ['ci', '--prefix', join(targets, 'runtime'), '--no-audit', '--no-fund'], { env: secretless }));
  }
  if (!(await exists(join(repo, 'node_modules/uvu')))) {
    await cp(join(here, 'locks/clsx/package-lock.json'), join(repo, 'package-lock.json'));
    setup.push(await required('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { env: secretless }));
  }
} else {
  const runtime = join(targets, 'e2e-runtime');
  if (!(await exists(join(runtime, 'node_modules/e2e')))) {
    await cp(join(here, 'locks/e2e-runtime'), runtime, { recursive: true });
    setup.push(await required('npm', ['ci', '--prefix', runtime, '--ignore-scripts', '--no-audit', '--no-fund'], { env: secretless }));
  }
  if (!(await exists(join(repo, 'node_modules')))) await symlink(join(runtime, 'node_modules'), join(repo, 'node_modules'));
  if (await exists(join(repo, 'e2e.config.ts')) && await readFile(join(repo, 'e2e.config.ts'), 'utf8') !== await readFile(join(here, 'e2e.config.ts'), 'utf8')) throw new Error('Refusing to overwrite an existing e2e configuration.');
  await cp(join(here, 'e2e.config.ts'), join(repo, 'e2e.config.ts'));
}
await cp(join(repo, config.license_path), join(output, 'upstream-license.txt'));
const original = await readFile(join(repo, config.mutation_file), 'utf8');
if (original.split(config.before).length !== 2) throw new Error('Mutation anchor must occur exactly once.');
const source = await readFile(join(here, 'claims', `${target}.md`), 'utf8');
const records = [];
let service;
let mutationCommitted = false;
let serviceLog = '';
let serviceStopped = true;
try {
  if (target === 'todomvc') {
    service = spawn(process.execPath, [join(here, 'serve.mjs'), join(repo, config.serve_directory), '4317'], { env: secretless, stdio: ['ignore', 'pipe', 'pipe'] });
    service.stdout.on('data', data => { serviceLog += data; });
    service.stderr.on('data', data => { serviceLog += data; });
    await new Promise((resolveReady, reject) => { service.stdout.once('data', resolveReady); service.once('error', reject); service.once('exit', code => reject(new Error(`Local server exited ${code}`))); });
  }
  for (const state of ['baseline', 'mutated']) {
    if (state === 'mutated') {
      await writeFile(join(repo, config.mutation_file), original.replace(config.before, config.after));
      await writeFile(join(output, 'mutation.patch'), (await required('git', ['diff', '--', config.mutation_file])).stdout);
      await required('git', ['add', config.mutation_file]);
      await required('git', ['-c', 'user.name=prq benchmark', '-c', 'user.email=benchmark@localhost', 'commit', '-m', 'Plant a controlled benchmark defect']);
      mutationCommitted = true;
    }
    const oracle = target === 'clsx'
      ? await run('npm', ['test'])
      : await run(process.execPath, [join(here, 'oracle.mjs'), repo, join(output, `${state}-oracle.png`)], { env: secretless });
    await writeFile(join(output, `${state}-oracle.json`), JSON.stringify(oracle, null, 2) + '\n');
    const oracleObservation = target === 'todomvc' && oracle.stdout.trim() ? JSON.parse(oracle.stdout) : null;
    if (state === 'baseline' && oracle.exit_code !== 0) throw new Error('Baseline oracle did not hold. Evidence retained; no baseline claim is assumed true.');
    const args = state === 'baseline' ? ['--claims', join(here, 'claims', `${target}.md`)] : ['rerun'];
    const invocation = await run(process.execPath, [binary, ...args, '--json', '--quiet', '--app-url', 'http://127.0.0.1:4317'], { env: { ...executionEnv, OPENAI_API_KEY: process.env.OPENAI_API_KEY } });
    await writeFile(join(output, `${state}-cli.json`), JSON.stringify(invocation, null, 2) + '\n');
    const proof = JSON.parse(await readFile(join(repo, '.pr/last.json'), 'utf8'));
    if (proof.source.text !== source || proof.claims.some(claim => !source.includes(claim.text))) throw new Error('Claim source/verbatim check did not hold.');
    if (state === 'mutated' && proof.source.hash !== records[0].claim_lock) throw new Error('Claim lock changed between states.');
    await cp(join(repo, '.pr/runs', proof.id), join(output, state), { recursive: true });
    records.push({ state, upstream_commit: config.commit, tested_commit: proof.subject.head, claim_lock: proof.source.hash, claims_verbatim: true, summary: proof.summary, claims: proof.claims.map(({ id, text, verdict, probability, tester, observed }) => ({ id, text, verdict, probability, tester, observed })), oracle_observation: oracleObservation, oracle_exit_code: oracle.exit_code, oracle_duration_ms: oracle.duration_ms, prq_duration_ms: proof.timing.total_ms, wall_duration_ms: invocation.duration_ms, cost_usd: null, proof: `${state}/proof-request.json` });
    console.log(`${target} ${state}: ${JSON.stringify(proof.summary)}`);
  }
} finally {
  if (service && service.exitCode === null && service.signalCode === null) { const stopped = new Promise(resolveStop => service.once('exit', resolveStop)); service.kill('SIGTERM'); await stopped; }
  if (service) { serviceStopped = service.exitCode !== null || service.signalCode !== null; await writeFile(join(output, 'service.log'), serviceLog); }
  if (mutationCommitted) await required('git', ['checkout', '--detach', config.commit]);
}
const results = { scope: manifest.scope, repository: config, tool_sha256: toolHash, frozen_tool_matches_manifest: toolHash === manifest.tool_sha256, models: manifest.models, node_prq: process.version, test_runtime: target === 'clsx' ? 'Node 18.20.8, upstream legacy esm loader' : process.version, setup, records, cleanup: { service_stopped: serviceStopped, source_restored: (await readFile(join(repo, config.mutation_file), 'utf8')) === original }, created_at: new Date().toISOString(), cost_usd: null };
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
