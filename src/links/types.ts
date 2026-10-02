/** A link-in-bio page at amy.bo/~<handle>: the page, its click redirects and the stats all read this. */
export type IconKey =
	| 'amybo' | 'patreon' | 'youtube' | 'linktree' | 'x' | 'mastodon' | 'zotero' | 'linkedin' | 'github'
	| 'forum' | 'docs' | 'print' | 'person'
	| 'software' | 'camera' | 'water' | 'cv' | 'music' | 'gift' | 'radio' | 'mail' | 'link';

export interface Link {
	/** Stable id used in /~<handle>/go/<slug> and in the stats; never reuse one for a different link. */
	slug: string;
	label: string;
	url: string;
	icon?: IconKey;
	/** Clicks counted elsewhere (e.g. Linktree) before this page existed. */
	seed?: number;
}

export interface LinkPage {
	handle: string;
	name: string;
	bio?: string;
	contactUrl?: string;
	/** Profiles that should verify this page (rel="me"), e.g. Mastodon. */
	rel?: string[];
	sections: { title?: string; links: Link[] }[];
}

export const allLinks = (p: LinkPage): Link[] => p.sections.flatMap((s) => s.links);
