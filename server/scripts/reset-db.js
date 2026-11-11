import { rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deletes the SQLite database (and its WAL sidecars) so the next start reseeds from seed.sql.
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

for (const suffix of ['portal.db', 'portal.db-wal', 'portal.db-shm']) {
  const target = join(dataDir, suffix);
  if (existsSync(target)) {
    rmSync(target, { force: true });
    console.log(`removed ${target}`);
  }
}

console.log('database reset - run "npm start" to reseed');
