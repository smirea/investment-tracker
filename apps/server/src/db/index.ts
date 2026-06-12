import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import * as schema from './schema';

const dataDir = new URL('../../../../data/', import.meta.url);
mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(new URL('./market-cache.sqlite', dataDir).pathname);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS weekly_adjusted_prices (
		symbol TEXT NOT NULL,
		date TEXT NOT NULL,
		open REAL NOT NULL,
		high REAL NOT NULL,
		low REAL NOT NULL,
		close REAL NOT NULL,
		adjusted_close REAL NOT NULL,
		volume INTEGER NOT NULL,
		dividend_amount REAL NOT NULL,
		fetched_at TEXT NOT NULL,
		PRIMARY KEY (symbol, date)
	);

	CREATE INDEX IF NOT EXISTS weekly_adjusted_prices_symbol_date_idx
		ON weekly_adjusted_prices (symbol, date);

	CREATE TABLE IF NOT EXISTS symbol_cache (
		symbol TEXT PRIMARY KEY,
		last_fetch_at TEXT,
		source_function TEXT,
		status TEXT NOT NULL,
		error TEXT,
		row_count INTEGER NOT NULL DEFAULT 0
	);
`);

try {
	sqlite.exec('ALTER TABLE symbol_cache ADD COLUMN source_function TEXT;');
} catch {}

export const db = drizzle(sqlite, { schema });
