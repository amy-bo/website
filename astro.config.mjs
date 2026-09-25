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
			locales: { root: { label: 'English', lang: 'en-GB' } },
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
				{ tag: 'script', attrs: { type: 'application/ld+json' }, content: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'AMYBO', alternateName: 'AMYBO.org', url: 'https://amybo.org/', logo: 'https://amybo.org/logo.png', legalName: 'andeye Ltd', description: 'A non-profit open source protein fermentation community: sustainable protein for all.', sameAs: ['https://github.com/amy-bo', 'https://forum.amybo.org/', 'https://www.youtube.com/@AMYBO'] }) },
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
				{
					label: 'Projects',
					items: [
						{ label: 'All projects', slug: 'projects' },
						{ label: 'electroPioreactor', autogenerate: { directory: 'projects/electropioreactor' } },
						{ label: 'CARMA Hub project', slug: 'projects/carma-hub' },
						{ label: 'Growth medium', slug: 'projects/media' },
						{ label: 'Methods', slug: 'projects/methods' },
						{ label: 'Literature', slug: 'projects/literature' },
						{ label: 'PioFlo', autogenerate: { directory: 'projects/pioflo' } },
						{ label: 'Other hardware', autogenerate: { directory: 'projects/other-hardware' } },
						{
							label: 'Past projects',
							collapsed: true,
							items: [
								{ label: 'Overview', slug: 'projects/past' },
								{ label: 'Equipment (2023)', autogenerate: { directory: 'projects/past/equipment' } },
								{ label: 'First experiments (2023 to 2024)', autogenerate: { directory: 'projects/past/experiments' } },
								{ label: 'electroPioreactor (2024 notes)', slug: 'projects/past/electropioreactor-2024' },
								{ label: 'electroPioreactor v0.02 (2024)', slug: 'projects/past/electropioreactor-v0-02' },
								{ label: 'Kickstarting for good', slug: 'projects/past/kickstarting-for-good' },
							],
						},
					],
				},
				{ label: 'Events', autogenerate: { directory: 'events' } },
				{
					label: 'Collaborate',
					items: [
						{ label: 'Get involved', slug: 'collaborate/volunteer' },
						{ label: 'Fund us', slug: 'collaborate/fund_us' },
						{ label: 'Pioreactor', slug: 'collaborate/pioreactor' },
						{ label: 'Safety and legal', autogenerate: { directory: 'collaborate/safety-and-legal' } },
						{ label: 'Contribute to this site', slug: 'collaborate/contribute' },
						{ label: 'Our name and logo', slug: 'collaborate/brand' },
					],
				},
				{
					label: 'Open experiments',
					items: [
						{ label: 'Community experiments', slug: 'experiments/community_experiments' },
						{ label: 'Experimental protocols', slug: 'experiments/protocols' },
						{ label: 'Hardware', slug: 'experiments/hardware' },
						{ label: 'Submit an experiment', slug: 'experiments/submit' },
					],
				},
				{
					label: 'Background',
					collapsed: true,
					items: [
						{ label: 'Overview', slug: 'background' },
						{ label: 'Overview (2023)', slug: 'background/overview' },
						{ label: 'Proteins', autogenerate: { directory: 'background/proteins' } },
						{ label: 'Next steps (2023 plan)', slug: 'background/plan-2023' },
					],
				},
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
