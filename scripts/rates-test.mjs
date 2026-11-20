/** The rates a character can play count Speed prestige as well as upgrades, as the game does:
 *  a prestiged character with no upgrade plays x0.95 to x1.05. The game's own rate steps are used. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(REPO_ROOT, '.ratestest');
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e.ts'), `export { ratesFor, unlockedRates } from '../src/engine/client.js';`);
// everything but the game's rate rules is stubbed
const stubs = {
	name: 'stub-deps',
	setup(b) {
		b.onResolve({ filter: /^(@oss-idle\/addon-sdk|@oss-idle\/shared\/.*|worker:.*)$/ },
			a => (a.path === '@oss-idle/shared/rate' ? undefined : { path: a.path, namespace: 'stub' }));
		b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: 'export default () => undefined;'
				+ ' export const beatmapStore = {}; export const gameDb = {}; export const gameCharacter = {};'
				+ ' export const playCountsSince = async () => ({}); export const hasUnlock = () => false;'
				+ ' export const medalXPMultiplier = () => 1; export const MEDALS = [];'
				+ ' export const fatigueLevel = () => 0; export const fatigueXp = () => 1;'
				+ ' export const keptShare = () => 1; export const warmup = () => 1;'
				+ ' export const modsKey = mods => mods.join(); export const modXpMultipliers = () => ({});'
				+ ' export const PHYSICAL_SKILLS = []; export const Skills = [];'
				+ ' export const skillXPMultiplier = () => 1; export const playLevelOf = level => level;'
				+ ' export const xpGivesLevel = () => ({ level: 0, xp: 0 }); export const xpToLevel = () => 0;'
				+ ' export const LEAD_IN_MS = 2000;',
			loader: 'js',
		}));
	},
};
await build({
	entryPoints: [join(dir, 'e.ts')], outfile: join(dir, 'b.mjs'), bundle: true,
	format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
	conditions: ['import', 'default'], absWorkingDir: REPO_ROOT, plugins: [stubs],
});
const { ratesFor, unlockedRates } = await import(pathToFileURL(join(dir, 'b.mjs')).href);
rmSync(dir, { recursive: true, force: true });

assert.deepEqual(unlockedRates({ speedUpgrades: 0, speedPrestige: 0 }), [1]);
assert.deepEqual(unlockedRates({ speedUpgrades: 0, speedPrestige: 1 }), [0.95, 1, 1.05]);
assert.deepEqual(unlockedRates({ speedUpgrades: 1, speedPrestige: 1 }), [0.9, 0.95, 1, 1.05, 1.1]);
assert.deepEqual(unlockedRates({ speedUpgrades: '2', speedPrestige: '1' }), unlockedRates({ speedUpgrades: 3 }));
assert.deepEqual(unlockedRates(undefined), [1]);
assert.deepEqual(ratesFor({ speedUpgrades: 0, speedPrestige: 1 }, [1.05]), [0.95, 1]);
console.log('rates: ok');
