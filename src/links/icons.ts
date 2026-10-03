// Icons for link pages: brand marks (from simple-icons, CC0) and simple line icons. Pages inline only the icons they use.
import brands from './brands.json';

type Brand = { t: string; p: string; h: string };
const BRANDS = brands as Record<string, Brand>;

/** 24×24 stroked line icons for links without a brand mark. */
const LINE: Record<string, [string, string]> = {
	link: ['Link', '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>'],
	globe: ['Website', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'],
	software: ['Software', '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M8 9l-2 2 2 2M16 9l2 2-2 2"/>'],
	camera: ['Photography', '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'],
	water: ['Water', '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>'],
	cv: ['CV', '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>'],
	music: ['Music', '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'],
	gift: ['Gift', '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z"/>'],
	radio: ['Radio', '<path d="M12 12v9M8 21h8"/><circle cx="12" cy="10" r="2"/><path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.5 3.5a9 9 0 0 0 0 13M18.5 3.5a9 9 0 0 1 0 13"/>'],
	list: ['Sign-up list', '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10l1.5 1.5L12.5 9M14 10.5h2M8.5 15l1.5 1.5 2.5-2.5M14 15.5h2"/>'],
	mail: ['Email', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'],
	forum: ['Forum', '<path d="M4 5h12v8H9l-4 3v-3H4z"/><path d="M16 9h4v8h-1v3l-4-3h-4v-4"/>'],
	docs: ['Docs', '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 1h13v-3M8 7h7M8 11h5"/>'],
	print: ['3D printing', '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'],
	person: ['Person', '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'],
	diary: ['Diary', '<path d="M6 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v18M11 8h5M11 12h5"/>'],
	heart: ['Support', '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'],
	folder: ['Group', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
	flask: ['Lab', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>'],
	calendar: ['Event', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
	video: ['Video', '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'],
	shop: ['Shop', '<path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6"/>'],
	people: ['People', '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="16.8" cy="9.2" r="2.6"/><path d="M15.2 14.4A4.8 4.8 0 0 1 21.5 19"/>'],
	stuff: ['Stuff', '<circle cx="7.5" cy="7.5" r="3.5"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><path d="M7.5 13.5l4 7h-8z"/><path d="M16.5 13.2l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z"/>'],
	linkedin: ['LinkedIn', ''],
};

export type IconSpec = { key: string; title: string; svg: string; brand: boolean; hex?: string; logo?: Logo };

/** Real logos, drawn as pictures in a circle. `invert`: flip for dark mode; `cover`: fill the circle. */
export interface Logo {
	src: string;
	/** Flip for dark mode (black-on-white artwork). */
	invert?: boolean;
	/** Fill the whole circle (photographic logos). */
	cover?: boolean;
	/** Circle colour behind the logo. */
	bg?: string;
	/** Logo width as a multiple of the circle's radius (default 1.3). */
	scale?: number;
}
const LOGOS: Record<string, [string, Logo]> = {
	amybo: ['AMYBO', { src: '/link-media/amybo.svg', invert: true, scale: 1.2 }],
	'amybo-dark': ['AMYBO (light on dark)', { src: '/link-media/amybo-dark.svg', bg: '#111a0d', scale: 1.2 }],
	andeye: ['andeye', { src: '/link-media/logo-andeye.png', scale: 1.75 }],
	'andeye-inv': ['andeye (white on blue)', { src: '/link-media/logo-andeye-inv.png', bg: '#4fb6f0', scale: 1.75 }],
	aqueum: ['Aqueum', { src: '/link-media/logo-aqueum-a.jpg', cover: true }],
	'aqueum-q': ['Aqueum q', { src: '/link-media/logo-aqueum-q.jpg', cover: true }],
};

/** The <svg> markup for an icon key, or the link icon when unknown. */
export function icon(key: string): IconSpec {
	const lg = LOGOS[key];
	if (lg) return { key, title: lg[0], brand: true, svg: '', logo: lg[1] };
	const b = BRANDS[key];
	if (b) return { key, title: b.t, brand: true, hex: b.h, svg: `<path d="${b.p}"/>` };
	if (key === 'linkedin')
		return { key, title: 'LinkedIn', brand: true, hex: '0A66C2', svg: '<path d="M3 3h18v18H3z" fill="none"/><text x="12" y="17" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="14" stroke="none" fill="currentColor">in</text>' };
	const l = LINE[key] ?? LINE.link;
	return { key: LINE[key] ? key : 'link', title: l[0], brand: false, svg: l[1] };
}

/** Every icon a person can choose from, for the editor. */
export const ICON_KEYS = [...Object.keys(LOGOS), ...Object.keys(LINE), ...Object.keys(BRANDS)];

const DOMAINS: [RegExp, string][] = [
	[/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
	[/(^|\.)patreon\.com$/, 'patreon'],
	[/^linktr\.ee$/, 'linktree'],
	[/(^|\.)(twitter|x)\.com$/, 'x'],
	[/(^|\.)linkedin\.com$/, 'linkedin'],
	[/(^|\.)github\.com$|\.github\.io$/, 'github'],
	[/(^|\.)gitlab\.com$/, 'gitlab'],
	[/(^|\.)codeberg\.org$/, 'codeberg'],
	[/(^|\.)zotero\.org$/, 'zotero'],
	[/(^|\.)orcid\.org$/, 'orcid'],
	[/(^|\.)researchgate\.net$/, 'researchgate'],
	[/^scholar\.google\./, 'googlescholar'],
	[/(^|\.)instagram\.com$/, 'instagram'],
	[/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'],
	[/(^|\.)tiktok\.com$/, 'tiktok'],
	[/(^|\.)bsky\.app$/, 'bluesky'],
	[/(^|\.)threads\.(net|com)$/, 'threads'],
	[/(^|\.)reddit\.com$/, 'reddit'],
	[/(^|\.)discord\.(gg|com)$/, 'discord'],
	[/(^|\.)whatsapp\.com$|^wa\.me$/, 'whatsapp'],
	[/^t\.me$|(^|\.)telegram\.org$/, 'telegram'],
	[/(^|\.)signal\.(me|org)$/, 'signal'],
	[/(^|\.)twitch\.tv$/, 'twitch'],
	[/(^|\.)spotify\.com$/, 'spotify'],
	[/(^|\.)soundcloud\.com$/, 'soundcloud'],
	[/(^|\.)bandcamp\.com$/, 'bandcamp'],
	[/^music\.apple\.com$/, 'applemusic'],
	[/(^|\.)vimeo\.com$/, 'vimeo'],
	[/(^|\.)flickr\.com$/, 'flickr'],
	[/(^|\.)medium\.com$/, 'medium'],
	[/(^|\.)substack\.com$/, 'substack'],
	[/(^|\.)ko-fi\.com$/, 'kofi'],
	[/(^|\.)buymeacoffee\.com$/, 'buymeacoffee'],
	[/(^|\.)paypal\.(com|me)$/, 'paypal'],
	[/(^|\.)printables\.com$/, 'printables'],
	[/(^|\.)thingiverse\.com$/, 'thingiverse'],
	[/(^|\.)hackaday\.(io|com)$/, 'hackaday'],
	[/(^|\.)pinterest\./, 'pinterest'],
	[/(^|\.)strava\.com$/, 'strava'],
	[/(^|\.)goodreads\.com$/, 'goodreads'],
	[/(^|\.)etsy\.com$/, 'etsy'],
	[/(^|\.)kickstarter\.com$/, 'kickstarter'],
	[/(^|\.)gofundme\.com$/, 'gofundme'],
	[/(^|\.)opencollective\.com$/, 'opencollective'],
	[/(^|\.)liberapay\.com$/, 'liberapay'],
	[/(^|\.)huggingface\.co$/, 'huggingface'],
	[/(^|\.)stackoverflow\.com$/, 'stackoverflow'],
	[/(^|\.)notion\.(so|site)$/, 'notion'],
	[/(^|\.)amybo\.org$|^amy\.bo$/, 'amybo'],
	[/(^|\.)andeye\.(com|photo)$/, 'andeye'],
	[/(^|\.)aqueum\.com$/, 'aqueum'],
	[/(^|\.)list-manage\.com$|(^|\.)mailchi\.mp$|(^|\.)eepurl\.com$/, 'list'],
	[/^forum\./, 'forum'],
	[/^docs\./, 'docs'],
	[/^contact\./, 'mail'],
];

/** A sensible default icon for a URL. */
export function guessIcon(url: string): string {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return 'link';
	}
	if (u.protocol === 'mailto:') return 'mail';
	const host = u.hostname.replace(/^www\./, '').toLowerCase();
	for (const [re, key] of DOMAINS) if (re.test(host)) return key;
	if (/^\/@[\w.]+\/?$/.test(u.pathname)) return 'mastodon';
	return 'globe';
}
