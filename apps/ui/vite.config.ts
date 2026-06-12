import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { env } from 'node:process';
import { defineConfig } from 'vite';

if (!env.UI_URL) throw new Error('UI_URL is not set');
if (!env.UI_PORT) throw new Error('UI_PORT is not set');
if (!env.SERVER_URL) throw new Error('SERVER_URL is not set');

const uiPort = Number(env.UI_PORT);
if (Number.isNaN(uiPort)) throw new Error('UI_PORT must be a valid number');
const uiHost = new URL(env.UI_URL).hostname;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: [uiHost],
		clearScreen: false,
		port: uiPort,
		strictPort: true,
		proxy: {
			'/api': {
				target: env.SERVER_URL,
				changeOrigin: true,
				secure: false,
			},
		},
	},
});
