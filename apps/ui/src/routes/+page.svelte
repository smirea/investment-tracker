<script lang="ts">
	type Theme = 'dark' | 'light';
	type Status = { ok: boolean; now: string };

	let theme = $state<Theme>('dark');
	let status = $state<Status | undefined>();
	let error = $state<string | undefined>();
	let loading = $state(true);

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.dataset.theme = theme;
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		void ping();
	});

	async function ping() {
		loading = true;
		error = undefined;

		try {
			const response = await fetch('/api/status');
			if (!response.ok) throw new Error(await response.text());
			status = await response.json();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Svelte App</title>
</svelte:head>

<main class="min-h-screen bg-app text-app-ink">
	<section class="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 px-6 py-12">
		<div class="space-y-4">
			<p class="text-sm font-medium text-muted">SvelteKit + Bun</p>
			<h1 class="text-5xl font-semibold tracking-normal text-app-ink">Start here.</h1>
			<p class="max-w-2xl text-lg leading-8 text-muted">
				A tiny Svelte route, Tailwind v4 theme tokens, and a Bun API server are wired together.
			</p>
		</div>

		<div class="flex flex-wrap gap-3">
			<button
				type="button"
				class="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink"
				onclick={() => (theme = theme === 'dark' ? 'light' : 'dark')}
			>
				{theme === 'dark' ? 'Light' : 'Dark'} theme
			</button>
			<button
				type="button"
				class="rounded-md border border-border px-4 py-2 font-medium text-app-ink"
				onclick={() => void ping()}
			>
				Ping server
			</button>
		</div>

		<div class="rounded-md border border-border bg-panel p-4 text-panel-ink">
			<p class="text-sm font-medium text-muted">API</p>
			{#if error}
				<p class="mt-2 text-error">{error}</p>
			{:else if loading}
				<p class="mt-2 text-muted">Checking server...</p>
			{:else if status}
				<p class="mt-2">Server is online.</p>
				<p class="mt-1 text-sm text-muted">{status.now}</p>
			{/if}
		</div>
	</section>
</main>
