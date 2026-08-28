import { readFile, writeFile } from 'node:fs/promises';

for (const file of ['dist-cli/core.js', 'dist-cli/pptx-notes.js']) {
  const text = await readFile(file, 'utf8');
  const updated = text.replace(/from '(\.\/[^']+?)(?<!\.js)'/g, "from '$1.js'");
  await writeFile(file, updated);
}
