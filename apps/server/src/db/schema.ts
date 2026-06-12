import { primaryKey, real, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const weeklyAdjustedPrices = sqliteTable(
	'weekly_adjusted_prices',
	{
		symbol: text('symbol').notNull(),
		date: text('date').notNull(),
		open: real('open').notNull(),
		high: real('high').notNull(),
		low: real('low').notNull(),
		close: real('close').notNull(),
		adjustedClose: real('adjusted_close').notNull(),
		volume: integer('volume').notNull(),
		dividendAmount: real('dividend_amount').notNull(),
		fetchedAt: text('fetched_at').notNull(),
	},
	table => [primaryKey({ columns: [table.symbol, table.date] })],
);

export const symbolCache = sqliteTable('symbol_cache', {
	symbol: text('symbol').primaryKey(),
	lastFetchAt: text('last_fetch_at'),
	sourceFunction: text('source_function'),
	status: text('status').notNull(),
	error: text('error'),
	rowCount: integer('row_count').notNull().default(0),
});
