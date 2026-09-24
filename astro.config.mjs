// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import alpinejs from '@astrojs/alpinejs';

// https://astro.build/config
export default defineConfig({
	site: 'https://amybo.org',
	trailingSlash: 'ignore',
	integrations: [
		starlight({
			title: 'AMYBO',
			description: 'AMYBO: a non-profit open source protein fermentation community. Sustainable protein for all.',
			logo: {
				light: './src/assets/amybo.svg',
				dark: './src/assets/amybo_dark.svg',
				replacesTitle: true,
			},
			favicon: '/favicon.svg',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/amy-bo' },
				{ icon: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@AMYBO' },
				{ icon: 'discourse', label: 'Forum', href: 'https://forum.amybo.org/' },
			],
			editLink: {
				baseUrl: 'https://github.com/amy-bo/website/edit/main/',
			},
			lastUpdated: false,
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Why AMYBO', slug: 'mission' },
						{ label: 'About', slug: 'about' },
						{ label: 'Contact', slug: 'contact' },
					],
				},
				{ label: 'Events', autogenerate: { directory: 'events' } },
				{ label: 'Collaborate', autogenerate: { directory: 'collaborate' } },
				{ label: 'Open experiments', autogenerate: { directory: 'experiments' } },
				{ label: 'Docs', autogenerate: { directory: 'docs', collapsed: true } },
				{ label: 'Privacy', slug: 'privacy' },
			],
			customCss: ['./src/styles/global.css', './src/styles/amybo.css'],
			components: {
				Hero: './src/components/Hero.astro',
				Header: './src/components/Header.astro',
			},
		}),
		alpinejs(),
	],
	vite: { plugins: [tailwindcss()] },
});
