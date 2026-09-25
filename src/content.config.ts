import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				/**
				 * Provenance, for review: `amy` = proposed by Amy Andrews in the 2025 Astro redesign,
				 * `hugo` = carried over from the previous Hugo/Docsy amybo.org, `new` = written for this launch.
				 */
				source: z.enum(['amy', 'hugo', 'new']).optional(),
				/** Free-text note when a page mixes sources, e.g. which sections came from where. */
				provenance: z.string().optional(),
				/** Path of the equivalent page on the old Hugo site, e.g. `/docs/overview/`. */
				hugoPath: z.string().optional(),
			}),
		}),
	}),
	/** Talks for events. Add a markdown file per talk; nothing is published until `published: true`. */
	talks: defineCollection({
		loader: glob({ pattern: '**/*.md', base: './src/content/talks' }),
		schema: ({ image }) =>
			z.object({
				event: z.string(),
				title: z.string(),
				speaker: z.string(),
				affiliation: z.string().optional(),
				headshot: image().optional(),
				headshotAlt: z.string().optional(),
				start: z.string().optional(),
				order: z.number().default(0),
				published: z.boolean().default(false),
			}),
	}),
};
