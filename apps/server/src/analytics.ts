import { parse } from 'csv-parse/sync';
import { readdirSync, readFileSync } from 'node:fs';

import {
	ensurePriceHistory,
	getPriceHistory,
	type CacheStatus,
	type PriceHistory,
	type PricePoint,
} from './marketData';

const dataDir = new URL('../../../data/', import.meta.url);
const marketSymbol = 'SPY';
const horizons = [
	{ key: '1m', label: '1 month', months: 1 },
	{ key: '3m', label: '3 months', months: 3 },
	{ key: '6m', label: '6 months', months: 6 },
	{ key: '12m', label: '12 months', months: 12 },
] as const;

type SchwabRow = {
	Date: string;
	Action: string;
	Symbol: string;
	Description: string;
	Quantity: string;
	Price: string;
	'Fees & Comm': string;
	Amount: string;
};

type StockTransaction = {
	id: string;
	file: string;
	line: number;
	date: string;
	action: 'Buy' | 'Sell';
	symbol: string;
	description: string;
	quantity: number;
	price: number;
	fees: number;
	amount: number;
};

type Lot = {
	buyId: string;
	date: string;
	remainingQuantity: number;
	costPerShare: number;
};

type Match = {
	buyId: string;
	buyDate: string;
	quantity: number;
	costBasis: number;
};

type MatchedTrade = {
	id: string;
	date: string;
	symbol: string;
	description: string;
	quantity: number;
	matchedQuantity: number;
	unmatchedQuantity: number;
	soldPrice: number;
	proceeds: number;
	matchedProceeds?: number;
	costBasis?: number;
	actualPnl?: number;
	actualReturnPct?: number;
	earliestBuyDate?: string;
	latestBuyDate?: string;
	holdingDays?: number;
	matches: Match[];
};

export type ComparisonMetric = {
	targetDate: string;
	price: number;
	pnl: number;
	returnPct: number;
	deltaPnl: number;
	deltaReturnPct: number;
};

export type TradeRow = MatchedTrade & {
	marketPnl?: number;
	marketReturnPct?: number;
	later: Record<string, ComparisonMetric | null>;
	earlier: Record<string, ComparisonMetric | null>;
};

export type DashboardSummary = {
	tradeCount: number;
	analyzedTradeCount: number;
	totalCostBasis: number;
	actualPnl: number;
	actualReturnPct?: number;
	marketPnl?: number;
	marketReturnPct?: number;
	beatMarket?: boolean;
	beatMarketBy?: number;
	timingVerdict: 'earlier' | 'later' | 'actual' | 'insufficient';
	timingDeltaPnl?: number;
	timingDeltaReturnPct?: number;
	earlierAverageDeltaPnl?: number;
	laterAverageDeltaPnl?: number;
};

export type ChartPoint = {
	date: string;
	actualReturnPct: number;
	marketReturnPct: number;
};

export type DashboardResponse = {
	ok: true;
	generatedAt: string;
	csvFiles: string[];
	symbols: string[];
	selectedSymbols: string[];
	marketSymbol: string;
	cache: CacheStatus[];
	summary: DashboardSummary;
	chart: ChartPoint[];
	trades: TradeRow[];
	horizons: typeof horizons;
};

export async function buildDashboard(url: URL): Promise<DashboardResponse> {
	const { files, transactions } = readStockTransactions();
	const matchedTrades = matchTrades(transactions);
	const symbols = [...new Set(matchedTrades.map(trade => trade.symbol))].sort();
	const selectedSymbols = getSelectedSymbols(url, symbols);
	const selectedTrades = matchedTrades.filter(trade => selectedSymbols.includes(trade.symbol));
	const requiredSymbols = selectedSymbols.length > 0 ? [...selectedSymbols, marketSymbol] : [marketSymbol];
	const cache = await ensurePriceHistory(requiredSymbols);
	const history = getPriceHistory(requiredSymbols);
	const trades = enrichTrades(selectedTrades, history);

	return {
		ok: true,
		generatedAt: new Date().toISOString(),
		csvFiles: files,
		symbols,
		selectedSymbols,
		marketSymbol,
		cache,
		summary: summarize(trades),
		chart: buildChart(trades),
		trades: trades.sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol)),
		horizons,
	};
}

function readStockTransactions() {
	const files = readdirSync(dataDir)
		.filter(file => file.toLowerCase().endsWith('.csv'))
		.sort();
	const transactions: StockTransaction[] = [];

	for (const file of files) {
		const rows = parse(readFileSync(new URL(file, dataDir), 'utf8'), {
			bom: true,
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as SchwabRow[];

		rows.forEach((row, index) => {
			const transaction = toStockTransaction(row, file, index + 2);
			if (transaction) transactions.push(transaction);
		});
	}

	return { files, transactions };
}

function toStockTransaction(row: SchwabRow, file: string, line: number): StockTransaction | undefined {
	const action = row.Action.trim();
	if (action !== 'Buy' && action !== 'Sell') return;

	const symbol = row.Symbol.trim().toUpperCase();
	const description = row.Description.trim();
	if (!symbol || !/^[A-Z][A-Z.]{0,8}$/.test(symbol)) return;
	if (symbol === marketSymbol) return;
	if (/MONEY INVESTOR|TREASURY MONEY|VALUE ADVANTAGE|CD FDIC/i.test(description)) return;

	const date = parseDate(row.Date);
	const quantity = numberFrom(row.Quantity);
	const price = moneyFrom(row.Price);
	const amount = moneyFrom(row.Amount);
	if (!date || quantity <= 0 || price <= 0 || !Number.isFinite(amount)) return;

	return {
		id: `${file}:${line}`,
		file,
		line,
		date,
		action,
		symbol,
		description,
		quantity,
		price,
		fees: moneyFrom(row['Fees & Comm']),
		amount,
	};
}

function matchTrades(transactions: StockTransaction[]) {
	const lots = new Map<string, Lot[]>();
	const trades: MatchedTrade[] = [];
	const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || b.line - a.line);

	for (const transaction of ordered) {
		if (transaction.action === 'Buy') {
			const totalCost =
				transaction.amount < 0
					? Math.abs(transaction.amount)
					: transaction.quantity * transaction.price + transaction.fees;
			(lots.get(transaction.symbol) ?? lots.set(transaction.symbol, []).get(transaction.symbol)!).push({
				buyId: transaction.id,
				date: transaction.date,
				remainingQuantity: transaction.quantity,
				costPerShare: totalCost / transaction.quantity,
			});
			continue;
		}

		const symbolLots = lots.get(transaction.symbol) ?? [];
		const matches: Match[] = [];
		let remaining = transaction.quantity;
		let costBasis = 0;

		while (remaining > 0.000001 && symbolLots.length > 0) {
			const lot = symbolLots[0];
			const quantity = Math.min(remaining, lot.remainingQuantity);
			const matchCost = quantity * lot.costPerShare;
			matches.push({
				buyId: lot.buyId,
				buyDate: lot.date,
				quantity,
				costBasis: matchCost,
			});
			costBasis += matchCost;
			remaining -= quantity;
			lot.remainingQuantity -= quantity;
			if (lot.remainingQuantity <= 0.000001) symbolLots.shift();
		}

		const matchedQuantity = transaction.quantity - remaining;
		const proceeds =
			transaction.amount > 0 ? transaction.amount : transaction.quantity * transaction.price - transaction.fees;
		const matchedProceeds = matchedQuantity > 0 ? proceeds * (matchedQuantity / transaction.quantity) : undefined;
		const actualPnl = matchedProceeds === undefined ? undefined : matchedProceeds - costBasis;
		const buyDates = matches.map(match => match.buyDate).sort();

		trades.push({
			id: transaction.id,
			date: transaction.date,
			symbol: transaction.symbol,
			description: transaction.description,
			quantity: transaction.quantity,
			matchedQuantity,
			unmatchedQuantity: remaining,
			soldPrice: transaction.price,
			proceeds,
			matchedProceeds,
			costBasis: matchedQuantity > 0 ? costBasis : undefined,
			actualPnl,
			actualReturnPct: actualPnl !== undefined && costBasis > 0 ? actualPnl / costBasis : undefined,
			earliestBuyDate: buyDates[0],
			latestBuyDate: buyDates.at(-1),
			holdingDays: weightedHoldingDays(matches, transaction.date, costBasis),
			matches,
		});
	}

	return trades;
}

function enrichTrades(trades: MatchedTrade[], history: PriceHistory) {
	return trades.map(trade => {
		const symbolHistory = history[trade.symbol] ?? [];
		const marketHistory = history[marketSymbol] ?? [];
		const later = Object.fromEntries(
			horizons.map(horizon => [horizon.key, compareHypothetical(trade, symbolHistory, horizon.months, 1)]),
		);
		const earlier = Object.fromEntries(
			horizons.map(horizon => [horizon.key, compareHypothetical(trade, symbolHistory, horizon.months, -1)]),
		);
		const market = compareMarket(trade, marketHistory);

		return {
			...trade,
			marketPnl: market?.pnl,
			marketReturnPct: market?.returnPct,
			later,
			earlier,
		};
	});
}

function compareHypothetical(
	trade: MatchedTrade,
	history: PricePoint[],
	months: number,
	direction: 1 | -1,
): ComparisonMetric | null {
	if (
		!trade.costBasis ||
		trade.actualPnl === undefined ||
		trade.actualReturnPct === undefined ||
		trade.matchedQuantity <= 0
	) {
		return null;
	}

	const targetDate = addMonths(trade.date, months * direction);
	if (direction === -1 && trade.latestBuyDate && targetDate <= trade.latestBuyDate) return null;

	const point = direction === 1 ? priceOnOrAfter(history, targetDate) : priceOnOrBefore(history, targetDate);
	if (!point) return null;

	const pnl = point.adjustedClose * trade.matchedQuantity - trade.costBasis;
	const returnPct = pnl / trade.costBasis;
	return {
		targetDate: point.date,
		price: point.adjustedClose,
		pnl,
		returnPct,
		deltaPnl: pnl - trade.actualPnl,
		deltaReturnPct: returnPct - trade.actualReturnPct,
	};
}

function compareMarket(trade: MatchedTrade, marketHistory: PricePoint[]) {
	if (!trade.costBasis || trade.matches.length === 0) return;

	let basis = 0;
	let marketValue = 0;
	for (const match of trade.matches) {
		const buyPoint = priceOnOrBefore(marketHistory, match.buyDate);
		const sellPoint = priceOnOrBefore(marketHistory, trade.date);
		if (!buyPoint || !sellPoint) continue;

		basis += match.costBasis;
		marketValue += match.costBasis * (sellPoint.adjustedClose / buyPoint.adjustedClose);
	}

	if (basis === 0) return;
	const pnl = marketValue - basis;
	return { pnl, returnPct: pnl / basis };
}

function summarize(trades: TradeRow[]): DashboardSummary {
	const analyzed = trades.filter(trade => trade.costBasis && trade.actualPnl !== undefined);
	const marketComparable = analyzed.filter(trade => trade.marketPnl !== undefined);
	const totalCostBasis = sum(analyzed.map(trade => trade.costBasis ?? 0));
	const actualPnl = sum(analyzed.map(trade => trade.actualPnl ?? 0));
	const comparableActualPnl = sum(marketComparable.map(trade => trade.actualPnl ?? 0));
	const marketPnl = sum(marketComparable.map(trade => trade.marketPnl ?? 0));
	const marketBasis = sum(marketComparable.map(trade => trade.costBasis ?? 0));
	const laterDeltas = comparisonDeltas(analyzed, 'later');
	const earlierDeltas = comparisonDeltas(analyzed, 'earlier');
	const laterAverage = average(laterDeltas.map(delta => delta.deltaPnl));
	const earlierAverage = average(earlierDeltas.map(delta => delta.deltaPnl));
	const laterAveragePct = average(laterDeltas.map(delta => delta.deltaReturnPct));
	const earlierAveragePct = average(earlierDeltas.map(delta => delta.deltaReturnPct));
	const timing = timingVerdict(earlierAverage, earlierAveragePct, laterAverage, laterAveragePct);

	return {
		tradeCount: trades.length,
		analyzedTradeCount: analyzed.length,
		totalCostBasis,
		actualPnl,
		actualReturnPct: totalCostBasis > 0 ? actualPnl / totalCostBasis : undefined,
		marketPnl: marketComparable.length > 0 ? marketPnl : undefined,
		marketReturnPct: marketBasis > 0 ? marketPnl / marketBasis : undefined,
		beatMarket: marketComparable.length > 0 ? comparableActualPnl > marketPnl : undefined,
		beatMarketBy: marketComparable.length > 0 ? comparableActualPnl - marketPnl : undefined,
		timingVerdict: timing.verdict,
		timingDeltaPnl: timing.deltaPnl,
		timingDeltaReturnPct: timing.deltaReturnPct,
		earlierAverageDeltaPnl: earlierAverage,
		laterAverageDeltaPnl: laterAverage,
	};
}

function buildChart(trades: TradeRow[]) {
	const points: ChartPoint[] = [];
	let basis = 0;
	let actualPnl = 0;
	let marketPnl = 0;

	for (const trade of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
		if (!trade.costBasis || trade.actualPnl === undefined || trade.marketPnl === undefined) continue;
		basis += trade.costBasis;
		actualPnl += trade.actualPnl;
		marketPnl += trade.marketPnl;
		points.push({
			date: trade.date,
			actualReturnPct: actualPnl / basis,
			marketReturnPct: marketPnl / basis,
		});
	}

	return points;
}

function comparisonDeltas(trades: TradeRow[], side: 'earlier' | 'later') {
	return trades.flatMap(trade => Object.values(trade[side]).filter(metric => metric !== null));
}

function timingVerdict(
	earlierAverage?: number,
	earlierAveragePct?: number,
	laterAverage?: number,
	laterAveragePct?: number,
) {
	const earlier = earlierAverage ?? Number.NEGATIVE_INFINITY;
	const later = laterAverage ?? Number.NEGATIVE_INFINITY;
	const best = Math.max(earlier, later);

	if (!Number.isFinite(best)) return { verdict: 'insufficient' as const };
	if (best <= 0) {
		return {
			verdict: 'actual' as const,
			deltaPnl: Math.abs(best),
			deltaReturnPct: Math.abs(best === earlier ? (earlierAveragePct ?? 0) : (laterAveragePct ?? 0)),
		};
	}

	if (later >= earlier) {
		return { verdict: 'later' as const, deltaPnl: laterAverage, deltaReturnPct: laterAveragePct };
	}

	return { verdict: 'earlier' as const, deltaPnl: earlierAverage, deltaReturnPct: earlierAveragePct };
}

function getSelectedSymbols(url: URL, symbols: string[]) {
	if (!url.searchParams.has('symbols')) return symbols;

	const requested = new Set(
		(url.searchParams.get('symbols') ?? '')
			.split(',')
			.map(symbol => symbol.trim().toUpperCase())
			.filter(Boolean),
	);

	return symbols.filter(symbol => requested.has(symbol));
}

function weightedHoldingDays(matches: Match[], sellDate: string, costBasis: number) {
	if (matches.length === 0 || costBasis <= 0) return;

	return sum(matches.map(match => (daysBetween(match.buyDate, sellDate) * match.costBasis) / costBasis));
}

function priceOnOrBefore(history: PricePoint[], date: string) {
	for (let index = history.length - 1; index >= 0; index--) {
		if (history[index].date <= date) return history[index];
	}
}

function priceOnOrAfter(history: PricePoint[], date: string) {
	return history.find(point => point.date >= date);
}

function addMonths(date: string, months: number) {
	const value = new Date(`${date}T00:00:00.000Z`);
	const day = value.getUTCDate();
	value.setUTCMonth(value.getUTCMonth() + months);
	if (value.getUTCDate() !== day) value.setUTCDate(0);
	return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
	return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
}

function parseDate(value: string) {
	const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
	if (!match) return;
	return `${match[3]}-${match[1]}-${match[2]}`;
}

function moneyFrom(value: string) {
	const normalized = value.replace(/[$,]/g, '').trim();
	if (!normalized) return 0;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numberFrom(value: string) {
	const parsed = Number(value.replace(/,/g, '').trim());
	return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
	return values.length === 0 ? undefined : sum(values) / values.length;
}
