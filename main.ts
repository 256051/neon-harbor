// Neon Harbor — the entry program (Node, standard library only).
//
// It copies the game and its screenshots from beside this file into the
// output directory, then writes the dossier there with the kit's dossier
// builder, so the dossier is byte for byte what the builder writes.
//
//   node main.ts                       -> writes to /output
//   MAKEFUN_OUTPUT_DIR=./out node main.ts -> writes to ./out
//
// Run twice into two different directories and the outputs are identical.

import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const src = join(here, name);
  const dst = join(outDir, name);
  if (!existsSync(src)) throw new Error(`main.ts: ${name}/ is missing beside main.ts`);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`Neon Harbor: wrote ${outDir} (dossier.json ${dossier.length} bytes)`);
