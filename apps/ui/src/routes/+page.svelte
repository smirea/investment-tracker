<script lang="ts">
	import { onMount } from 'svelte';
	import createLocalStorage, { type LocalStorage } from '$lib/createLocalStorage';

	type Horizon = { key: string; label: string; months: number };
	type ComparisonMetric = {
		targetDate: string;
		price: number;
		pnl: number;
		returnPct: number;
		deltaPnl: number;
		deltaReturnPct: number;
		taxAmount: number;
		shortTermGain: boolean;
	};
	type TradeRow = {
		id: string;
		date: string;
		symbol: string;
		description: string;
		quantity: number;
		matchedQuantity: number;
		unmatchedQuantity: number;
		soldPrice: number;
		proceeds: number;
		costBasis?: number;
		actualPnl?: number;
		actualReturnPct?: number;
		earliestBuyDate?: string;
		latestBuyDate?: string;
		holdingDays?: number;
		grossActualPnl?: number;
		taxAmount?: number;
		shortTermGain: boolean;
		marketPnl?: number;
		marketReturnPct?: number;
		later: Record<string, ComparisonMetric | null>;
		earlier: Record<string, ComparisonMetric | null>;
	};
	type DashboardSummary = {
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
	type ChartPoint = {
		date: string;
		actualReturnPct: number;
		marketReturnPct: number;
	};
	type CacheStatus = {
		symbol: string;
		status: 'cached' | 'fetched' | 'skipped' | 'error';
		lastFetchAt?: string;
		rowCount: number;
		error?: string;
	};
	type DashboardResponse = {
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
		horizons: Horizon[];
	};
	type DashboardSettings = {
		taxesEnabled: boolean;
		shortTermTaxRate: number;
		longTermTaxRate: number;
	};

	const chartWidth = 900;
	const chartHeight = 320;
	const chartPad = { top: 18, right: 20, bottom: 34, left: 54 };
	const defaultDashboardSettings: DashboardSettings = {
		taxesEnabled: true,
		shortTermTaxRate: 40.8,
		longTermTaxRate: 23.8,
	};

	let dashboard = $state<DashboardResponse | undefined>();
	let selectedSymbols = $state<string[]>([]);
	let taxSettings = $state<DashboardSettings>({ ...defaultDashboardSettings });
	let settingsStorage: LocalStorage<DashboardSettings> | undefined;
	let loading = $state(true);
	let error = $state<string | undefined>();
	let menuOpen = $state(false);

	let unavailableCache = $derived(
		dashboard?.cache.filter(item => item.status === 'error' || item.status === 'skipped') ?? [],
	);
	let selectedLabel = $derived(selectionLabel(dashboard?.symbols ?? [], selectedSymbols));

	onMount(() => {
		document.documentElement.dataset.theme = 'dark';
		settingsStorage = createLocalStorage<DashboardSettings>({
			namespace: 'investment-tracker',
			getDefaults: () => defaultDashboardSettings,
		}).LS;
		taxSettings = settingsStorage.getAll();
		void loadDashboard(undefined, taxSettings);
	});

	async function loadDashboard(nextSymbols?: string[], nextTaxSettings = taxSettings) {
		loading = true;
		error = undefined;

		const params = new URLSearchParams();
		if (nextSymbols) params.set('symbols', nextSymbols.join(','));
		params.set('taxes', nextTaxSettings.taxesEnabled ? '1' : '0');
		params.set('shortTermTaxRate', String(nextTaxSettings.shortTermTaxRate / 100));
		params.set('longTermTaxRate', String(nextTaxSettings.longTermTaxRate / 100));

		try {
			const response = await fetch(`/api/dashboard${params.size ? `?${params}` : ''}`);
			const data = await response.json();
			if (!response.ok || !data.ok) throw new Error(data.error ?? 'Dashboard request failed');

			dashboard = data as DashboardResponse;
			selectedSymbols = dashboard.selectedSymbols;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function setSymbols(symbols: string[]) {
		selectedSymbols = [...symbols].sort();
		void loadDashboard(selectedSymbols);
	}

	function updateTaxSettings(diff: Partial<DashboardSettings>) {
		taxSettings = { ...taxSettings, ...diff };
		settingsStorage?.set(diff);
		void loadDashboard(selectedSymbols, taxSettings);
	}

	function toggleSymbol(symbol: string, checked: boolean) {
		const next = checked
			? [...new Set([...selectedSymbols, symbol])]
			: selectedSymbols.filter(selected => selected !== symbol);
		setSymbols(next);
	}

	function marketTitle(summary: DashboardSummary) {
		if (summary.beatMarket === undefined) return 'Benchmark pending';
		return summary.beatMarket ? 'Beat the S&P 500' : 'Lagged the S&P 500';
	}

	function marketDetail(summary: DashboardSummary) {
		if (summary.beatMarketBy === undefined || summary.marketReturnPct === undefined) {
			return 'Waiting on cached market prices';
		}

		return `${formatMoney(Math.abs(summary.beatMarketBy))} ${summary.beatMarket ? 'ahead' : 'behind'} (${formatPercent(summary.marketReturnPct)} benchmark)`;
	}

	function timingTitle(summary: DashboardSummary) {
		if (summary.timingVerdict === 'later') return 'Later was better';
		if (summary.timingVerdict === 'earlier') return 'Earlier was better';
		if (summary.timingVerdict === 'actual') return 'Actual timing won';
		return 'Timing pending';
	}

	function timingDetail(summary: DashboardSummary) {
		if (summary.timingDeltaPnl === undefined || summary.timingDeltaReturnPct === undefined) {
			return 'Waiting on cached stock prices';
		}

		const prefix = summary.timingVerdict === 'actual' ? 'By' : 'Average edge';
		return `${prefix} ${formatMoney(summary.timingDeltaPnl)} (${formatPercent(summary.timingDeltaReturnPct)})`;
	}

	function selectionLabel(symbols: string[], selected: string[]) {
		if (symbols.length === 0) return 'No stocks';
		if (selected.length === symbols.length) return 'All stocks';
		if (selected.length === 0) return 'No stocks';
		return `${selected.length} stocks`;
	}

	function chartPath(points: ChartPoint[], key: 'actualReturnPct' | 'marketReturnPct') {
		if (points.length === 0) return '';

		const domain = chartDomain(points);
		return points
			.map((point, index) => {
				const command = index === 0 ? 'M' : 'L';
				return `${command} ${xFor(index, points.length)} ${yFor(point[key], domain)}`;
			})
			.join(' ');
	}

	function chartDomain(points: ChartPoint[]) {
		const values = points.flatMap(point => [point.actualReturnPct, point.marketReturnPct, 0]);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const spread = Math.max(max - min, 0.1);
		return { min: min - spread * 0.12, max: max + spread * 0.12 };
	}

	function yTicks(points: ChartPoint[]) {
		const domain = chartDomain(points);
		return [domain.max, (domain.max + domain.min) / 2, domain.min];
	}

	function xFor(index: number, count: number) {
		const width = chartWidth - chartPad.left - chartPad.right;
		if (count <= 1) return chartPad.left + width / 2;
		return chartPad.left + (index / (count - 1)) * width;
	}

	function yFor(value: number, domain: { min: number; max: number }) {
		const height = chartHeight - chartPad.top - chartPad.bottom;
		return chartPad.top + (1 - (value - domain.min) / (domain.max - domain.min)) * height;
	}

	function metricClass(returnPct?: number) {
		if (returnPct === undefined || Math.abs(returnPct) < 0.05) return 'metric neutral';
		return returnPct > 0 ? 'metric good' : 'metric bad';
	}

	function formatMetric(metric: ComparisonMetric | null) {
		if (!metric) return '—';
		return `${formatMoney(metric.pnl)} ${formatPercent(metric.returnPct)}`;
	}

	function formatOutcome(pnl?: number, returnPct?: number) {
		if (pnl === undefined || returnPct === undefined) return '—';
		return `${formatMoney(pnl)} ${formatPercent(returnPct)}`;
	}

	function metricTitle(metric: ComparisonMetric | null) {
		if (!metric) return '';
		return metric.shortTermGain ? `${formatDate(metric.targetDate)} - short term gains` : formatDate(metric.targetDate);
	}

	function shortTermTitle(shortTermGain: boolean) {
		return shortTermGain ? 'short term gains' : '';
	}

	function numberInputValue(value: number, fallback: number) {
		if (!Number.isFinite(value)) return fallback;
		return Math.min(100, Math.max(0, value));
	}

	function formatMoney(value?: number) {
		if (value === undefined) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
		}).format(value);
	}

	function formatPercent(value?: number) {
		if (value === undefined) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'percent',
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		}).format(value);
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
	}

	function formatDate(value?: string) {
		if (!value) return '—';
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
			new Date(`${value}T00:00:00`),
		);
	}

	function buyWindow(trade: TradeRow) {
		if (!trade.earliestBuyDate) return 'Unknown';
		if (trade.earliestBuyDate === trade.latestBuyDate) return formatDate(trade.earliestBuyDate);
		return `${formatDate(trade.earliestBuyDate)} to ${formatDate(trade.latestBuyDate)}`;
	}
</script>

<svelte:head>
	<title>Investment Tracker</title>
</svelte:head>

<main class="dashboard-shell">
	<header class="topbar">
		<div>
			<p class="eyebrow">Investment Tracker</p>
			<h1>Trade dashboard</h1>
		</div>

		<div class="header-controls">
			<div class="tax-controls">
				<label class="tax-toggle">
					<input
						type="checkbox"
						checked={taxSettings.taxesEnabled}
						onchange={event => updateTaxSettings({ taxesEnabled: event.currentTarget.checked })}
					/>
					<span>Taxes</span>
				</label>
				<label class="tax-rate">
					<span>Short term</span>
					<input
						type="number"
						min="0"
						max="100"
						step="0.1"
						value={taxSettings.shortTermTaxRate}
						disabled={!taxSettings.taxesEnabled}
						onchange={event =>
							updateTaxSettings({
								shortTermTaxRate: numberInputValue(
									event.currentTarget.valueAsNumber,
									defaultDashboardSettings.shortTermTaxRate,
								),
							})}
					/>
					<span>%</span>
				</label>
				<label class="tax-rate">
					<span>Long term</span>
					<input
						type="number"
						min="0"
						max="100"
						step="0.1"
						value={taxSettings.longTermTaxRate}
						disabled={!taxSettings.taxesEnabled}
						onchange={event =>
							updateTaxSettings({
								longTermTaxRate: numberInputValue(
									event.currentTarget.valueAsNumber,
									defaultDashboardSettings.longTermTaxRate,
								),
							})}
					/>
					<span>%</span>
				</label>
			</div>

			<div class="filter">
				<button class="filter-button" type="button" onclick={() => (menuOpen = !menuOpen)}>
					<span>{selectedLabel}</span>
					<span aria-hidden="true">v</span>
				</button>
				{#if menuOpen && dashboard}
					<div class="filter-menu">
						<div class="filter-actions">
							<button type="button" onclick={() => setSymbols(dashboard?.symbols ?? [])}>All</button>
							<button type="button" onclick={() => setSymbols([])}>None</button>
						</div>
						{#each dashboard.symbols as symbol}
							<label>
								<input
									type="checkbox"
									checked={selectedSymbols.includes(symbol)}
									onchange={event => toggleSymbol(symbol, event.currentTarget.checked)}
								/>
								<span>{symbol}</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</header>

	{#if error}
		<section class="notice error-panel">{error}</section>
	{:else if !dashboard}
		<section class="notice">Loading dashboard...</section>
	{:else}
		<section class="verdict-grid" aria-busy={loading}>
			<article
				class:positive={dashboard.summary.beatMarket === true}
				class:negative={dashboard.summary.beatMarket === false}
			>
				<span>Market verdict</span>
				<strong>{marketTitle(dashboard.summary)}</strong>
				<p>{marketDetail(dashboard.summary)}</p>
			</article>
			<article
				class:positive={dashboard.summary.timingVerdict === 'actual'}
				class:negative={dashboard.summary.timingVerdict === 'earlier' || dashboard.summary.timingVerdict === 'later'}
			>
				<span>Timing verdict</span>
				<strong>{timingTitle(dashboard.summary)}</strong>
				<p>{timingDetail(dashboard.summary)}</p>
			</article>
			<article>
				<span>Realized outcome</span>
				<strong>{formatMoney(dashboard.summary.actualPnl)}</strong>
				<p>
					{formatPercent(dashboard.summary.actualReturnPct)} across {dashboard.summary.analyzedTradeCount}
					analyzed trades
				</p>
			</article>
		</section>

		<section class="chart-panel">
			<div class="panel-heading">
				<div>
					<h2>Performance vs S&P 500</h2>
					<p>{dashboard.trades.length} sell trades, {dashboard.marketSymbol} benchmark</p>
				</div>
				<div class="legend">
					<span><i class="actual"></i>Trades</span>
					<span><i class="market"></i>S&P 500</span>
				</div>
			</div>

			{#if dashboard.chart.length > 1}
				<svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Trade performance chart">
					{#each yTicks(dashboard.chart) as tick}
						<line
							x1={chartPad.left}
							x2={chartWidth - chartPad.right}
							y1={yFor(tick, chartDomain(dashboard.chart))}
							y2={yFor(tick, chartDomain(dashboard.chart))}
							class="grid-line"
						/>
						<text x="8" y={yFor(tick, chartDomain(dashboard.chart)) + 4}>{formatPercent(tick)}</text>
					{/each}
					<path d={chartPath(dashboard.chart, 'marketReturnPct')} class="market-line" />
					<path d={chartPath(dashboard.chart, 'actualReturnPct')} class="actual-line" />
				</svg>
			{:else}
				<div class="empty-chart">Need cached Alpha Vantage prices for the selected trades.</div>
			{/if}
		</section>

		{#if unavailableCache.length > 0}
			<section class="cache-strip">
				{#each unavailableCache as item}
					<span>{item.symbol}: {item.error ?? item.status}</span>
				{/each}
			</section>
		{/if}

		<section class="table-panel">
			<div class="panel-heading">
				<div>
					<h2>Trade outcomes</h2>
					<p>FIFO cost basis, transfer and cash actions excluded</p>
				</div>
			</div>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Sold</th>
							<th>Stock</th>
							<th>Buy window</th>
							<th class="number">Qty</th>
							<th class="number">Sold price</th>
							<th class="number">Outcome</th>
							{#each dashboard.horizons as horizon}
								<th class="number">+{horizon.label}</th>
							{/each}
							{#each dashboard.horizons as horizon}
								<th class="number">-{horizon.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each dashboard.trades as trade}
							<tr>
								<td>{formatDate(trade.date)}</td>
								<td>
									<strong>{trade.symbol}</strong>
									<span>{trade.description}</span>
								</td>
								<td>
									{buyWindow(trade)}
									{#if trade.unmatchedQuantity > 0}
										<span>{formatNumber(trade.unmatchedQuantity)} unmatched</span>
									{/if}
								</td>
								<td class="number">{formatNumber(trade.quantity)}</td>
								<td class="number">{formatMoney(trade.soldPrice)}</td>
								<td class={metricClass(trade.actualReturnPct)} title={shortTermTitle(trade.shortTermGain)}>
									{formatOutcome(trade.actualPnl, trade.actualReturnPct)}
									{#if trade.shortTermGain}
										<span class="short-term-marker" title="short term gains">💥</span>
									{/if}
								</td>
								{#each dashboard.horizons as horizon}
									{@const metric = trade.later[horizon.key]}
									<td class={metricClass(metric?.returnPct)} title={metricTitle(metric)}>
										{formatMetric(metric)}
										{#if metric?.shortTermGain}
											<span class="short-term-marker" title="short term gains">💥</span>
										{/if}
									</td>
								{/each}
								{#each dashboard.horizons as horizon}
									{@const metric = trade.earlier[horizon.key]}
									<td class={metricClass(metric?.returnPct)} title={metricTitle(metric)}>
										{formatMetric(metric)}
										{#if metric?.shortTermGain}
											<span class="short-term-marker" title="short term gains">💥</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</main>

<style>
	.dashboard-shell {
		min-height: 100vh;
		background: var(--app-bg);
		color: var(--app-text);
		padding: 28px;
	}

	.topbar {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
		max-width: 1520px;
		margin: 0 auto 20px;
	}

	.eyebrow {
		margin: 0 0 6px;
		color: var(--app-muted);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		font-size: clamp(2rem, 5vw, 3.8rem);
		line-height: 1;
		letter-spacing: 0;
	}

	h2 {
		font-size: 1.05rem;
		letter-spacing: 0;
	}

	button {
		cursor: pointer;
	}

	input {
		font: inherit;
	}

	.header-controls {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.tax-controls {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--app-border);
		border-radius: 8px;
		background: var(--app-panel);
		padding: 8px 10px;
	}

	.tax-controls label {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--app-text);
		font-size: 0.86rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.tax-toggle input {
		width: 16px;
		height: 16px;
		margin: 0;
	}

	.tax-rate input {
		width: 64px;
		border: 1px solid var(--app-border);
		border-radius: 6px;
		background: var(--app-bg);
		color: var(--app-text);
		padding: 5px 7px;
		text-align: right;
	}

	.tax-rate input:disabled {
		color: var(--app-muted);
		opacity: 0.65;
	}

	.filter {
		position: relative;
		z-index: 10;
	}

	.filter-button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 160px;
		justify-content: space-between;
		border: 1px solid var(--app-border);
		border-radius: 8px;
		background: var(--app-panel);
		color: var(--app-text);
		padding: 10px 12px;
		font-weight: 700;
	}

	.filter-menu {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		width: 240px;
		max-height: 380px;
		overflow: auto;
		border: 1px solid var(--app-border);
		border-radius: 8px;
		background: var(--app-panel);
		box-shadow: 0 18px 50px rgb(0 0 0 / 30%);
		padding: 8px;
	}

	.filter-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		margin-bottom: 8px;
	}

	.filter-actions button {
		border: 1px solid var(--app-border);
		border-radius: 6px;
		background: transparent;
		color: var(--app-text);
		padding: 7px;
		font-weight: 700;
	}

	.filter-menu label {
		display: flex;
		align-items: center;
		gap: 9px;
		border-radius: 6px;
		padding: 8px;
		font-weight: 700;
	}

	.filter-menu label:hover {
		background: var(--app-panel-strong);
	}

	.verdict-grid,
	.chart-panel,
	.table-panel,
	.notice,
	.cache-strip {
		max-width: 1520px;
		margin-left: auto;
		margin-right: auto;
	}

	.verdict-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin-bottom: 14px;
	}

	.verdict-grid article,
	.chart-panel,
	.table-panel,
	.notice {
		border: 1px solid var(--app-border);
		border-radius: 8px;
		background: var(--app-panel);
	}

	.verdict-grid article {
		min-height: 132px;
		padding: 18px;
		border-top: 4px solid var(--app-border);
	}

	.verdict-grid article.positive {
		border-top-color: var(--app-success);
	}

	.verdict-grid article.negative {
		border-top-color: var(--app-danger);
	}

	.verdict-grid span,
	.panel-heading p,
	td span {
		color: var(--app-muted);
		font-size: 0.82rem;
	}

	.verdict-grid strong {
		display: block;
		margin-top: 14px;
		font-size: 1.45rem;
		line-height: 1.15;
		letter-spacing: 0;
	}

	.verdict-grid p {
		margin-top: 8px;
		color: var(--app-muted);
		line-height: 1.4;
	}

	.chart-panel,
	.table-panel {
		margin-top: 14px;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 18px;
		border-bottom: 1px solid var(--app-border);
	}

	.legend {
		display: flex;
		gap: 16px;
		color: var(--app-muted);
		font-size: 0.86rem;
		font-weight: 700;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}

	.legend i {
		width: 18px;
		height: 3px;
		border-radius: 999px;
	}

	.legend .actual {
		background: var(--app-chart-a);
	}

	.legend .market {
		background: var(--app-chart-b);
	}

	svg {
		display: block;
		width: 100%;
		height: 340px;
	}

	svg text {
		fill: var(--app-muted);
		font-size: 0.76rem;
	}

	.grid-line {
		stroke: var(--app-border);
		stroke-width: 1;
	}

	.actual-line,
	.market-line {
		fill: none;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.actual-line {
		stroke: var(--app-chart-a);
	}

	.market-line {
		stroke: var(--app-chart-b);
	}

	.empty-chart {
		display: grid;
		min-height: 280px;
		place-items: center;
		color: var(--app-muted);
	}

	.cache-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.cache-strip span {
		border: 1px solid var(--app-warning);
		border-radius: 999px;
		color: var(--app-warning);
		padding: 6px 10px;
		font-size: 0.78rem;
	}

	.table-wrap {
		overflow: auto;
		max-height: 70vh;
	}

	table {
		width: 100%;
		min-width: 1320px;
		border-collapse: collapse;
		font-size: 0.88rem;
	}

	th,
	td {
		border-bottom: 1px solid var(--app-border);
		padding: 11px 12px;
		text-align: left;
		vertical-align: top;
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--app-panel-strong);
		color: var(--app-muted);
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	td strong {
		display: block;
		margin-bottom: 2px;
	}

	td span {
		display: block;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.number,
	.metric {
		text-align: right;
	}

	.metric.good {
		color: var(--app-success);
	}

	.metric.bad {
		color: var(--app-danger);
	}

	.metric.neutral {
		color: var(--app-text);
	}

	.short-term-marker {
		display: inline-block;
		max-width: none;
		margin-left: 5px;
		overflow: visible;
		color: inherit;
		vertical-align: middle;
	}

	.notice {
		padding: 22px;
		color: var(--app-muted);
	}

	.error-panel {
		color: var(--app-danger);
	}

	[aria-busy='true'] {
		opacity: 0.68;
	}

	@media (max-width: 900px) {
		.dashboard-shell {
			padding: 18px;
		}

		.topbar {
			flex-direction: column;
		}

		.header-controls {
			width: 100%;
			flex-direction: column;
		}

		.tax-controls {
			width: 100%;
			flex-wrap: wrap;
			align-items: flex-start;
		}

		.filter,
		.filter-button {
			width: 100%;
		}

		.filter-menu {
			left: 0;
			right: auto;
			width: 100%;
		}

		.verdict-grid {
			grid-template-columns: 1fr;
		}

		.panel-heading {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
