// Renders a link page (amy.bo/~name) as one self-contained HTML document: a twisty list, and beside it a map of
// the same links drawn as a static SVG. Nothing moves and no script beyond a ~1 KB loader runs until someone
// touches the map; only then is /link-assets/graph.js fetched and the physics started.
// Shared by the page Function (server) and the editor's live preview (browser), so it has no platform imports.
import { icon } from './icons';
import { type DiaryEntry, type LinkNode, type PageData, mediaUrl, pagePath, walk } from './model';

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
}

/** Visitors don't see an empty support note or an empty diary; the editor's preview shows everything. */
const isHidden = (n: LinkNode, ctx: Ctx) => !ctx.preview && ((n.kind === 'support' && !n.body.trim()) || (n.kind === 'diary' && !ctx.data.diaryCount));

/** The tree as visitors see it: hidden items gone, empty groups gone, and a group holding a single link becomes
 * that link under the group's name (an "Email" group with one contact form is just "Email"). */
function visible(nodes: LinkNode[], ctx: Ctx): LinkNode[] {
	const out: LinkNode[] = [];
	for (const n of nodes) {
		if (isHidden(n, ctx)) continue;
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

const hrefOf = (n: LinkNode, ctx: Ctx) =>
	n.kind === 'link' ? (ctx.preview ? safeUrl(n.url) : `${ctx.base}/go/${encodeURIComponent(n.slug)}`) : n.kind === 'diary' ? `${ctx.base}/diary` : '';

// ---- the list: plain text, a twisty for each group ----

function renderList(nodes: LinkNode[], ctx: Ctx): string {
	const tgt = ctx.preview ? ' target="_blank" rel="noopener"' : '';
	return nodes
		.map((n) => {
			if (n.kind === 'group')
				return `<li><details><summary data-n="${n.id}"><span class="tw" aria-hidden="true">&gt;</span>${esc(n.label)}</summary><ul>${renderList(n.children, ctx)}</ul></details></li>`;
			if (n.kind === 'support')
				return `<li><details id="lp-support"><summary data-n="${n.id}"><span class="tw" aria-hidden="true">&gt;</span>${esc(n.label)}</summary><div class="note">${formatText(n.body)}</div></details></li>`;
			return `<li><a data-n="${n.id}" href="${esc(hrefOf(n, ctx))}"${n.kind === 'link' ? tgt : ''}>${esc(n.label)}</a></li>`;
		})
		.join('');
}

// ---- the map: purely graphical, laid out once on the server ----

interface GNode {
	id: number;
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
		list.forEach((n, i) => {
			const a = depth === 1 ? -Math.PI / 2 + i * sector : centre - spread / 2 + ((i + 0.5) * spread) / k;
			const rr = depth === 1 ? R1 : R;
			pos.set(n.id, { x: round(Math.cos(a) * rr), y: round(Math.sin(a) * rr), r: radiusFor(n, depth), depth });
			if (n.children.length) place(n.children, depth + 1, a, rr + (depth === 1 ? 100 : 82));
		});
	};
	place(top, 1, 0, R1);
	return pos;
}

/** A node's picture, centred on (x, y). `uid` keeps clip-path ids unique on the page. */
function iconMarkup(key: string, x: number, y: number, r: number, uid: string | number = ''): string {
	const i = icon(key);
	if (i.logo) {
		const l = i.logo;
		const bg = l.bg ? `<circle class="bg" cx="${x}" cy="${y}" r="${round(r - 1)}" style="fill:${esc(l.bg)};stroke:none"/>` : '';
		if (l.cover) {
			const s = r * 2 - 3;
			const id = `c${uid || Math.abs(Math.round(x * 7 + y * 13))}`;
			return `<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="${round(r - 1.5)}"/></clipPath><image href="${esc(l.src)}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${round(s)}" height="${round(s)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
		}
		// Natural proportions, never squeezed: the box is the logo's width, and "meet" keeps its shape.
		const w = r * (l.scale ?? 1.3);
		return `${bg}<image href="${esc(l.src)}" x="${round(x - w / 2)}" y="${round(y - w / 2)}" width="${round(w)}" height="${round(w)}" preserveAspectRatio="xMidYMid meet"${l.invert ? ' class="inv"' : ''}/>`;
	}
	const s = round(r * 1.05);
	return `<use href="#i-${esc(key)}" class="${i.brand ? 'ib' : 'il'}" x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${s}" height="${s}"${brandStyle(key)}/>`;
}

function graphData(roots: LinkNode[], ctx: Ctx) {
	const pos = layout(roots);
	const nodes: GNode[] = [];
	const visit = (list: LinkNode[], parent: number | null) =>
		list.forEach((n) => {
			const p = pos.get(n.id)!;
			nodes.push({ id: n.id, parent, kind: n.kind, label: n.label, href: n.kind === 'support' ? '#lp-support' : hrefOf(n, ctx), pic: iconMarkup(nodeIcon(n), 0, 0, p.r, `l${n.id}`), icon: nodeIcon(n), x: p.x, y: p.y, r: p.r });
			visit(n.children, n.id);
		});
	visit(roots, null);
	// The view fits every item the map can show, so it never zooms or pans as groups open.
	const ext = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y) + n.r)) + 14;
	const view: [number, number, number, number] = [-ext, -ext, ext * 2, ext * 2].map(round) as [number, number, number, number];

	const tgt = ctx.preview ? ' target="_blank" rel="noopener"' : '';
	const edges: string[] = [];
	const buds: string[] = [];
	const items: string[] = [];
	for (const n of roots) {
		const p = pos.get(n.id)!;
		edges.push(`<line data-e="${n.id}" x1="0" y1="0" x2="${p.x}" y2="${p.y}"/>`);
		// Small buds hint at what a group holds, on the side it will open towards.
		n.children.forEach((c) => {
			const q = pos.get(c.id)!;
			const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
			buds.push(`<circle class="bud" data-b="${n.id}" cx="${round(p.x + ((q.x - p.x) / d) * (p.r + 9))}" cy="${round(p.y + ((q.y - p.y) / d) * (p.r + 9))}" r="3"/>`);
		});
		const body = `<title>${esc(n.label)}</title><circle cx="${p.x}" cy="${p.y}" r="${p.r}"/>${iconMarkup(nodeIcon(n), p.x, p.y, p.r, `s${n.id}`)}`;
		const href = n.kind === 'support' ? '#lp-support' : hrefOf(n, ctx);
		items.push(
			n.kind === 'group'
				? `<g class="n group" data-g="${n.id}" tabindex="0" role="button" aria-expanded="false" aria-label="${esc(n.label)}">${body}</g>`
				: `<a class="n ${n.kind}" data-g="${n.id}" href="${esc(href)}" aria-label="${esc(n.label)}"${n.kind === 'link' ? tgt : ''}>${body}</a>`,
		);
	}
	const p = ctx.data.person;
	const hub =
		p.kind === 'org'
			? `<circle class="hub" r="42"/><image href="${esc(mediaUrl(p.photo))}" x="-30" y="-21" width="60" height="42" class="inv" preserveAspectRatio="xMidYMid meet"/>`
			: p.photo
				? `<circle class="hub" r="44"/><clipPath id="hubc"><circle r="42"/></clipPath><image href="${esc(mediaUrl(p.photo))}" x="-42" y="-42" width="84" height="84" clip-path="url(#hubc)" preserveAspectRatio="xMidYMid slice"/>`
				: `<circle class="hub" r="42"/><text class="initials" y="10">${esc(initials(p.name))}</text>`;
	const svg = `<g class="edges">${edges.join('')}</g><g class="buds">${buds.join('')}</g><g class="nodes">${items.join('')}</g><g class="hubg" data-g="0" role="button" tabindex="0" aria-label="${esc(p.name)}"><title>${esc(p.name)}</title>${hub}</g>`;
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
					`.lp:has([data-g="${n.id}"]:is(:hover,:focus-visible)) :is(${ids.map((i) => `[data-n="${i}"]`).join(',')}){color:var(--accent-ink)}`,
			);
			visit(n.children, ids);
		});
	visit(roots, []);
	return rules.join('');
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
	const ctx: Ctx = { base, data, preview: !!opts.preview };
	const canonical = `${opts.origin ?? 'https://amy.bo'}${base}`;
	const roots = visible(data.roots, ctx);
	const description = p.bio || `${p.name}: links.`;
	const relMe = [...walk(data.roots)]
		.filter((n) => n.kind === 'link' && n.icon === 'mastodon')
		.map((n) => `<link rel="me" href="${esc(n.url)}">`)
		.join('');
	const g = !p.basic_mode && roots.length ? graphData(roots, ctx) : null;
	const keys = new Set<string>(g ? g.nodes.map((n) => n.icon) : []);

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
<script type="application/json" id="lp-data">${JSON.stringify({ nodes: g.nodes, preview: ctx.preview }).replace(/</g, '\\u003c')}</script>
<script>${BOOT}</script>`
		: '';

	return `${head(p.name, description, canonical, relMe)}
<body class="lp${g ? ' has-map' : ''}">${keys.size ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${sprite(keys)}</defs></svg>` : ''}
<div class="shell">
<main class="list">
<header class="top">${portrait}<h1>${esc(p.name)}</h1>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</header>
<nav aria-label="Links"><ul class="tree">${renderList(roots, ctx)}</ul></nav>
</main>
${map}
</div>
${FOOT}
${g ? `<style>${linkStyles(roots)}</style>` : ''}
</body></html>`;
}

const fmtDay = (d: string) => {
	const t = new Date(`${d}T12:00:00Z`);
	return Number.isNaN(+t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function renderDiary(data: PageData, entries: DiaryEntry[], view: 'all' | 'highlights', opts: RenderOptions = {}): string {
	const p = data.person;
	const base = pagePath(p.handle);
	const canonical = `${opts.origin ?? 'https://amy.bo'}${base}/diary`;
	const diaryNode = [...walk(data.roots)].find((n) => n.kind === 'diary');
	const title = `${diaryNode?.label || 'Diary'} · ${p.name}`;
	const seg = (v: 'all' | 'highlights', label: string) => (view === v ? `<span aria-current="page">${label}</span>` : `<a href="${base}/diary?view=${v}">${label}</a>`);
	const list = entries.length
		? entries
				.map(
					(e) =>
						`<article class="entry"><p class="day"><time datetime="${esc(e.day)}">${esc(fmtDay(e.day))}</time>${e.highlight ? ' <span class="star" aria-label="Highlight">★</span>' : ''}</p><h2>${esc(e.title)}</h2>${formatText(e.body)}</article>`,
				)
				.join('')
		: `<p class="empty">${view === 'highlights' ? 'No highlights yet.' : 'No entries yet.'}</p>`;
	return `${head(title, `${p.name}'s ${diaryNode?.label || 'diary'}`, canonical)}
<body class="lp diary"><div class="shell"><main class="list">
<header class="top"><p class="crumb"><a href="${base}">${esc(p.name)}</a></p><h1>${esc(diaryNode?.label || 'Diary')}</h1>
<p class="seg">${seg('highlights', 'Highlights')} · ${seg('all', 'All entries')}</p></header>
${list}
</main></div>
${FOOT}
</body></html>`;
}

/** Loader: on the first touch, hover or keypress on the map, fetch the physics and hand over. ~1 KB. */
/** The map's only script until it is used: a click (or Enter) on a group, or any tap on a phone, fetches
 * /link-assets/graph.js. Links on the map are plain links and work without it. */
export const BOOT = `(()=>{const b=document.body,m=document.querySelector('.map');if(!m)return;let go;const rm=matchMedia('(prefers-reduced-motion: reduce)').matches;const vt=f=>document.startViewTransition&&!rm?document.startViewTransition(f):f();const small=()=>matchMedia('(max-width: 56rem)').matches;const load=()=>(go=go||import('/link-assets/graph.js').then(g=>g.start(m)));const act=(e,g)=>{e.preventDefault();load().then(x=>x.tap(+g.dataset.g))};m.addEventListener('click',e=>{if(small()&&!b.classList.contains('map-on')){e.preventDefault();vt(()=>b.classList.add('map-on'));load();return}const g=e.target.closest('g[data-g]');if(g)act(e,g)});m.addEventListener('keydown',e=>{const g=e.target.closest&&e.target.closest('g[data-g]');if(g&&(e.key==='Enter'||e.key===' '))act(e,g)});const off=()=>{if(b.classList.contains('map-on'))vt(()=>b.classList.remove('map-on'))};m.querySelector('.back').addEventListener('click',e=>{e.stopPropagation();off()});addEventListener('keydown',e=>{if(e.key==='Escape')off()})})();`;

const CSS = `
:root{--bg:#f6f8f4;--ink:#16210f;--muted:#66745f;--line:#d8e2cf;--accent:#3f9c00;--accent-ink:#1d6b00;--node:#fff;--ease:cubic-bezier(.2,.8,.2,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0b1208;--ink:#e6f0df;--muted:#97a88e;--line:#24361d;--accent:#87bd25;--accent-ink:#b7e27c;--node:#142010}.inv{filter:invert(1) hue-rotate(180deg) brightness(1.15)}}
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
.mapsvg .bud{fill:var(--line)}
.mapsvg .hub{fill:var(--node);stroke:var(--line);stroke-width:1.5}
.mapsvg .initials{font-size:28px;font-weight:650;text-anchor:middle;fill:var(--accent-ink)}
.mapsvg .n,.mapsvg .hubg{cursor:pointer;outline:none}
.mapsvg circle{vector-effect:non-scaling-stroke}
.mapsvg.live{touch-action:none}
.mapsvg .edges line{transition:opacity .3s}
.mapsvg .bud{transition:opacity .2s}
.mapsvg .n>circle{fill:var(--node);stroke:var(--line);stroke-width:1.5;transition:stroke .15s,stroke-width .15s}
.mapsvg .n.group>circle{stroke:color-mix(in srgb,var(--accent) 40%,var(--line))}
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
.map-on .back{display:grid;place-items:center;position:fixed;top:max(1rem,env(safe-area-inset-top));left:1rem;width:2.75rem;height:2.75rem;border-radius:50%;border:1px solid var(--line);background:var(--node);color:var(--ink);cursor:pointer;view-transition-name:lp-list}
.back svg{width:1.2rem;height:1.2rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.map-on .list{view-transition-name:none}
.list{view-transition-name:lp-list}
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
