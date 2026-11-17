import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Keep the small D1 statement interface so both hosts use the same review logic.
export function openDatabase(filename) {
  const path = resolve(filename);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
    const directory = new URL('../migrations/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      if (sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) continue;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
        sqlite.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(name);
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  } catch (error) { sqlite.close(); throw error; }
  function statement(sql, values = []) {
    return {
      bind(...args) { return statement(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  }
  return { prepare: sql => statement(sql), close: () => sqlite.close() };
}
