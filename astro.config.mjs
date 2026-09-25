// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import alpinejs from '@astrojs/alpinejs';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://amybo.org',
	trailingSlash: 'ignore',
	// Markdown images (the old Hugo pages) get a srcset for phone-sized screens instead of one full-size file.
	image: { layout: 'constrained' },
	integrations: [
		// Listed before Starlight so it uses this one: keeps the registration-only pages out of the sitemap.
		sitemap({ filter: (page) => !/\/events\/(confirm|manage)\/|\/admin\//.test(page) }),
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
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://amybo.org/og.png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'AMYBO: sustainable protein for all' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://amybo.org/og.png' } },
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#175a00' } },
				{ tag: 'script', attrs: { type: 'application/ld+json' }, content: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'AMYBO', alternateName: 'AMYBO.org', url: 'https://amybo.org/', logo: 'https://amybo.org/og.png', description: 'A non-profit open source protein fermentation community: sustainable protein for all.', sameAs: ['https://github.com/amy-bo', 'https://forum.amybo.org/', 'https://www.youtube.com/@AMYBO'] }) },
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Why AMYBO', slug: 'mission' },
						{ label: 'About', slug: 'about' },
						{ label: 'Contact', slug: 'contact' },
					],
				},
				{ label: 'Projects', autogenerate: { directory: 'projects' } },
				{ label: 'Events', autogenerate: { directory: 'events' } },
				{ label: 'Collaborate', autogenerate: { directory: 'collaborate' } },
				{ label: 'Open experiments', autogenerate: { directory: 'experiments' } },
				{ label: 'Background', autogenerate: { directory: 'background', collapsed: true } },
				{ label: 'Privacy', slug: 'privacy' },
			],
			customCss: ['./src/styles/global.css', './src/styles/amybo.css'],
			components: {
				Hero: './src/components/Hero.astro',
				Header: './src/components/Header.astro',
				Footer: './src/components/Footer.astro',
			},
		}),
		alpinejs(),
	],
	vite: { plugins: [tailwindcss()] },
});
