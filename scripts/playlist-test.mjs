/**
 * A saved playlist must store each entry locked at its rate and mods, in the
 * rotation's order, against the tables as oss!idle migrates them.
 */
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** This repository's root, so nothing depends on where it is checked out. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);
const SQL = await require('sql.js')();
const db = new SQL.Database();

db.run(`
CREATE TABLE playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, createdAt INTEGER
);
CREATE TABLE playlist_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT, playlistId INTEGER NOT NULL, beatmapId INTEGER NOT NULL,
  rate REAL NOT NULL DEFAULT 0, position INTEGER NOT NULL, repeat INTEGER NOT NULL DEFAULT 1,
  mods TEXT NOT NULL DEFAULT ''
);
`);

globalThis.window = { db: { read: async fn => fn(db), write: async fn => fn(db) } };

const dir = join(REPO_ROOT, '.playlisttest');
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e.ts'), `export { replacePlaylist } from '../src/engine/playlist.js';`);
await build({
	entryPoints: [join(dir, 'e.ts')], outfile: join(dir, 'b.mjs'), bundle: true,
	format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
	conditions: ['import', 'default'],
	absWorkingDir: REPO_ROOT,
});
const { replacePlaylist } = await import(pathToFileURL(join(dir, 'b.mjs')).href);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : (fail++, console.log('  FAIL:', n, x)); };

const entries = (playlistId = 1) => db.exec(
	`SELECT beatmapId, rate, mods FROM playlist_entry WHERE playlistId = ${playlistId} ORDER BY position`)[0]
	?.values.map(([id, rate, m]) => `${id}@${rate}${m ? `+${m}` : ''}`).join(' ') ?? '';

const rotation = [{ beatmapId: 1, rate: 1.3, mods: ['HR'] }, { beatmapId: 2, rate: 1, mods: [] }];

const first = await replacePlaylist('Farm', 7, rotation);
check('creates the playlist', first.created === true);
check('every entry locked at its rate and mods, x1 included, in order', entries() === '1@1.3+HR 2@1', entries());

const again = await replacePlaylist('Farm', 7, [{ beatmapId: 3, rate: 0.9, mods: [] }]);
check('replaces it in place', again.created === false
	&& db.exec('SELECT COUNT(*) FROM playlist')[0].values[0][0] === 1);
check('with exactly the new entries', entries() === '3@0.9', entries());

db.run("INSERT INTO playlist (name, createdAt) VALUES ('Farm', 2)");
await replacePlaylist('Farm', 7, [{ beatmapId: 4, rate: 1, mods: [] }]);
check('a second "Farm" leaves the oldest one refilled', entries() === '4@1'
	&& db.exec('SELECT playlistId FROM playlist_entry')[0].values[0][0] === 1, entries());

// playlists per character: the game gives the column, every old one at 0
db.run('ALTER TABLE playlist ADD COLUMN characterId INTEGER NOT NULL DEFAULT 0');
const mine = await replacePlaylist('Farm', 7, [{ beatmapId: 5, rate: 1, mods: [] }]);
check('another character\'s "Farm" is left alone', mine.created === true && entries() === '4@1', entries());
check('the new one is the simulated character\'s', db.exec(
	"SELECT id FROM playlist WHERE name = 'Farm' AND characterId = 7")[0].values[0][0] === 3);
check('with its entries', entries(3) === '5@1', entries(3));
const refill = await replacePlaylist('Farm', 7, [{ beatmapId: 6, rate: 1, mods: [] }]);
check('refills that character\'s own', refill.created === false && entries(3) === '6@1', entries(3));

console.log(`\n${pass} passed, ${fail} failed`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
