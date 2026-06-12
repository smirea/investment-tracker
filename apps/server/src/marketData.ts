import env from '@repo/shared/env';
import { eq, inArray, sql } from 'drizzle-orm';

import { db } from './db';
import { symbolCache, weeklyAdjustedPrices } from './db/schema';

const apiUrl = 'https://www.alphavantage.co/query';
const cacheTtlMs = 18 * 60 * 60 * 1000;
const sourceFunction = 'TIME_SERIES_WEEKLY_ADJUSTED';
let lastAlphaVantageRequestAt = 0;

export type PricePoint = {
	symbol: string;
	date: string;
	close: number;
	adjustedClose: number;
};

export type PriceHistory = Record<string, PricePoint[]>;

export type CacheStatus = {
	symbol: string;
	status: 'cached' | 'fetched' | 'skipped' | 'error';
	lastFetchAt?: string;
	rowCount: number;
	error?: string;
};

type AlphaVantageWeeklyResponse = {
	'Weekly Adjusted Time Series'?: Record<
		string,
		{
			'1. open': string;
			'2. high': string;
			'3. low': string;
			'4. close': string;
			'5. adjusted close': string;
			'6. volume': string;
			'7. dividend amount': string;
		}
	>;
	'Error Message'?: string;
	Note?: string;
	Information?: string;
};

export async function ensurePriceHistory(symbols: string[]) {
	const uniqueSymbols = normalizeSymbols(symbols);
	const statuses: CacheStatus[] = [];
	let shouldStopFetching = false;

	for (const symbol of uniqueSymbols) {
		const cached = getCache(symbol);
		if (cached && shouldUseCachedStatus(cached)) {
			statuses.push({
				symbol,
				status: cached.rowCount > 0 ? 'cached' : (cached.status as CacheStatus['status']),
				lastFetchAt: cached.lastFetchAt ?? undefined,
				rowCount: cached.rowCount,
				error: cached.error ?? undefined,
			});
			continue;
		}

		if (!env.ALPHAVANTAGE_KEY.trim()) {
			statuses.push(markCache(symbol, 'skipped', cached?.rowCount ?? 0, 'ALPHAVANTAGE_KEY is empty'));
			continue;
		}

		if (shouldStopFetching) {
			statuses.push(markCache(symbol, 'skipped', cached?.rowCount ?? 0, 'Alpha Vantage request limit reached'));
			continue;
		}

		await waitForAlphaVantageSlot();
		const result = await fetchWeeklyAdjustedPrices(symbol);
		if (result.ok) {
			savePrices(result.points);
			statuses.push(markCache(symbol, 'fetched', result.points.length));
			continue;
		}

		if (isLimitMessage(result.error)) shouldStopFetching = true;
		statuses.push(markCache(symbol, 'error', cached?.rowCount ?? 0, result.error));
	}

	return statuses;
}

export function getPriceHistory(symbols: string[]) {
	const uniqueSymbols = normalizeSymbols(symbols);
	if (uniqueSymbols.length === 0) return {};

	const rows = db
		.select({
			symbol: weeklyAdjustedPrices.symbol,
			date: weeklyAdjustedPrices.date,
			close: weeklyAdjustedPrices.close,
			adjustedClose: weeklyAdjustedPrices.adjustedClose,
		})
		.from(weeklyAdjustedPrices)
		.where(inArray(weeklyAdjustedPrices.symbol, uniqueSymbols))
		.all();

	const history: PriceHistory = {};
	for (const row of rows) {
		(history[row.symbol] ??= []).push(row);
	}

	for (const points of Object.values(history)) {
		points.sort((a, b) => a.date.localeCompare(b.date));
	}

	return history;
}

function getCache(symbol: string) {
	return db.select().from(symbolCache).where(eq(symbolCache.symbol, symbol)).get();
}

function markCache(symbol: string, status: CacheStatus['status'], rowCount: number, error?: string): CacheStatus {
	const lastFetchAt = status === 'skipped' ? undefined : new Date().toISOString();

	db.insert(symbolCache)
		.values({
			symbol,
			lastFetchAt: lastFetchAt ?? null,
			sourceFunction,
			status,
			error: error ?? null,
			rowCount,
		})
		.onConflictDoUpdate({
			target: symbolCache.symbol,
			set: {
				lastFetchAt: lastFetchAt ?? null,
				sourceFunction,
				status,
				error: error ?? null,
				rowCount,
			},
		})
		.run();

	return { symbol, status, lastFetchAt, rowCount, error };
}

async function fetchWeeklyAdjustedPrices(symbol: string) {
	const url = new URL(apiUrl);
	url.searchParams.set('function', sourceFunction);
	url.searchParams.set('symbol', symbol);
	url.searchParams.set('apikey', env.ALPHAVANTAGE_KEY);

	const response = await fetch(url);
	if (!response.ok) return { ok: false as const, error: `Alpha Vantage returned ${response.status}` };

	const payload = (await response.json()) as AlphaVantageWeeklyResponse;
	const series = payload['Weekly Adjusted Time Series'];
	if (!series) {
		return {
			ok: false as const,
			error:
				payload['Error Message'] ?? payload.Note ?? payload.Information ?? 'No weekly adjusted price series returned',
		};
	}

	const fetchedAt = new Date().toISOString();
	const points = Object.entries(series).map(([date, point]) => ({
		symbol,
		date,
		open: numberFromApi(point['1. open']),
		high: numberFromApi(point['2. high']),
		low: numberFromApi(point['3. low']),
		close: numberFromApi(point['4. close']),
		adjustedClose: numberFromApi(point['5. adjusted close']),
		volume: numberFromApi(point['6. volume']),
		dividendAmount: numberFromApi(point['7. dividend amount']),
		fetchedAt,
	}));

	return { ok: true as const, points };
}

function savePrices(points: (typeof weeklyAdjustedPrices.$inferInsert)[]) {
	if (points.length === 0) return;

	for (let index = 0; index < points.length; index += 400) {
		const chunk = points.slice(index, index + 400);
		db.insert(weeklyAdjustedPrices)
			.values(chunk)
			.onConflictDoUpdate({
				target: [weeklyAdjustedPrices.symbol, weeklyAdjustedPrices.date],
				set: {
					open: sql`excluded.open`,
					high: sql`excluded.high`,
					low: sql`excluded.low`,
					close: sql`excluded.close`,
					adjustedClose: sql`excluded.adjusted_close`,
					volume: sql`excluded.volume`,
					dividendAmount: sql`excluded.dividend_amount`,
					fetchedAt: sql`excluded.fetched_at`,
				},
			})
			.run();
	}
}

function normalizeSymbols(symbols: string[]) {
	return [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].sort();
}

function isFresh(lastFetchAt?: string | null) {
	if (!lastFetchAt) return false;
	return Date.now() - new Date(lastFetchAt).getTime() < cacheTtlMs;
}

function shouldUseCachedStatus(cached: NonNullable<ReturnType<typeof getCache>>) {
	if (cached.sourceFunction !== sourceFunction || !isFresh(cached.lastFetchAt)) return false;
	if (cached.rowCount > 0) return true;
	if (cached.status === 'skipped') return false;
	return cached.status !== 'error' || !isBurstLimitMessage(cached.error ?? '');
}

function isLimitMessage(message: string) {
	return /limit|frequency|premium|standard api call frequency/i.test(message);
}

function isBurstLimitMessage(message: string) {
	return /1 request per second|per-second burst/i.test(message);
}

async function waitForAlphaVantageSlot() {
	const waitMs = Math.max(0, 13_000 - (Date.now() - lastAlphaVantageRequestAt));
	if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
	lastAlphaVantageRequestAt = Date.now();
}

function numberFromApi(value: string) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
