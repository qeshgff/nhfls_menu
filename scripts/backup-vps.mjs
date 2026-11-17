import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const source = resolve(process.env.DATABASE_PATH || './data/reviews.sqlite');
const target = resolve(process.argv[2] || `./backups/reviews-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
mkdirSync(dirname(target), { recursive:true, mode:0o700 });
const sqlite = new DatabaseSync(source, { readOnly:true });
try { await backup(sqlite,target); console.log(`Database backup saved: ${target}`); }
finally { sqlite.close(); }
