/**
 * Saving a rotation as a playlist.
 *
 * Written straight into the game's tables: one `playlist` row, and a
 * `playlist_entry` per entry, locked at its `rate` and `mods` and played at
 * its `position`.
 */

import { gameDb } from '@oss-idle/addon-sdk';
import { modsKey, type Mod } from '@oss-idle/shared/mods';

export type PlaylistEntry = { beatmapId: number; rate: number; mods: Mod[] };

/** Games before per-character playlists have no `characterId` column. */
const perCharacter = async () => !!await gameDb.value<number>(
	'SELECT COUNT(*) FROM pragma_table_info(\'playlist\') WHERE name = \'characterId\'',
);

/** The oldest playlist called `name` of the character: the game lets two share
 * a name, and this keeps a regenerated playlist overwriting the same one. */
const playlistId = (name: string, characterId?: number) => gameDb.value<number>(
	characterId === undefined
		? 'SELECT id FROM playlist WHERE name = ? ORDER BY id LIMIT 1'
		: 'SELECT id FROM playlist WHERE name = ? AND characterId = ? ORDER BY id LIMIT 1',
	characterId === undefined ? [name] : [name, characterId],
);

/** Create or refill the playlist `name` of character `characterId` with exactly these entries. */
export const replacePlaylist = async (
	name: string,
	characterId: number,
	entries: readonly PlaylistEntry[],
): Promise<{ created: boolean }> => {
	const owner = await perCharacter() ? characterId : undefined;
	const existing = await playlistId(name, owner);
	if (existing === undefined) {
		await gameDb.run(
			owner === undefined
				? 'INSERT INTO playlist (name, createdAt) VALUES (?, ?)'
				: 'INSERT INTO playlist (name, createdAt, characterId) VALUES (?, ?, ?)',
			owner === undefined ? [name, Date.now()] : [name, Date.now(), owner],
		);
	}
	const id = existing ?? await playlistId(name, owner);
	if (id === undefined) throw new Error(`Failed to create playlist "${name}"`);
	// cleared and refilled in one save, so it is never stored half-empty
	await gameDb.batch([
		{ sql: 'DELETE FROM playlist_entry WHERE playlistId = ?', params: [id] },
		...entries.map((entry, i) => ({
			sql: 'INSERT INTO playlist_entry (playlistId, beatmapId, rate, position, mods) VALUES (?, ?, ?, ?, ?)',
			params: [id, entry.beatmapId, entry.rate, i + 1, modsKey(entry.mods)],
		})),
	]);
	return { created: existing === undefined };
};
