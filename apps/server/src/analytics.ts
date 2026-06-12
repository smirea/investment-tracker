import { parse } from 'csv-parse/sync';
import { readdirSync, readFileSync } from 'node:fs';

import {
	canFetchPriceHistory,
	ensurePriceHistory,
	getPriceHistoryReadiness,
	getPriceHistoryRun,
	getPriceHistory,
	type CacheStatus,
	type PriceHistoryReadiness,
	type PriceHistoryRun,
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
const defaultTaxSettings = {
	enabled: true,
	shortTermRate: 0.408,
	longTermRate: 0.238,
};

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

type OptionAction = 'Buy to Open' | 'Sell to Close' | 'Sell to Open' | 'Buy to Close' | 'Expired';
type OptionSide = 'long' | 'short';
type OptionKind = 'call' | 'put';

type OptionTransaction = {
	id: string;
	file: string;
	line: number;
	date: string;
	action: OptionAction;
	symbol: string;
	underlyingSymbol: string;
	description: string;
	quantity: number;
	price: number;
	fees: number;
	amount: number;
	optionKind: OptionKind;
	expirationDate: string;
	strike: number;
};

export type CsvTransactionRow = {
	id: string;
	file: string;
	line: number;
	date?: string;
	rawDate: string;
	action: string;
	symbol: string;
	description: string;
	quantity?: number;
	price?: number;
	fees?: number;
	amount?: number;
	assetType: 'stock' | 'option' | 'cash' | 'transfer' | 'other';
	underlyingSymbol?: string;
	optionKind?: OptionKind;
	expirationDate?: string;
	strike?: number;
	filterSymbol?: string;
	analysis?: TradeRow;
};

type Lot = {
	buyId: string;
	date: string;
	remainingQuantity: number;
	costPerShare: number;
};

type OptionLot = {
	openId: string;
	side: OptionSide;
	date: string;
	remainingQuantity: number;
	amountPerContract: number;
};

type Match = {
	buyId: string;
	buyDate: string;
	quantity: number;
	costBasis: number;
	proceeds?: number;
	returnBasis?: number;
};

type MatchedTrade = {
	id: string;
	assetType: 'stock' | 'option';
	date: string;
	action: string;
	symbol: string;
	underlyingSymbol?: string;
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
	optionSide?: OptionSide;
	optionKind?: OptionKind;
	expirationDate?: string;
	strike?: number;
	matches: Match[];
};

export type ComparisonMetric = {
	targetDate: string;
	price: number;
	pnl: number;
	returnPct: number;
	deltaPnl: number;
	deltaReturnPct: number;
	taxAmount: number;
	shortTermGain: boolean;
};

export type TradeRow = MatchedTrade & {
	grossActualPnl?: number;
	taxAmount?: number;
	shortTermGain: boolean;
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

export type OptionSummary = {
	tradeCount: number;
	analyzedTradeCount: number;
	winners: number;
	losers: number;
	flat: number;
	longTrades: number;
	shortTrades: number;
	callTrades: number;
	putTrades: number;
	totalCostBasis: number;
	grossPnl: number;
	taxAmount: number;
	netPnl: number;
	returnPct?: number;
	winRate?: number;
	positive?: boolean;
};

export type TotalSummary = {
	analyzedTradeCount: number;
	totalCostBasis: number;
	grossPnl: number;
	taxAmount: number;
	netPnl: number;
	returnPct?: number;
	positive?: boolean;
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
	taxes: TaxSettings;
	cache: CacheStatus[];
	summary: DashboardSummary;
	optionSummary: OptionSummary;
	totalSummary: TotalSummary;
	chart: ChartPoint[];
	trades: TradeRow[];
	transactions: CsvTransactionRow[];
	horizons: typeof horizons;
};

export type DashboardStatusResponse = {
	ok: true;
	generatedAt: string;
	csvFiles: string[];
	symbols: string[];
	selectedSymbols: string[];
	marketSymbol: string;
	requiredSymbols: string[];
	priceData: PriceHistoryReadiness[];
	activeFetch?: PriceHistoryRun;
	readyCount: number;
	totalCount: number;
	missingSymbols: string[];
	refreshingSymbols: string[];
	blockedSymbols: PriceHistoryReadiness[];
	tasks: string[];
	done: boolean;
	canFetch: boolean;
};

export type TaxSettings = {
	enabled: boolean;
	shortTermRate: number;
	longTermRate: number;
};

export async function buildDashboard(url: URL): Promise<DashboardResponse> {
	const taxes = getTaxSettings(url);
	const { files, transactions, stockTransactions, optionTransactions } = readTransactions();
	const matchedStockTrades = matchTrades(stockTransactions);
	const matchedOptionTrades = matchOptions(optionTransactions);
	const stockSymbols = [...new Set(matchedStockTrades.map(trade => trade.symbol))].sort();
	const optionSymbols = [...new Set(matchedOptionTrades.map(trade => trade.underlyingSymbol).filter(isDefinedString))];
	const symbols = [...new Set([...stockSymbols, ...optionSymbols])].sort();
	const selectedSymbols = getSelectedSymbols(url, symbols);
	const selectedStockTrades = matchedStockTrades.filter(trade => selectedSymbols.includes(trade.symbol));
	const selectedOptionTrades = matchedOptionTrades.filter(
		trade => trade.underlyingSymbol && selectedSymbols.includes(trade.underlyingSymbol),
	);
	const requiredSymbols = requiredSymbolsFor(selectedSymbols, stockSymbols);
	const cache = await ensurePriceHistory(requiredSymbols);
	const history = getPriceHistory(requiredSymbols);
	const stockTrades = enrichTrades(selectedStockTrades, history, taxes);
	const optionTrades = enrichTrades(selectedOptionTrades, history, taxes);
	const trades = [...stockTrades, ...optionTrades];
	const selectedTransactions = filterCsvTransactions(transactions, selectedSymbols, symbols);

	return {
		ok: true,
		generatedAt: new Date().toISOString(),
		csvFiles: files,
		symbols,
		selectedSymbols,
		marketSymbol,
		taxes,
		cache,
		summary: summarize(stockTrades),
		optionSummary: summarizeOptions(optionTrades),
		totalSummary: summarizeTotal(stockTrades, optionTrades),
		chart: buildChart(stockTrades),
		trades: trades.sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol)),
		transactions: attachAnalysis(selectedTransactions, trades),
		horizons,
	};
}

export function buildDashboardStatus(url: URL): DashboardStatusResponse {
	const { files, stockTransactions, optionTransactions } = readTransactions();
	const matchedStockTrades = matchTrades(stockTransactions);
	const matchedOptionTrades = matchOptions(optionTransactions);
	const stockSymbols = [...new Set(matchedStockTrades.map(trade => trade.symbol))].sort();
	const optionSymbols = [...new Set(matchedOptionTrades.map(trade => trade.underlyingSymbol).filter(isDefinedString))];
	const symbols = [...new Set([...stockSymbols, ...optionSymbols])].sort();
	const selectedSymbols = getSelectedSymbols(url, symbols);
	const requiredSymbols = requiredSymbolsFor(selectedSymbols, stockSymbols);
	const priceData = getPriceHistoryReadiness(requiredSymbols);
	const activeFetch = getPriceHistoryRun(requiredSymbols);
	const missingSymbols = priceData.filter(item => item.state === 'missing').map(item => item.symbol);
	const refreshingSymbols = priceData.filter(item => item.state === 'refreshing').map(item => item.symbol);
	const blockedSymbols = priceData.filter(item => item.state === 'blocked');
	const readyCount = priceData.filter(item => item.state === 'ready').length;
	const tasks = statusTasks({
		activeFetch,
		missingSymbols,
		refreshingSymbols,
		blockedSymbols,
		canFetch: canFetchPriceHistory(),
	});

	return {
		ok: true,
		generatedAt: new Date().toISOString(),
		csvFiles: files,
		symbols,
		selectedSymbols,
		marketSymbol,
		requiredSymbols,
		priceData,
		activeFetch,
		readyCount,
		totalCount: requiredSymbols.length,
		missingSymbols,
		refreshingSymbols,
		blockedSymbols,
		tasks,
		done: tasks.length === 0,
		canFetch: canFetchPriceHistory(),
	};
}

function readTransactions() {
	const files = readdirSync(dataDir)
		.filter(file => file.toLowerCase().endsWith('.csv'))
		.sort();
	const transactions: CsvTransactionRow[] = [];
	const stockTransactions: StockTransaction[] = [];
	const optionTransactions: OptionTransaction[] = [];

	for (const file of files) {
		const rows = parse(readFileSync(new URL(file, dataDir), 'utf8'), {
			bom: true,
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as SchwabRow[];

		rows.forEach((row, index) => {
			transactions.push(toCsvTransaction(row, file, index + 2));

			const stockTransaction = toStockTransaction(row, file, index + 2);
			if (stockTransaction) stockTransactions.push(stockTransaction);

			const optionTransaction = toOptionTransaction(row, file, index + 2);
			if (optionTransaction) optionTransactions.push(optionTransaction);
		});
	}

	return { files, transactions, stockTransactions, optionTransactions };
}

function toCsvTransaction(row: SchwabRow, file: string, line: number): CsvTransactionRow {
	const symbol = row.Symbol.trim().toUpperCase();
	const parsedOption = parseOptionSymbol(row.Symbol.trim());
	const assetType = csvAssetType(row, parsedOption !== undefined);
	const filterSymbol = parsedOption?.underlyingSymbol ?? (assetType === 'stock' && symbol ? symbol : undefined);

	return {
		id: `${file}:${line}`,
		file,
		line,
		date: parseEffectiveDate(row.Date) ?? parseDate(row.Date),
		rawDate: row.Date.trim(),
		action: row.Action.trim(),
		symbol,
		description: row.Description.trim(),
		quantity: optionalNumberFrom(row.Quantity),
		price: optionalMoneyFrom(row.Price),
		fees: optionalMoneyFrom(row['Fees & Comm']),
		amount: optionalMoneyFrom(row.Amount),
		assetType,
		underlyingSymbol: parsedOption?.underlyingSymbol,
		optionKind: parsedOption?.optionKind,
		expirationDate: parsedOption?.expirationDate,
		strike: parsedOption?.strike,
		filterSymbol,
	};
}

function csvAssetType(row: SchwabRow, isOption: boolean): CsvTransactionRow['assetType'] {
	if (isOption) return 'option';

	const action = row.Action.trim();
	const symbol = row.Symbol.trim();
	const description = row.Description.trim();
	if (/transfer/i.test(action) || /^Tfr /i.test(description)) return 'transfer';
	if (!symbol) return 'cash';
	if (/interest|dividend/i.test(action)) return 'cash';
	if (/MONEY INVESTOR|TREASURY MONEY|VALUE ADVANTAGE/i.test(description)) return 'cash';
	if (/CD FDIC|T BILL|TREASURY BILL/i.test(description)) return 'other';
	if (/^[A-Z][A-Z.]{0,8}$/.test(symbol.toUpperCase())) return 'stock';
	return 'other';
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

function toOptionTransaction(row: SchwabRow, file: string, line: number): OptionTransaction | undefined {
	const action = row.Action.trim() as OptionAction;
	if (!isOptionAction(action)) return;

	const parsed = parseOptionSymbol(row.Symbol.trim());
	if (!parsed) return;

	const date = action === 'Expired' ? parseEffectiveDate(row.Date) : parseDate(row.Date);
	const quantity = Math.abs(numberFrom(row.Quantity));
	const price = moneyFrom(row.Price);
	const amount = moneyFrom(row.Amount);
	if (!date || quantity <= 0) return;
	if (action !== 'Expired' && (price < 0 || !Number.isFinite(amount))) return;

	return {
		id: `${file}:${line}`,
		file,
		line,
		date,
		action,
		symbol: row.Symbol.trim().toUpperCase(),
		underlyingSymbol: parsed.underlyingSymbol,
		description: row.Description.trim(),
		quantity,
		price: Number.isFinite(price) ? price : 0,
		fees: moneyFrom(row['Fees & Comm']),
		amount: Number.isFinite(amount) ? amount : 0,
		optionKind: parsed.optionKind,
		expirationDate: parsed.expirationDate,
		strike: parsed.strike,
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
			assetType: 'stock',
			date: transaction.date,
			action: transaction.action,
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

function matchOptions(transactions: OptionTransaction[]) {
	const lots = new Map<string, OptionLot[]>();
	const trades: MatchedTrade[] = [];
	const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || b.line - a.line);

	for (const transaction of ordered) {
		if (transaction.action === 'Buy to Open' || transaction.action === 'Sell to Open') {
			const side = transaction.action === 'Buy to Open' ? 'long' : 'short';
			const openingAmount = Math.abs(transaction.amount);
			(lots.get(transaction.symbol) ?? lots.set(transaction.symbol, []).get(transaction.symbol)!).push({
				openId: transaction.id,
				side,
				date: transaction.date,
				remainingQuantity: transaction.quantity,
				amountPerContract: openingAmount / transaction.quantity,
			});
			continue;
		}

		const symbolLots = lots.get(transaction.symbol) ?? [];
		const closeSide = optionCloseSide(transaction.action);
		const matches: Match[] = [];
		let remaining = transaction.quantity;
		let returnBasis = 0;
		let proceeds = 0;
		let grossPnl = 0;
		let optionSide: OptionSide | undefined;

		while (remaining > 0.000001) {
			const lotIndex = symbolLots.findIndex(lot => !closeSide || lot.side === closeSide);
			if (lotIndex === -1) break;

			const lot = symbolLots[lotIndex];
			const quantity = Math.min(remaining, lot.remainingQuantity);
			const closeFraction = quantity / transaction.quantity;
			const openingAmount = quantity * lot.amountPerContract;
			const closingAmount = transaction.action === 'Buy to Close' ? Math.abs(transaction.amount) * closeFraction : 0;
			const closeProceeds = transaction.action === 'Sell to Close' ? transaction.amount * closeFraction : 0;
			const match =
				lot.side === 'long'
					? {
							buyId: lot.openId,
							buyDate: lot.date,
							quantity,
							costBasis: openingAmount,
							proceeds: closeProceeds,
							returnBasis: openingAmount,
						}
					: {
							buyId: lot.openId,
							buyDate: lot.date,
							quantity,
							costBasis: closingAmount,
							proceeds: openingAmount,
							returnBasis: openingAmount,
						};

			matches.push(match);
			returnBasis += match.returnBasis;
			proceeds += match.proceeds;
			grossPnl += match.proceeds - match.costBasis;
			optionSide ??= lot.side;
			remaining -= quantity;
			lot.remainingQuantity -= quantity;
			if (lot.remainingQuantity <= 0.000001) symbolLots.splice(lotIndex, 1);
		}

		const matchedQuantity = transaction.quantity - remaining;
		const buyDates = matches.map(match => match.buyDate).sort();

		trades.push({
			id: transaction.id,
			assetType: 'option',
			date: transaction.date,
			action: transaction.action,
			symbol: transaction.symbol,
			underlyingSymbol: transaction.underlyingSymbol,
			description: transaction.description,
			quantity: transaction.quantity,
			matchedQuantity,
			unmatchedQuantity: remaining,
			soldPrice: transaction.price,
			proceeds,
			matchedProceeds: matchedQuantity > 0 ? proceeds : undefined,
			costBasis: matchedQuantity > 0 ? returnBasis : undefined,
			actualPnl: matchedQuantity > 0 ? grossPnl : undefined,
			actualReturnPct: matchedQuantity > 0 && returnBasis > 0 ? grossPnl / returnBasis : undefined,
			earliestBuyDate: buyDates[0],
			latestBuyDate: buyDates.at(-1),
			holdingDays: weightedHoldingDays(matches, transaction.date, returnBasis),
			optionSide,
			optionKind: transaction.optionKind,
			expirationDate: transaction.expirationDate,
			strike: transaction.strike,
			matches,
		});
	}

	return trades;
}

function enrichTrades(trades: MatchedTrade[], history: PriceHistory, taxes: TaxSettings) {
	return trades.map(trade => {
		const symbolHistory = history[trade.symbol] ?? [];
		const marketHistory = history[marketSymbol] ?? [];
		const actual = compareActual(trade, taxes);
		const later =
			trade.assetType === 'stock'
				? Object.fromEntries(
						horizons.map(horizon => [
							horizon.key,
							compareHypothetical(trade, symbolHistory, horizon.months, 1, actual, taxes),
						]),
					)
				: emptyComparisons();
		const earlier =
			trade.assetType === 'stock'
				? Object.fromEntries(
						horizons.map(horizon => [
							horizon.key,
							compareHypothetical(trade, symbolHistory, horizon.months, -1, actual, taxes),
						]),
					)
				: emptyComparisons();
		const market = trade.assetType === 'stock' ? compareMarket(trade, marketHistory, taxes) : undefined;

		return {
			...trade,
			grossActualPnl: trade.actualPnl,
			actualPnl: actual?.pnl,
			actualReturnPct: actual?.returnPct,
			taxAmount: actual?.taxAmount,
			shortTermGain: actual?.shortTermGain ?? false,
			marketPnl: market?.pnl,
			marketReturnPct: market?.returnPct,
			later,
			earlier,
		};
	});
}

function emptyComparisons() {
	return Object.fromEntries(horizons.map(horizon => [horizon.key, null]));
}

function compareHypothetical(
	trade: MatchedTrade,
	history: PricePoint[],
	months: number,
	direction: 1 | -1,
	actual: ProfitMetric | undefined,
	taxes: TaxSettings,
): ComparisonMetric | null {
	if (!trade.costBasis || !actual || trade.matchedQuantity <= 0) {
		return null;
	}

	const targetDate = addMonths(trade.date, months * direction);
	if (direction === -1 && trade.latestBuyDate && targetDate <= trade.latestBuyDate) return null;

	const point = direction === 1 ? priceOnOrAfter(history, targetDate) : priceOnOrBefore(history, targetDate);
	if (!point) return null;

	const metric = taxAdjustedMetric(
		trade.matches.map(match => ({
			buyDate: match.buyDate,
			sellDate: point.date,
			costBasis: match.costBasis,
			proceeds: point.adjustedClose * match.quantity,
		})),
		taxes,
	);
	return {
		targetDate: point.date,
		price: point.adjustedClose,
		pnl: metric.pnl,
		returnPct: metric.returnPct,
		deltaPnl: metric.pnl - actual.pnl,
		deltaReturnPct: metric.returnPct - actual.returnPct,
		taxAmount: metric.taxAmount,
		shortTermGain: metric.shortTermGain,
	};
}

function compareActual(trade: MatchedTrade, taxes: TaxSettings) {
	if (!trade.costBasis || trade.matchedProceeds === undefined || trade.matches.length === 0) return;

	if (trade.matches.every(match => match.proceeds !== undefined)) {
		return taxAdjustedMetric(
			trade.matches.map(match => ({
				buyDate: match.buyDate,
				sellDate: trade.date,
				costBasis: match.costBasis,
				proceeds: match.proceeds ?? 0,
				returnBasis: match.returnBasis,
			})),
			taxes,
		);
	}

	const matchedProceeds = trade.matchedProceeds;
	return taxAdjustedMetric(
		trade.matches.map(match => ({
			buyDate: match.buyDate,
			sellDate: trade.date,
			costBasis: match.costBasis,
			proceeds: matchedProceeds * (match.quantity / trade.matchedQuantity),
		})),
		taxes,
	);
}

function compareMarket(trade: MatchedTrade, marketHistory: PricePoint[], taxes: TaxSettings) {
	if (!trade.costBasis || trade.matches.length === 0) return;

	const lines: ProfitLine[] = [];
	for (const match of trade.matches) {
		const buyPoint = priceOnOrBefore(marketHistory, match.buyDate);
		const sellPoint = priceOnOrBefore(marketHistory, trade.date);
		if (!buyPoint || !sellPoint) continue;

		lines.push({
			buyDate: match.buyDate,
			sellDate: trade.date,
			costBasis: match.costBasis,
			proceeds: match.costBasis * (sellPoint.adjustedClose / buyPoint.adjustedClose),
		});
	}

	return lines.length > 0 ? taxAdjustedMetric(lines, taxes) : undefined;
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

function summarizeOptions(trades: TradeRow[]): OptionSummary {
	const optionTrades = trades.filter(trade => trade.assetType === 'option');
	const analyzed = optionTrades.filter(trade => trade.costBasis && trade.actualPnl !== undefined);
	const totalCostBasis = sum(analyzed.map(trade => trade.costBasis ?? 0));
	const netPnl = sum(analyzed.map(trade => trade.actualPnl ?? 0));
	const grossPnl = sum(analyzed.map(trade => trade.grossActualPnl ?? trade.actualPnl ?? 0));
	const taxAmount = sum(analyzed.map(trade => trade.taxAmount ?? 0));
	const winners = analyzed.filter(trade => (trade.actualPnl ?? 0) > 0).length;
	const losers = analyzed.filter(trade => (trade.actualPnl ?? 0) < 0).length;

	return {
		tradeCount: optionTrades.length,
		analyzedTradeCount: analyzed.length,
		winners,
		losers,
		flat: analyzed.length - winners - losers,
		longTrades: analyzed.filter(trade => trade.optionSide === 'long').length,
		shortTrades: analyzed.filter(trade => trade.optionSide === 'short').length,
		callTrades: analyzed.filter(trade => trade.optionKind === 'call').length,
		putTrades: analyzed.filter(trade => trade.optionKind === 'put').length,
		totalCostBasis,
		grossPnl,
		taxAmount,
		netPnl,
		returnPct: totalCostBasis > 0 ? netPnl / totalCostBasis : undefined,
		winRate: analyzed.length > 0 ? winners / analyzed.length : undefined,
		positive: analyzed.length > 0 ? netPnl >= 0 : undefined,
	};
}

function summarizeTotal(stockTrades: TradeRow[], optionTrades: TradeRow[]): TotalSummary {
	const analyzed = [...stockTrades, ...optionTrades].filter(trade => trade.costBasis && trade.actualPnl !== undefined);
	const totalCostBasis = sum(analyzed.map(trade => trade.costBasis ?? 0));
	const netPnl = sum(analyzed.map(trade => trade.actualPnl ?? 0));
	const grossPnl = sum(analyzed.map(trade => trade.grossActualPnl ?? trade.actualPnl ?? 0));
	const taxAmount = sum(analyzed.map(trade => trade.taxAmount ?? 0));

	return {
		analyzedTradeCount: analyzed.length,
		totalCostBasis,
		grossPnl,
		taxAmount,
		netPnl,
		returnPct: totalCostBasis > 0 ? netPnl / totalCostBasis : undefined,
		positive: analyzed.length > 0 ? netPnl >= 0 : undefined,
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

function filterCsvTransactions(rows: CsvTransactionRow[], selectedSymbols: string[], symbols: string[]) {
	if (selectedSymbols.length === symbols.length) return rows;
	return rows.filter(row => row.filterSymbol && selectedSymbols.includes(row.filterSymbol));
}

function attachAnalysis(rows: CsvTransactionRow[], trades: TradeRow[]) {
	const tradeById = new Map(trades.map(trade => [trade.id, trade]));
	return rows.map(row => ({ ...row, analysis: tradeById.get(row.id) }));
}

function requiredSymbolsFor(selectedSymbols: string[], stockSymbols: string[]) {
	const selectedStockSymbols = selectedSymbols.filter(symbol => stockSymbols.includes(symbol));
	return selectedStockSymbols.length > 0 ? [...selectedStockSymbols, marketSymbol] : [marketSymbol];
}

function statusTasks({
	activeFetch,
	missingSymbols,
	refreshingSymbols,
	blockedSymbols,
	canFetch,
}: {
	activeFetch?: PriceHistoryRun;
	missingSymbols: string[];
	refreshingSymbols: string[];
	blockedSymbols: PriceHistoryReadiness[];
	canFetch: boolean;
}) {
	const tasks: string[] = [];

	if (activeFetch?.currentSymbol) {
		tasks.push(`Fetching ${activeFetch.currentSymbol} from Alpha Vantage`);
	}

	const symbolsToFetch = [...new Set([...missingSymbols, ...refreshingSymbols])].filter(
		symbol => symbol !== activeFetch?.currentSymbol,
	);
	if (symbolsToFetch.length > 0) {
		tasks.push(
			canFetch
				? `Fetch ${symbolList(symbolsToFetch)}`
				: `Set ALPHAVANTAGE_KEY before fetching ${symbolList(symbolsToFetch)}`,
		);
	}

	if (blockedSymbols.length > 0) {
		const sample = blockedSymbols[0];
		tasks.push(
			`Resolve ${symbolList(blockedSymbols.map(item => item.symbol))}: ${sample.error ?? sample.status ?? 'cache unavailable'}`,
		);
	}

	if (tasks.length === 0 && activeFetch) {
		tasks.push('Finishing dashboard calculations');
	}

	return tasks;
}

function symbolList(symbols: string[]) {
	if (symbols.length <= 5) return symbols.join(', ');
	return `${symbols.slice(0, 5).join(', ')} and ${symbols.length - 5} more`;
}

function isDefinedString(value: string | undefined): value is string {
	return Boolean(value);
}

function isOptionAction(action: string): action is OptionAction {
	return (
		action === 'Buy to Open' ||
		action === 'Sell to Close' ||
		action === 'Sell to Open' ||
		action === 'Buy to Close' ||
		action === 'Expired'
	);
}

function optionCloseSide(action: OptionAction) {
	if (action === 'Sell to Close') return 'long';
	if (action === 'Buy to Close') return 'short';
}

function parseOptionSymbol(value: string) {
	const match = value
		.trim()
		.toUpperCase()
		.match(/^([A-Z.]+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+(?:\.\d+)?)\s+([CP])$/);
	if (!match) return;

	return {
		underlyingSymbol: match[1],
		expirationDate: parseDate(match[2])!,
		strike: Number(match[3]),
		optionKind: match[4] === 'C' ? ('call' as const) : ('put' as const),
	};
}

type ProfitLine = {
	buyDate: string;
	sellDate: string;
	costBasis: number;
	proceeds: number;
	returnBasis?: number;
};

type ProfitMetric = {
	pnl: number;
	returnPct: number;
	taxAmount: number;
	shortTermGain: boolean;
};

function taxAdjustedMetric(lines: ProfitLine[], taxes: TaxSettings): ProfitMetric {
	const costBasis = sum(lines.map(line => line.returnBasis ?? line.costBasis));
	let pnl = 0;
	let taxAmount = 0;
	let shortTermGain = false;

	for (const line of lines) {
		const grossPnl = line.proceeds - line.costBasis;
		const isShortTerm = isShortTermHolding(line.buyDate, line.sellDate);
		const tax = taxes.enabled && grossPnl > 0 ? grossPnl * (isShortTerm ? taxes.shortTermRate : taxes.longTermRate) : 0;
		pnl += grossPnl - tax;
		taxAmount += tax;
		shortTermGain ||= taxes.enabled && grossPnl > 0 && isShortTerm;
	}

	return {
		pnl,
		returnPct: costBasis > 0 ? pnl / costBasis : 0,
		taxAmount,
		shortTermGain,
	};
}

function getTaxSettings(url: URL): TaxSettings {
	return {
		enabled: parseBoolean(url.searchParams.get('taxes'), defaultTaxSettings.enabled),
		shortTermRate: parseRate(url.searchParams.get('shortTermTaxRate'), defaultTaxSettings.shortTermRate),
		longTermRate: parseRate(url.searchParams.get('longTermTaxRate'), defaultTaxSettings.longTermRate),
	};
}

function parseBoolean(value: string | null, fallback: boolean) {
	if (value === null) return fallback;
	return value !== '0' && value !== 'false';
}

function parseRate(value: string | null, fallback: number) {
	if (value === null) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(1, Math.max(0, parsed));
}

function isShortTermHolding(buyDate: string, sellDate: string) {
	return sellDate <= addMonths(buyDate, 12);
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

function parseEffectiveDate(value: string) {
	const matches = [...value.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
	const match = matches.at(-1);
	if (!match) return;
	return `${match[3]}-${match[1]}-${match[2]}`;
}

function moneyFrom(value: string) {
	const normalized = value.replace(/[$,]/g, '').trim();
	if (!normalized) return 0;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalMoneyFrom(value: string) {
	if (!value.trim()) return;
	const parsed = moneyFrom(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function numberFrom(value: string) {
	const parsed = Number(value.replace(/,/g, '').trim());
	return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberFrom(value: string) {
	if (!value.trim()) return;
	const parsed = numberFrom(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
	return values.length === 0 ? undefined : sum(values) / values.length;
}
