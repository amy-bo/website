// Renders a link page (amy.bo/~name) as one self-contained HTML document: a twisty list, and beside it a map of
// the same links drawn as a static SVG. Nothing moves and no script beyond a ~1 KB loader runs until someone
// touches the map; only then is /link-assets/graph.js fetched and the physics started.
// Shared by the page Function (server) and the editor's live preview (browser), so it has no platform imports.
import { icon } from './icons';
import { type LinkNode, type PageData, byDate, mediaUrl, pagePath, walk } from './model';

export const esc = (s: string) =>
	String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const safeUrl = (u: string) => (/^(https?:|mailto:|\/)/i.test(u.trim()) ? u.trim() : '#');

/** Short text describing where a link goes. */
export function hostLine(url: string): string {
	try {
		const u = new URL(url, 'https://amy.bo');
		if (u.protocol === 'mailto:') return 'Email';
		if (/^contact\./.test(u.hostname)) return 'Contact form';
		const path = u.pathname.replace(/\/$/, '');
		const s = u.hostname.replace(/^www\./, '') + (path.length > 1 ? path : '');
		return s.length > 42 ? `${s.slice(0, 40)}…` : s;
	} catch {
		return '';
	}
}

/** Minimal, safe text formatting for diary entries and support notes: paragraphs, **bold**, *italic*, links. */
export function formatText(text: string): string {
	const inline = (s: string) => {
		const parts: string[] = [];
		const re = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)|(https?:\/\/[^\s<]{1,500}[^\s<.,;:!?)\]'"])|\*\*([^*\n]{1,300})\*\*|\*([^*\n]{1,300})\*/g;
		let last = 0;
		for (const m of s.matchAll(re)) {
			parts.push(esc(s.slice(last, m.index)));
			if (m[1]) parts.push(`<a href="${esc(m[2])}" rel="nofollow ugc noopener">${esc(m[1])}</a>`);
			else if (m[3]) parts.push(`<a href="${esc(m[3])}" rel="nofollow ugc noopener">${esc(hostLine(m[3]) || m[3])}</a>`);
			else if (m[4]) parts.push(`<strong>${esc(m[4])}</strong>`);
			else if (m[5]) parts.push(`<em>${esc(m[5])}</em>`);
			last = (m.index ?? 0) + m[0].length;
		}
		parts.push(esc(s.slice(last)));
		return parts.join('');
	};
	return text
		.trim()
		.split(/\n\s*\n/)
		.filter(Boolean)
		.map((p) => `<p>${p.split('\n').map(inline).join('<br>')}</p>`)
		.join('');
}

const hexLum = (hex: string) => {
	const n = parseInt(hex, 16);
	const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** Inline style giving a brand mark its colour, adjusted so it reads on light and dark tiles. */
function brandStyle(key: string): string {
	const i = icon(key);
	if (!i.brand || !i.hex) return '';
	const lum = hexLum(i.hex);
	const light = lum > 0.55 ? 'var(--ink)' : `#${i.hex}`;
	const dark = lum < 0.12 ? 'var(--ink)' : `#${i.hex}`;
	return ` style="--brand:${light};--brand-d:${dark}"`;
}

const nodeIcon = (n: LinkNode): string => {
	if (n.icon) return n.icon;
	if (n.kind === 'diary') return 'diary';
	if (n.kind === 'support') return 'heart';
	if (n.kind === 'text') return 'text';
	if (n.kind === 'group') {
		// A group wears the icon of its first link, so the map reads at a glance.
		const first = [...walk(n.children)].find((c) => c.kind === 'link');
		return first ? nodeIcon(first) : 'folder';
	}
	return 'link';
};

function sprite(keys: Set<string>): string {
	return [...keys]
		.filter((k) => !icon(k).logo)
		.map((k) => `<symbol id="i-${esc(k)}" viewBox="0 0 24 24">${icon(k).svg}</symbol>`)
		.join('');
}

interface Ctx {
	base: string;
	data: PageData;
	preview: boolean;
	/** Every item's address on this page (its slug), for aliases. */
	slugs: Set<string>;
}

/** Visitors don't see an empty support note or an empty diary; the editor's preview shows everything. */
/** Visitors don't see an empty support note; the editor's preview shows everything. */
const isHidden = (n: LinkNode, ctx: Ctx) => !ctx.preview && n.kind === 'support' && !n.body.trim();

/** The tree as visitors see it: hidden items and empty groups left out, and a group holding a single link shown as
 * that link under the group's name (an "Email" group with one contact form is just "Email"). */
function visible(nodes: LinkNode[], ctx: Ctx): LinkNode[] {
	const out: LinkNode[] = [];
	for (const n of nodes) {
		if (isHidden(n, ctx)) continue;
		if (n.kind === 'diary') {
			const kids = visible(n.children, ctx);
			if (kids.length || ctx.preview) out.push({ ...n, children: kids });
			continue;
		}
		if (n.kind !== 'group') {
			out.push(n);
			continue;
		}
		const kids = visible(n.children, ctx);
		if (!kids.length) continue;
		if (kids.length === 1 && kids[0].kind === 'link') out.push({ ...kids[0], label: n.label, parent_id: n.parent_id });
		else out.push({ ...n, children: kids });
	}
	return out;
}


/** Dates and stars work the same in every group (the diary is just a group like any other): if any of its items
 * have dates, they sort newest first; if any are starred, the starred ones come first and an "All" group holds
 * everything. Groups without either keep their own order. */
function withDiary(nodes: LinkNode[]): LinkNode[] {
	return nodes.map((n) => {
		const children = withDiary(n.children);
		if (n.kind !== 'diary' && n.kind !== 'group') return { ...n, children };
		const entries = children.some((c) => c.day) ? [...children].sort(byDate) : children;
		const highlights = entries.filter((e) => e.highlight);
		if (!highlights.length || highlights.length === entries.length) return { ...n, children: entries };
		const all: LinkNode = {
			id: -2_000_000 - n.id, parent_id: n.id, kind: 'group', slug: `${n.slug}-all`, label: 'All', url: '', icon: 'diary', image: '',
			body: '', seed: 0, position: 0, tint: '', zoom: 1, day: '', highlight: 0, dk_linked: 1, dk_icon: '', dk_tint: '', dk_zoom: 1,
			children: entries.map((e) => ({ ...e, id: -3_000_000 - e.id, parent_id: -2_000_000 - n.id })),
		};
		return { ...n, children: [...highlights, all] };
	});
}

/** Items that open (a group, or a diary with entries). */
const opens = (n: LinkNode) => n.kind === 'group' || (n.kind === 'diary' && n.children.length > 0);

/** A link to an item on this same page (its address, like amy.bo/~martin#socials) is an alias: it carries you to
 * the original rather than away. Returns the original's slug, or ''. */
function aliasOf(n: LinkNode, ctx: Ctx): string {
	if (n.kind !== 'link') return '';
	const m = /^(?:https?:\/\/[^/]+)?(\/~[a-z0-9-]+|\/links)\/?#([a-z0-9-]+)$/i.exec(n.url.trim());
	if (!m || m[1].toLowerCase() !== ctx.base) return '';
	return ctx.slugs.has(m[2]) && m[2] !== n.slug ? m[2] : '';
}

const hrefOf = (n: LinkNode, ctx: Ctx) =>
	aliasOf(n, ctx) ? `#${aliasOf(n, ctx)}` :
	n.kind === 'link' ? (ctx.preview ? safeUrl(n.url) : `${ctx.base}/go/${encodeURIComponent(n.slug)}`) : n.kind === 'diary' ? `${ctx.base}/diary` : '';

// ---- the list: plain text, a twisty for each group ----

/** A title, with its short date after it in a lighter weight if it has one. */
const titled = (n: LinkNode) => `${esc(n.label)}${n.day ? ` <span class="d">${esc(n.day)}</span>` : ''}`;

function renderList(nodes: LinkNode[], ctx: Ctx, level = 'root'): string {
	const tgt = ctx.preview ? ' target="_blank" rel="noopener"' : '';
	// Twisties sharing a name open one at a time (the browser does it), matching the map's one branch at a time.
	const nm = ` name="l-${level}"`;
	return nodes
		.map((n) => {
			if (opens(n))
				return `<li><details${nm}><summary data-n="${n.id}" data-s="${esc(n.slug)}"><span class="tw" aria-hidden="true">&gt;</span>${titled(n)}</summary><ul>${renderList(n.children, ctx, String(n.id))}</ul></details></li>`;
			if (n.kind === 'support' || n.kind === 'text')
				return `<li><details${nm} id="l-note-${n.id}"><summary data-n="${n.id}" data-s="${esc(n.slug)}"><span class="tw" aria-hidden="true">&gt;</span>${titled(n)}</summary><div class="note">${formatText(n.body)}</div></details></li>`;
			const alias = aliasOf(n, ctx);
			return `<li><a data-n="${n.id}" data-s="${esc(n.slug)}" href="${esc(hrefOf(n, ctx))}"${alias ? ' class="alias"' : n.kind === 'link' ? tgt : ''}>${titled(n)}</a></li>`;
		})
		.join('');
}

// ---- the map: purely graphical, laid out once on the server ----

interface GNode {
	id: number;
	slug: string;
	/** For an alias: the slug of the original it carries you to. */
	alias?: string;
	parent: number | null;
	kind: string;
	label: string;
	href: string;
	/** The node's picture, as SVG markup centred on (0, 0), for the live map. */
	pic: string;
	icon: string;
	x: number;
	y: number;
	r: number;
}

const round = (v: number) => Math.round(v * 10) / 10;

/** A radial tree: first-level items evenly round the centre; each group's items fan out beyond it, within its
 * share of the circle. Positions never change, so nothing ever jumps from under a finger. */
function layout(top: LinkNode[]): Map<number, { x: number; y: number; r: number; depth: number }> {
	const pos = new Map<number, { x: number; y: number; r: number; depth: number }>();
	const N = Math.max(top.length, 1);
	const R1 = N <= 5 ? 118 : N <= 8 ? 132 : 150;
	const sector = (2 * Math.PI) / N;
	const radiusFor = (n: LinkNode, depth: number) => (depth === 1 ? (n.kind === 'group' ? 23 : 21) : depth === 2 ? 17 : 15);
	const place = (list: LinkNode[], depth: number, centre: number, ringR: number) => {
		const k = list.length;
		// About 40 px of arc per item, within this branch's share of the circle; a crowded ring moves outwards.
		const R = Math.max(ringR, (k * 40) / (sector * 0.95));
		const spread = Math.min(sector * 0.95, (k * 40) / R);
		// First level: down the page in list order, alternating right and left of the centre.
		// Deeper levels: a fan beyond the parent, its places handed out top to bottom in list order.
		const angles =
			depth === 1
				? list.map((_, i) => {
						const phi = (Math.PI * (i + 0.5)) / k;
						return Math.atan2(-Math.cos(phi), (i % 2 === 0 ? 1 : -1) * Math.sin(phi));
					})
				: list.map((_, i) => centre - spread / 2 + ((i + 0.5) * spread) / k).sort((a, b) => Math.sin(a) - Math.sin(b));
		list.forEach((n, i) => {
			const a = angles[i];
			const rr = depth === 1 ? R1 : R;
			pos.set(n.id, { x: round(Math.cos(a) * rr), y: round(Math.sin(a) * rr), r: radiusFor(n, depth), depth });
			if (n.children.length) place(n.children, depth + 1, a, rr + (depth === 1 ? 100 : 82));
		});
	};
	place(top, 1, 0, R1);
	return pos;
}

/** Colour for a picture: '' keeps its own colours, 'mono' uses the page's ink, '#rrggbb' that colour. */
function tintStyle(key: string, tint: string): string {
	if (tint === 'mono') return ' style="--brand:var(--ink);--brand-d:var(--ink);color:var(--ink)"';
	if (/^#[0-9a-f]{6}$/i.test(tint)) return ` style="--brand:${tint};--brand-d:${tint};color:${tint}"`;
	return brandStyle(key);
}

/** The id of the SVG filter that paints a logo in a single colour, or '' for its own colours. */
const tintFilterId = (tint: string) => (tint === 'mono' ? 'lt-mono' : /^#[0-9a-f]{6}$/i.test(tint) ? `lt-${tint.slice(1).toLowerCase()}` : '');

/** Filters for the single colours the page's logos use. */
function tintFilters(tints: Set<string>): string {
	return [...tints]
		.map((t) => {
			const id = tintFilterId(t);
			if (!id) return '';
			const flood = t === 'mono' ? 'style="flood-color:var(--ink)"' : `flood-color="${t}"`;
			return `<filter id="${id}" color-interpolation-filters="sRGB"><feFlood ${flood}/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
		})
		.join('');
}

/** A node's picture, centred on (x, y). `uid` keeps clip-path ids unique; `zoom` sizes the picture in its circle. */
function iconMarkup(key: string, x: number, y: number, r: number, uid: string | number = '', tint = '', zoom = 1, forDark = false, inline = false): string {
	const i = icon(key);
	const z = Math.min(2.4, Math.max(0.6, zoom || 1));
	if (i.logo) {
		const l = i.logo;
		const bg = l.bg ? `<circle class="bg" cx="${x}" cy="${y}" r="${round(r - 1)}" style="fill:${esc(l.bg)};stroke:none"/>` : '';
		if (l.cover) {
			const s = (r * 2 - 3) * z;
			const id = `c${uid || Math.abs(Math.round(x * 7 + y * 13))}`;
			return `<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="${round(r - 1.5)}"/></clipPath><image href="${esc(l.src)}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${round(s)}" height="${round(s)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
		}
		// Natural proportions, never squeezed: the box is the logo's width, and "meet" keeps its shape. A single
		// colour recolours the logo's shape (its transparent background stays clear).
		const w = r * (l.scale ?? 1.3) * z;
		const single = tintFilterId(tint);
		const cls = !single && l.invert && !forDark ? ' class="inv"' : '';
		return `${bg}<image href="${esc(l.src)}" x="${round(x - w / 2)}" y="${round(y - w / 2)}" width="${round(w)}" height="${round(w)}" preserveAspectRatio="xMidYMid meet"${cls}${single ? ` filter="url(#${single})"` : ''}/>`;
	}
	const s = round(r * 1.05 * z);
	if (inline) return `<svg viewBox="0 0 24 24" class="${i.brand ? 'ib' : 'il'}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${s}" height="${s}"${tintStyle(key, tint)}>${i.svg}</svg>`;
	return `<use href="#i-${esc(key)}" class="${i.brand ? 'ib' : 'il'}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${s}" height="${s}"${tintStyle(key, tint)}/>`;
}

/** A node's picture for both modes: one drawing while light and dark are linked; two (one shown per mode) when not. */
function picture(n: LinkNode, x: number, y: number, r: number, uid: string, inline = false): string {
	// An uploaded picture fills the circle.
	if (n.image) {
		const z = Math.min(2.4, Math.max(0.6, n.zoom || 1));
		const s = round((r * 2 - 3) * z);
		return `<clipPath id="p${uid}"><circle cx="${x}" cy="${y}" r="${round(r - 1.5)}"/></clipPath><image href="${esc(mediaUrl(n.image))}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#p${uid})"/>`;
	}
	const light = iconMarkup(nodeIcon(n), x, y, r, uid, n.tint, n.zoom, false, inline);
	if (n.dk_linked !== 0) return light;
	const dark = iconMarkup(n.dk_icon || nodeIcon(n), x, y, r, `${uid}d`, n.dk_tint, n.dk_zoom, true, inline);
	return `<g class="lt">${light}</g><g class="dk">${dark}</g>`;
}

/** One item's picture drawn exactly as the page draws it (same colours for light and dark, logo inversion, separate
 * dark pictures), in a self-contained SVG for the editor. Its styles are TILE_CSS. */
export function tileSvg(n: Pick<LinkNode, 'kind' | 'icon' | 'image' | 'tint' | 'zoom' | 'dk_linked' | 'dk_icon' | 'dk_tint' | 'dk_zoom'> & { children?: LinkNode[] }, uid: string, ring = true): string {
	const node = { label: '', children: [], ...n } as unknown as LinkNode;
	const filters = tintFilters(new Set([n.tint, n.dk_linked === 0 ? n.dk_tint : ''].filter((t) => t && icon(nodeIcon(node)).logo)));
	return `<svg class="l-tile" viewBox="-24 -24 48 48" aria-hidden="true">${filters ? `<defs>${filters}</defs>` : ''}${ring ? '<circle class="tn" r="22.5"/>' : ''}${picture(node, 0, 0, 22, uid, true)}</svg>`;
}
export const TILE_CSS = `.l-tile{width:100%;height:100%;display:block;overflow:visible}
.l-tile .tn{fill:var(--node,#fff);stroke:var(--line);stroke-width:1.5}
.l-tile svg{color:var(--accent-ink)}
.l-tile svg.ib{fill:var(--brand,currentColor)}
.l-tile svg.il{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.l-tile .dk{display:none}
[data-tint] .l-tile{--accent-ink:var(--ti)}
@media (prefers-color-scheme:dark){[data-tint] .l-tile{--accent-ink:var(--tid)}}
@media (prefers-color-scheme:dark){.l-tile svg.ib{fill:var(--brand-d,currentColor)}.l-tile .inv{filter:invert(1) hue-rotate(180deg) brightness(1.15)}.l-tile .lt{display:none}.l-tile .dk{display:inline}}`;

/** Small dots on the far side of a group from its parent, one per item it holds: groups open, everything else is
 * a link. `angle` points away from the parent (radians); the live map turns the arc as the group moves. With many
 * items the arc widens up to a half circle and the dots get smaller to fit. */
function halo(n: LinkNode, x: number, y: number, r: number, angle = 0): string {
	if (!opens(n)) return '';
	const k = n.children.length;
	const ring = r + 8;
	const step = k > 1 ? Math.min(0.42, Math.PI / (k - 1)) : 0;
	const dot = round(Math.max(1.2, Math.min(3.4, (step || 1) * ring * 0.36)));
	const dots = n.children
		.map((c, i) => {
			const a = angle + (i - (k - 1) / 2) * step;
			return `<circle data-d="${c.id}" cx="${round(x + Math.cos(a) * ring)}" cy="${round(y + Math.sin(a) * ring)}" r="${dot}"/>`;
		})
		.join('');
	return `<g class="halo" aria-hidden="true">${dots}</g>`;
}

function graphData(roots: LinkNode[], ctx: Ctx) {
	const pos = layout(roots);
	const nodes: GNode[] = [];
	const visit = (list: LinkNode[], parent: number | null) =>
		list.forEach((n) => {
			const p = pos.get(n.id)!;
			nodes.push({ id: n.id, slug: n.slug, alias: aliasOf(n, ctx) || undefined, parent, kind: opens(n) ? 'group' : n.kind, label: n.day ? `${n.label} ${n.day}` : n.label, href: hrefOf(n, ctx), pic: picture(n, 0, 0, p.r, `l${n.id}`) + halo(n, 0, 0, p.r), icon: nodeIcon(n), x: p.x, y: p.y, r: p.r });
			visit(n.children, n.id);
		});
	visit(roots, null);
	// The view fits every item the map can show, so it never zooms or pans as groups open.
	const ext = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y) + n.r)) + 14;
	const view: [number, number, number, number] = [-ext, -ext, ext * 2, ext * 2].map(round) as [number, number, number, number];

	const tgt = ctx.preview ? ' target="_blank" rel="noopener"' : '';
	const edges: string[] = [];
	const items: string[] = [];
	for (const n of roots) {
		const p = pos.get(n.id)!;
		edges.push(`<line data-e="${n.id}" x1="0" y1="0" x2="${p.x}" y2="${p.y}"/>`);
		const body = `<title>${esc(n.label)}</title><circle cx="${p.x}" cy="${p.y}" r="${p.r}"/>${picture(n, p.x, p.y, p.r, `s${n.id}`)}${halo(n, p.x, p.y, p.r, Math.atan2(p.y, p.x))}`;
		const href = hrefOf(n, ctx);
		// Groups open, notes show their text: both are buttons. Links and the diary are plain links.
		items.push(
			opens(n) || n.kind === 'text' || n.kind === 'support'
				? `<g class="n l-${opens(n) ? 'group' : n.kind}" data-g="${n.id}" tabindex="0" role="button"${opens(n) ? ' aria-expanded="false"' : ''} aria-label="${esc(n.label)}">${body}</g>`
				: `<a class="n l-${n.kind}" data-g="${n.id}" href="${esc(href)}" aria-label="${esc(n.label)}"${n.kind === 'link' ? tgt : ''}>${body}</a>`,
		);
	}
	const p = ctx.data.person;
	const hubDark = p.hub_dk_linked === 0 ? iconMarkup(p.hub_dk_icon || p.hub_icon || 'person', 0, 0, 42, 'hubd', p.hub_dk_tint, p.hub_dk_zoom, true) : '';
	const hubPic = (light: string) => (hubDark ? `<g class="lt">${light}</g><g class="dk">${hubDark}</g>` : light);
	const hub = p.hub_icon
		? `<circle class="hub" r="42"/>${hubPic(iconMarkup(p.hub_icon, 0, 0, 42, 'hub', p.hub_tint, p.hub_zoom))}`
		: p.kind === 'org'
			? `<circle class="hub" r="42"/>${hubPic(`<image href="${esc(mediaUrl(p.photo))}" x="${round(-30 * p.hub_zoom)}" y="${round(-21 * p.hub_zoom)}" width="${round(60 * p.hub_zoom)}" height="${round(42 * p.hub_zoom)}" class="inv" preserveAspectRatio="xMidYMid meet"/>`)}`
			: p.photo
				? `<circle class="hub" r="44"/>${hubPic(`<clipPath id="hubc"><circle r="42"/></clipPath><image href="${esc(mediaUrl(p.photo))}" x="${round(-42 * p.hub_zoom)}" y="${round(-42 * p.hub_zoom)}" width="${round(84 * p.hub_zoom)}" height="${round(84 * p.hub_zoom)}" clip-path="url(#hubc)" preserveAspectRatio="xMidYMid slice"/>`)}`
				: `<circle class="hub" r="42"/><text class="initials" y="10">${esc(initials(p.name))}</text>`;
	const svg = `<g class="edges">${edges.join('')}</g><g class="nodes">${items.join('')}</g><g class="hubg" data-g="0" role="button" tabindex="0" aria-label="${esc(p.name)}"><title>${esc(p.name)}</title>${hub}</g>`;
	return { nodes, svg, view };
}

/** Hovering an item in the list lights up its place on the map, and the other way round. Pure CSS (:has), so it
 * costs nothing until someone points at something. */
function linkStyles(roots: LinkNode[]): string {
	const rules: string[] = [];
	const visit = (list: LinkNode[], chain: number[]) =>
		list.forEach((n) => {
			const ids = [n.id, ...chain];
			rules.push(
				`.lp:has([data-n="${n.id}"]:is(:hover,:focus-visible)) :is(${ids.map((i) => `[data-g="${i}"]`).join(',')})>circle{stroke:var(--accent);stroke-width:3}` +
					`.lp:has([data-g="${n.id}"]:is(:hover,:focus-visible)) :is(${ids.map((i) => `[data-n="${i}"]`).join(',')}){color:var(--accent-ink)}` +
					`.lp:has([data-n="${n.id}"]:is(:hover,:focus-visible)) :is(${ids.map((i) => `[data-d="${i}"]`).join(',')}){fill:var(--accent);opacity:1}`,
			);
			visit(n.children, ids);
		});
	visit(roots, []);
	return rules.join('');
}

/** A colour mixed towards black or white, for tints that read on light and dark pages. */
function mix(hex: string, to: number, t: number): string {
	const n = parseInt(hex.slice(1), 16);
	const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t));
	return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The page's own tint, if it has one: inline variables the stylesheet picks up for light and dark. */
/** The page tint's colours for light and dark (null for AMYBO green). */
export function tintProps(accent: string): Record<string, string> | null {
	if (!/^#[0-9a-f]{6}$/i.test(accent)) return null;
	return { '--t': accent, '--ti': mix(accent, 0, 0.35), '--td': mix(accent, 255, 0.2), '--tid': mix(accent, 255, 0.45) };
}
function tintVars(accent: string): string {
	const t = tintProps(accent);
	return t ? ` data-tint style="${Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';')}"` : '';
}

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => w[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();

// ---- document ----

export interface RenderOptions {
	/** Absolute canonical origin for the page, e.g. https://amy.bo */
	origin?: string;
	/** Editor live preview: links go straight to their targets and nothing is counted. */
	preview?: boolean;
}

function head(title: string, description: string, canonical: string, extra = ''): string {
	return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f8f4" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b1208" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="profile">
<link rel="canonical" href="${esc(canonical)}"><link rel="icon" href="/favicon.svg">${extra}<style>${CSS}</style></head>`;
}

const FOOT = `<footer class="foot"><a href="https://amybo.org/">AMYBO</a> · clicks are counted, nothing about you is stored · <a href="https://amybo.org/privacy/">Privacy</a></footer>`;

export function renderPage(data: PageData, opts: RenderOptions = {}): string {
	const p = data.person;
	const base = pagePath(p.handle);
	const ctx: Ctx = { base, data, preview: !!opts.preview, slugs: new Set([...walk(data.roots)].map((n) => n.slug)) };
	const canonical = `${opts.origin ?? 'https://amy.bo'}${base}`;
	const roots = visible(withDiary(data.roots), ctx);
	const description = p.bio || `${p.name}: links.`;
	const relMe = [...walk(data.roots)]
		.filter((n) => n.kind === 'link' && n.icon === 'mastodon')
		.map((n) => `<link rel="me" href="${esc(n.url)}">`)
		.join('');
	const g = !p.basic_mode && roots.length ? graphData(roots, ctx) : null;
	const darkKeys = [...walk(roots)].filter((n) => n.dk_linked === 0 && n.dk_icon).map((n) => n.dk_icon);
	const keys = new Set<string>(g ? [...g.nodes.map((n) => n.icon), ...darkKeys, ...(p.hub_icon ? [p.hub_icon] : []), ...(p.hub_dk_linked === 0 ? [p.hub_dk_icon || p.hub_icon || 'person'] : [])] : []);
	const logoTints = new Set<string>([...walk(roots)].filter((n) => icon(nodeIcon(n)).logo && n.tint).map((n) => n.tint));
	if (p.hub_icon && icon(p.hub_icon).logo && p.hub_tint) logoTints.add(p.hub_tint);
	for (const n of walk(roots)) if (n.dk_linked === 0 && n.dk_tint && icon(n.dk_icon || nodeIcon(n)).logo) logoTints.add(n.dk_tint);
	if (p.hub_dk_linked === 0 && p.hub_dk_tint) logoTints.add(p.hub_dk_tint);

	// With the map, its centre is the portrait; without it, the portrait (or logo) heads the list.
	const portrait = g
		? ''
		: p.kind === 'org'
			? `<img class="logo inv" src="${esc(mediaUrl(p.photo))}" alt="" width="160" height="111">`
			: p.photo
				? `<img class="avatar" src="${esc(mediaUrl(p.photo))}" alt="" width="104" height="104">`
				: '';

	const map = g
		? `<aside class="map" aria-label="Map of these links">
<svg class="mapsvg" viewBox="${g.view.join(' ')}">${g.svg}</svg>
<button type="button" class="back" aria-label="Back to the list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg></button>
</aside>
<script type="application/json" id="l-data">${JSON.stringify({ nodes: g.nodes, preview: ctx.preview }).replace(/</g, '\\u003c')}</script>`
		: '';

	return `${head(p.name, description, canonical, relMe)}
<body class="lp${g ? ' has-map' : ''}"${tintVars(p.accent)}>${keys.size ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${sprite(keys)}${tintFilters(logoTints)}</defs></svg>` : ''}
<div class="shell">
<main class="list">
<header class="top">${portrait}<h1>${esc(p.name)}</h1>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</header>
<nav aria-label="Links"><ul class="tree">${renderList(roots, ctx)}</ul></nav>
</main>
${map}
</div>
${FOOT}
${g ? `<style>${linkStyles(roots)}</style>` : ''}
<script>${BOOT}</script>
</body></html>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A short date in words: 260822 is 22 August 2026, 2608 is August 2026, 26 is 2026. */
const shortDay = (d: string) => {
	const y = `20${d.slice(0, 2)}`;
	const m = MONTHS[Number(d.slice(2, 4)) - 1];
	if (d.length === 2 || !m) return y;
	return d.length === 4 ? `${m} ${y}` : `${Number(d.slice(4, 6))} ${m} ${y}`;
};

const fmtDay = (d: string) => {
	const t = new Date(`${d}T12:00:00Z`);
	return Number.isNaN(+t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function renderDiary(data: PageData, entries: LinkNode[], view: 'all' | 'highlights', opts: RenderOptions = {}): string {
	const p = data.person;
	const base = pagePath(p.handle);
	const canonical = `${opts.origin ?? 'https://amy.bo'}${base}/diary`;
	const diaryNode = [...walk(data.roots)].find((n) => n.kind === 'diary');
	const title = `${diaryNode?.label || 'Diary'} · ${p.name}`;
	const seg = (v: 'all' | 'highlights', label: string) => (view === v ? `<span aria-current="page">${label}</span>` : `<a href="${base}/diary?view=${v}">${label}</a>`);
	const heading = (e: LinkNode) =>
		e.kind === 'link' ? `<a href="${base}/go/${encodeURIComponent(e.slug)}">${esc(e.label)}</a>` : esc(e.label);
	const list = entries.length
		? entries
				.map(
					(e) =>
						`<article class="entry"><p class="day">${e.day ? `<time>${esc(shortDay(e.day))}</time>` : ''}${e.highlight ? ' <span class="star" aria-label="Highlight">★</span>' : ''}</p><h2>${heading(e)}</h2>${formatText(e.body)}</article>`,
				)
				.join('')
		: `<p class="empty">${view === 'highlights' ? 'No highlights yet.' : 'No entries yet.'}</p>`;
	return `${head(title, `${p.name}'s ${diaryNode?.label || 'diary'}`, canonical)}
<body class="lp diary"${tintVars(p.accent)}><div class="shell"><main class="list">
<header class="top"><p class="crumb"><a href="${base}">${esc(p.name)}</a></p><h1>${esc(diaryNode?.label || 'Diary')}</h1>
${data.highlightCount ? `<p class="seg">${seg('highlights', 'Highlights')} · ${seg('all', 'All entries')}</p>` : ''}</header>
${list}
</main></div>
${FOOT}
</body></html>`;
}

/** Loader: on the first touch, hover or keypress on the map, fetch the physics and hand over. ~1 KB. */
/** The map's only script until it is used: a click (or Enter) on a group, or any tap on a phone, fetches
 * /link-assets/graph.js. Links on the map are plain links and work without it. */
export const BOOT = `(()=>{const b=document.body,m=document.querySelector('.map');let go;const rm=matchMedia('(prefers-reduced-motion: reduce)').matches;const vt=f=>document.startViewTransition&&!rm?document.startViewTransition(f):f();const small=()=>matchMedia('(max-width: 56rem)').matches;const load=()=>m?(go=go||import('/link-assets/graph.js').then(g=>g.start(m))):Promise.resolve(null);const show=s=>{const t=document.querySelector('.tree [data-s="'+CSS.escape(s)+'"]');if(!t)return;for(let d=t.closest('details');d;d=d.parentElement.closest('details'))d.open=true;if(t.tagName==='SUMMARY')t.parentElement.open=true;t.scrollIntoView({block:'nearest',behavior:rm?'auto':'smooth'});t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash');const n=+t.dataset.n;if(m&&!small())load().then(x=>x&&x.goto(n))};const fromHash=()=>{const s=decodeURIComponent(location.hash.slice(1));if(s)show(s)};addEventListener('hashchange',fromHash);if(location.hash)fromHash();addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();e.shiftKey?history.forward():history.back()}});if(!m)return;const act=(e,g)=>{e.preventDefault();load().then(x=>x.tap(+g.dataset.g))};m.addEventListener('click',e=>{if(small()&&!b.classList.contains('map-on')){e.preventDefault();vt(()=>b.classList.add('map-on'));load();return}const g=e.target.closest('g[data-g]');if(g)act(e,g)});m.addEventListener('pointerdown',e=>{if(small()&&!b.classList.contains('map-on'))return;const n=e.target.closest('[data-g]');if(n)load().then(x=>x.grab(e,+n.dataset.g))});m.addEventListener('keydown',e=>{const g=e.target.closest&&e.target.closest('g[data-g]');if(g&&(e.key==='Enter'||e.key===' '))act(e,g)});const off=()=>{if(b.classList.contains('map-on'))vt(()=>b.classList.remove('map-on'))};m.querySelector('.back').addEventListener('click',e=>{e.stopPropagation();off()});addEventListener('keydown',e=>{if(e.key==='Escape')off()})})();`;

const CSS = `
:root{--bg:#f6f8f4;--ink:#16210f;--muted:#66745f;--line:#d8e2cf;--accent:#3f9c00;--accent-ink:#1d6b00;--node:#fff;--ease:cubic-bezier(.2,.8,.2,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0b1208;--ink:#e6f0df;--muted:#97a88e;--line:#24361d;--accent:#87bd25;--accent-ink:#b7e27c;--node:#142010}.inv{filter:invert(1) hue-rotate(180deg) brightness(1.15)}}
[data-tint]{--accent:var(--t);--accent-ink:var(--ti)}
.mapsvg .dk{display:none}
@media (prefers-color-scheme:dark){.mapsvg .lt{display:none}.mapsvg .dk{display:inline}}
@media (prefers-color-scheme:dark){[data-tint]{--accent:var(--td);--accent-ink:var(--tid)}}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;font:18px/1.5 -apple-system,system-ui,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit}
.shell{flex:1;width:100%;max-width:72rem;margin:0 auto;padding:max(3.5rem,env(safe-area-inset-top)) 1.5rem 3rem;display:grid;grid-template-columns:minmax(0,30rem);justify-content:center;gap:4rem}
.has-map .shell{grid-template-columns:minmax(0,26rem) minmax(0,1fr);align-items:start}
.top{margin-bottom:2rem}
.avatar{display:block;width:6rem;height:6rem;border-radius:50%;object-fit:cover;margin-bottom:1.2rem}
.logo{display:block;width:9rem;height:auto;margin-bottom:1.2rem}
h1{font-size:2rem;line-height:1.15;margin:0;font-weight:650;letter-spacing:-.02em}
.bio{margin:.7rem 0 0;color:var(--muted);font-size:1rem;text-wrap:pretty}
/* the list: words only, a > for each group */
.tree,.tree ul{list-style:none;margin:0;padding:0}
.tree ul{padding-left:1.15em}
.tree a,.tree summary{display:block;padding:.28em 0;text-decoration:none;cursor:pointer;transition:color .15s}
.tree>li>a{padding-left:1.15em}
.tree ul>li>a{padding-left:1.15em}
.tree a:hover,.tree summary:hover{color:var(--accent-ink)}
.tree a:focus-visible,.tree summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
summary{list-style:none;-webkit-tap-highlight-color:transparent}
summary::-webkit-details-marker{display:none}
.tw{display:inline-block;width:1.15em;transition:transform .25s var(--ease);transform-origin:.3em 55%}
details[open]>summary .tw{transform:rotate(90deg)}
.tree .alias::after{content:" ↩";color:var(--muted);font-weight:300}
.tree .flash{animation:flash 1.2s ease-out}
@keyframes flash{0%,30%{color:var(--accent-ink);background:color-mix(in srgb,var(--accent) 14%,transparent)}}
.tree .d{font-weight:300;color:var(--muted);font-variant-numeric:tabular-nums;letter-spacing:.02em;margin-left:.15em}
.note{padding:.2em 0 .6em 1.15em;color:var(--muted);font-size:.95em}
.note p,.entry p{margin:0 0 .6em}
.note a,.entry a{color:var(--accent-ink);text-underline-offset:2px}
@supports (interpolate-size:allow-keywords){:root{interpolate-size:allow-keywords}details::details-content{block-size:0;overflow:clip;transition:block-size .3s var(--ease),content-visibility .3s allow-discrete}details[open]::details-content{block-size:auto}}
.foot{text-align:center;font-size:.75rem;color:var(--muted);padding:1.5rem 1rem max(1.2rem,env(safe-area-inset-bottom))}
.foot a{color:inherit}
/* the map: pictures only */
.map{position:sticky;top:2rem;aspect-ratio:1;max-height:calc(100vh - 4rem);width:100%;justify-self:center}
.mapsvg{display:block;width:100%;height:100%;overflow:visible}
.mapsvg .edges line{stroke:var(--line);stroke-width:1.5}
.l-card{position:absolute;left:0;top:0;z-index:5;max-width:min(18rem,80%);padding:.7rem .9rem;border-radius:14px;background:var(--node);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 24px rgb(0 0 0/12%);font-size:.92rem;line-height:1.45}
.l-card-h{margin:0 0 .3rem;font-weight:600}
.l-card p{margin:.3rem 0}
.mapsvg .n.flash>circle{animation:nflash 1.2s ease-out}
@keyframes nflash{0%,40%{stroke:var(--accent);stroke-width:5}}
.mapsvg .halo circle{fill:var(--muted);opacity:.6;stroke:none}
.mapsvg .n.open .halo{display:none}
.mapsvg.live .n,.mapsvg.live .hubg{cursor:grab}
.mapsvg.dragging,.mapsvg.dragging .n,.mapsvg.dragging .hubg{cursor:grabbing}
.mapsvg .hub{fill:var(--node);stroke:var(--line);stroke-width:1.5}
.mapsvg .initials{font-size:28px;font-weight:650;text-anchor:middle;fill:var(--accent-ink)}
.mapsvg .n,.mapsvg .hubg{cursor:pointer;outline:none}
.mapsvg circle{vector-effect:non-scaling-stroke}
.mapsvg.live{touch-action:none}
.mapsvg .edges line{transition:opacity .3s}
.mapsvg .n>circle{fill:var(--node);stroke:var(--line);stroke-width:1.5;transition:stroke .15s,stroke-width .15s}
.mapsvg .n.l-group>circle{stroke:color-mix(in srgb,var(--accent) 40%,var(--line))}
.mapsvg .n:hover>circle,.mapsvg .n:focus-visible>circle,.mapsvg .n.open>circle{stroke:var(--accent);stroke-width:3}
.mapsvg use{color:var(--accent-ink)}
svg.ib,use.ib{fill:var(--brand,currentColor)}
svg.il,use.il{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-color-scheme:dark){use.ib{fill:var(--brand-d,currentColor)}}
.back{display:none}
@media (max-width:56rem){
.has-map .shell{grid-template-columns:minmax(0,30rem);gap:1rem;padding-top:max(1.2rem,env(safe-area-inset-top))}
.has-map .map{position:relative;top:0;order:-1;max-height:none;width:min(100%,24rem);margin:-14% auto -12%;cursor:zoom-in}
.map-on .map{position:fixed;inset:0;max-height:none;width:auto;margin:0;aspect-ratio:auto;z-index:5;background:var(--bg);cursor:default;padding:4.5rem 1rem 1rem}
.map-on .list,.map-on .foot{visibility:hidden}
.map-on .back{display:grid;place-items:center;position:fixed;top:max(1rem,env(safe-area-inset-top));left:1rem;width:2.75rem;height:2.75rem;border-radius:50%;border:1px solid var(--line);background:var(--node);color:var(--ink);cursor:pointer;view-transition-name:l-list}
.back svg{width:1.2rem;height:1.2rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.map-on .list{view-transition-name:none}
.list{view-transition-name:l-list}
}
::view-transition-group(*){animation-duration:.4s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* diary */
.crumb{margin:0 0 .4rem;font-size:.95rem}
.crumb a{color:var(--muted);text-decoration:none}
.crumb a::before{content:"< "}
.seg{margin:.8rem 0 0;font-size:.95rem;color:var(--muted)}
.seg a{color:var(--accent-ink)}
.seg [aria-current]{color:var(--ink);font-weight:600}
.entry{padding:1.2rem 0;border-top:1px solid var(--line)}
.entry .day{margin:0;font-size:.85rem;color:var(--muted)}
.entry h2{font-size:1.15rem;margin:.15rem 0 .5rem;letter-spacing:-.01em}
.star{color:var(--accent)}
.empty{color:var(--muted)}
`;
