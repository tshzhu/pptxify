import { execFileSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : 'npm';
const args = npmCli
  ? [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts']
  : ['pack', '--dry-run', '--json', '--ignore-scripts'];
const output = execFileSync(command, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const [manifest] = JSON.parse(output);
const paths = manifest.files.map((file) => file.path).sort();
const metadataFiles = new Set(['LICENSE', 'README.md', 'package.json']);
const cliFilePattern = /^dist-cli\/(?:cli|core|limits|notes|pptx-notes)\.(?:js|js\.map|d\.ts)$/;
const unexpected = paths.filter((path) => !metadataFiles.has(path) && !cliFilePattern.test(path));
const required = ['LICENSE', 'README.md', 'package.json', 'dist-cli/cli.js'];
const missing = required.filter((path) => !paths.includes(path));

if (unexpected.length || missing.length) {
  if (unexpected.length) process.stderr.write(`Unexpected package files:\n${unexpected.join('\n')}\n`);
  if (missing.length) process.stderr.write(`Missing package files:\n${missing.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`${manifest.name}@${manifest.version}: ${paths.length} CLI package files (${manifest.size} bytes)\n`);
