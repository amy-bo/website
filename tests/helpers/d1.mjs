// A small stand-in for a D1 binding over node:sqlite, enough for src/glasgow/ (prepare/bind/first/all/run, batch).
import { DatabaseSync } from 'node:sqlite';

const returnsRows = (sql) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
const args = (a) => a.map((x) => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x));

export function d1() {
	const db = new DatabaseSync(':memory:');
	const stmt = (sql, bound = []) => ({
		bind: (...a) => stmt(sql, args(a)),
		exec() {
			const s = db.prepare(sql);
			if (returnsRows(sql)) { const results = s.all(...bound).map((r) => ({ ...r })); return { results, meta: { changes: /^\s*SELECT/i.test(sql) ? 0 : results.length } }; }
			const r = s.run(...bound); return { results: [], meta: { changes: Number(r.changes) } };
		},
		async first(col) { const r = this.exec().results[0] ?? null; return r && col ? r[col] : r; },
		async all() { return this.exec(); },
		async run() { return this.exec(); },
	});
	return {
		raw: db,
		prepare: (sql) => stmt(sql),
		async batch(list) {
			db.exec('BEGIN');
			try { const out = list.map((s) => s.exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
		},
		async exec(sql) { db.exec(sql); },
	};
}
