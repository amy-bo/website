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

const nodeIcon = (n: LinkNode) => n.icon || (n.kind === 'diary' ? 'diary' : n.kind === 'support' ? 'heart' : n.kind === 'group' ? 'folder' : 'link');

function sprite(keys: Set<string>): string {
	return [...keys]
		.map((k) => {
			const i = icon(k);
			return `<symbol id="i-${esc(k)}" viewBox="0 0 24 24">${i.svg}</symbol>`;
		})
		.join('');
}

const iconSvg = (key: string, cls = '') => {
	const i = icon(key);
	return `<svg class="${i.brand ? 'ib' : 'il'}${cls ? ` ${cls}` : ''}" aria-hidden="true"${brandStyle(key)}><use href="#i-${esc(key)}"/></svg>`;
};

function tile(n: LinkNode): string {
	if (n.image) return `<span class="ico"><img src="${esc(mediaUrl(n.image))}" alt="" width="44" height="44" loading="lazy" decoding="async"></span>`;
	return `<span class="ico">${iconSvg(nodeIcon(n))}</span>`;
}

const chevron = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

interface Ctx {
	base: string;
	data: PageData;
	preview: boolean;
}

function renderNodes(nodes: LinkNode[], ctx: Ctx, depth: number): string {
	return nodes
		.filter((n) => ctx.preview || (n.kind === 'support' ? !!n.body.trim() : n.kind === 'diary' ? ctx.data.diaryCount > 0 : true))
		.map((n) => {
			if (n.kind === 'group') {
				const count = [...walk(n.children)].filter((c) => c.kind !== 'group').length;
				return `<li class="grp"><details${depth === 0 ? ' open' : ''}><summary><span class="twisty" aria-hidden="true"></span><span class="glabel">${esc(n.label)}</span><span class="count">${count}</span></summary><ul>${renderNodes(n.children, ctx, depth + 1)}</ul></details></li>`;
			}
			if (n.kind === 'support') {
				return `<li class="grp note"><details id="lp-support"><summary>${tile(n)}<span class="text"><span class="label">${esc(n.label)}</span></span><span class="twisty end" aria-hidden="true"></span></summary><div class="notebody">${formatText(n.body)}</div></details></li>`;
			}
			if (n.kind === 'diary') {
				const { diaryCount: d, highlightCount: h } = ctx.data;
				const sub = d ? `${d} ${d === 1 ? 'entry' : 'entries'}${h ? ` · ${h} highlight${h === 1 ? '' : 's'}` : ''}` : 'No entries yet';
				return `<li><a class="item" href="${ctx.base}/diary">${tile(n)}<span class="text"><span class="label">${esc(n.label)}</span><span class="host">${sub}</span></span>${chevron}</a></li>`;
			}
			const href = ctx.preview ? safeUrl(n.url) : `${ctx.base}/go/${encodeURIComponent(n.slug)}`;
			return `<li><a class="item" href="${esc(href)}"${ctx.preview ? ' target="_blank" rel="noopener"' : ''}>${tile(n)}<span class="text"><span class="label">${esc(n.label)}</span><span class="host">${esc(hostLine(n.url))}</span></span>${chevron}</a></li>`;
		})
		.join('');
}

// ---- static map ----

interface GNode {
	id: number;
	parent: number | null;
	kind: string;
	label: string;
	href: string;
	icon: string;
	/** 'ib' (brand, filled) or 'il' (line), and the brand colour style, for the live map. */
	ic: string;
	st: string;
	image: string;
	x?: number;
	y?: number;
}

function graphData(ctx: Ctx): { nodes: GNode[]; svg: string; view: [number, number, number, number] } {
	const { data, base } = ctx;
	const nodes: GNode[] = [];
	const hidden = (n: LinkNode) => !ctx.preview && ((n.kind === 'support' && !n.body.trim()) || (n.kind === 'diary' && !data.diaryCount));
	const top = data.roots.filter((n) => !hidden(n));
	for (const n of walk(top)) {
		if (hidden(n)) continue;
		nodes.push({
			id: n.id,
			parent: n.parent_id,
			kind: n.kind,
			label: n.label,
			href: n.kind === 'link' ? (ctx.preview ? safeUrl(n.url) : `${base}/go/${encodeURIComponent(n.slug)}`) : n.kind === 'diary' ? `${base}/diary` : n.kind === 'support' ? '#lp-support' : '',
			icon: nodeIcon(n),
			ic: icon(nodeIcon(n)).brand ? 'ib' : 'il',
			st: brandStyle(nodeIcon(n)).replace(/^ style="|"$/g, ''),
			image: n.image ? mediaUrl(n.image) : '',
		});
	}
	const N = Math.max(top.length, 1);
	const R1 = N <= 5 ? 112 : N <= 8 ? 128 : 150;
	const byId = new Map(nodes.map((g) => [g.id, g]));
	const parts: string[] = [];
	const edges: string[] = [];
	const dots: string[] = [];
	top.forEach((n, i) => {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
		const x = Math.round(Math.cos(a) * R1 * 10) / 10;
		const y = Math.round(Math.sin(a) * R1 * 10) / 10;
		const g = byId.get(n.id)!;
		g.x = x;
		g.y = y;
		edges.push(`<line x1="0" y1="0" x2="${x}" y2="${y}"/>`);
		const kids = n.children.filter((c) => !hidden(c));
		kids.forEach((c, j) => {
			const spread = Math.min(1.4, 0.32 * kids.length);
			const ca = a + (kids.length > 1 ? -spread / 2 + (j * spread) / (kids.length - 1) : 0);
			const cx = Math.round((x + Math.cos(ca) * 40) * 10) / 10;
			const cy = Math.round((y + Math.sin(ca) * 40) * 10) / 10;
			const cg = byId.get(c.id)!;
			cg.x = cx;
			cg.y = cy;
			edges.push(`<line class="e2" x1="${x}" y1="${y}" x2="${cx}" y2="${cy}"/>`);
			dots.push(`<circle class="dot" cx="${cx}" cy="${cy}" r="4.5"/>`);
		});
		const r = n.kind === 'group' ? 21 : 18;
		const label = n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label;
		const k = nodeIcon(n);
		const ic = icon(k);
		const ly = y >= 0 ? y + r + 15 : y - r - 8;
		parts.push(
			`<g class="n ${n.kind}"><circle cx="${x}" cy="${y}" r="${r}"/><use href="#i-${esc(k)}" class="${ic.brand ? 'ib' : 'il'}" x="${x - 10}" y="${y - 10}" width="20" height="20"${brandStyle(k)}/><text x="${x}" y="${ly}">${esc(label)}</text></g>`,
		);
	});
	const p = data.person;
	const centre =
		p.kind === 'org'
			? `<circle class="hub" r="38"/><image href="${esc(mediaUrl(p.photo))}" x="-27" y="-19" width="54" height="38" preserveAspectRatio="xMidYMid meet"/>`
			: p.photo
				? `<clipPath id="lp-hub"><circle r="38"/></clipPath><circle class="hub" r="40"/><image href="${esc(mediaUrl(p.photo))}" x="-38" y="-38" width="76" height="76" clip-path="url(#lp-hub)" preserveAspectRatio="xMidYMid slice"/>`
				: `<circle class="hub" r="38"/><text class="initials" y="9">${esc(initials(p.name))}</text>`;
	const pad = 70;
	const ext = R1 + 40 + pad;
	const view: [number, number, number, number] = [-ext, -ext, ext * 2, ext * 2];
	const svg = `<g class="edges">${edges.join('')}</g><g class="dots">${dots.join('')}</g><g class="hubg">${centre}</g>${parts.join('')}`;
	return { nodes, svg, view };
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
<meta name="theme-color" content="#f4f7f1" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b1208" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="profile">
<link rel="canonical" href="${esc(canonical)}"><link rel="icon" href="/favicon.svg">${extra}<style>${CSS}</style></head>`;
}

export function renderPage(data: PageData, opts: RenderOptions = {}): string {
	const p = data.person;
	const base = pagePath(p.handle);
	const ctx: Ctx = { base, data, preview: !!opts.preview };
	const canonical = `${opts.origin ?? 'https://amy.bo'}${base}`;
	const keys = new Set<string>();
	for (const n of walk(data.roots)) keys.add(nodeIcon(n));
	const description = p.bio || `${p.name}: links.`;
	const relMe = [...walk(data.roots)]
		.filter((n) => n.kind === 'link' && n.icon === 'mastodon')
		.map((n) => `<link rel="me" href="${esc(n.url)}">`)
		.join('');
	const showGraph = !p.basic_mode && data.roots.length > 0;
	const g = showGraph ? graphData(ctx) : null;

	const avatar =
		p.kind === 'org'
			? `<img class="logo" src="${esc(mediaUrl(p.photo))}" alt="${esc(p.name)}" width="176" height="122">`
			: p.photo
				? `<img class="avatar" src="${esc(mediaUrl(p.photo))}" alt="" width="104" height="104">`
				: `<span class="avatar ph" aria-hidden="true">${esc(initials(p.name))}</span>`;

	const graphPanel = g
		? `<aside class="map" aria-label="Map of these links">
<button type="button" class="map-open" aria-label="Explore these links as a map"></button>
<svg class="mapsvg" viewBox="${g.view.join(' ')}" role="presentation">${g.svg}</svg>
<p class="map-hint" aria-hidden="true"><span class="pulse"></span>Touch to explore</p>
</aside>
<button type="button" class="back" aria-label="Back to the list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg></button>
<script type="application/json" id="lp-data">${JSON.stringify({ name: p.name, photo: p.photo ? mediaUrl(p.photo) : '', kind: p.kind, initials: initials(p.name), nodes: g.nodes, view: g.view }).replace(/</g, '\\u003c')}</script>
<script>${BOOT}</script>`
		: '';

	return `${head(p.name, description, canonical, relMe)}
<body class="lp${g ? ' has-map' : ''}"><svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${sprite(keys)}</defs></svg>
<div class="shell">
<main class="list">
<header class="top">${avatar}<h1${p.kind === 'org' ? ' class="vh"' : ''}>${esc(p.name)}</h1>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</header>
<nav aria-label="Links"><ul class="tree">${renderNodes(data.roots, ctx, 0)}</ul></nav>
<footer class="foot"><a href="https://amybo.org/">AMYBO</a><span aria-hidden="true"> · </span>clicks are counted, nothing about you is stored<span aria-hidden="true"> · </span><a href="https://amybo.org/privacy/">Privacy</a></footer>
</main>
${graphPanel}
</div>
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
	const seg = (v: 'all' | 'highlights', label: string, n: number) =>
		`<a href="${base}/diary?view=${v}"${view === v ? ' aria-current="page"' : ''}>${label} <span class="count">${n}</span></a>`;
	const list = entries.length
		? entries
				.map(
					(e) =>
						`<article class="entry${e.highlight ? ' hl' : ''}"><header><time datetime="${esc(e.day)}">${esc(fmtDay(e.day))}</time>${e.highlight ? '<span class="star" title="Highlight" aria-label="Highlight">★</span>' : ''}</header><h2>${esc(e.title)}</h2>${formatText(e.body)}</article>`,
				)
				.join('')
		: `<p class="empty">${view === 'highlights' ? 'No highlights yet.' : 'No entries yet.'}</p>`;
	const mini = p.photo ? `<img class="${p.kind === 'org' ? 'minilogo' : 'mini'}" src="${esc(mediaUrl(p.photo))}" alt="" width="40" height="40">` : '';
	return `${head(title, `${p.name}'s ${diaryNode?.label || 'diary'}`, canonical)}
<body class="lp diary"><div class="shell one"><main class="list">
<header class="dtop"><a class="backlink" href="${base}">${mini}<span>${esc(p.name)}</span></a><h1>${esc(diaryNode?.label || 'Diary')}</h1>
<nav class="seg" aria-label="Show">${seg('highlights', 'Highlights', data.highlightCount)}${seg('all', 'All', data.diaryCount)}</nav></header>
<div class="entries">${list}</div>
<footer class="foot"><a href="${base}">Back to ${esc(p.name)}</a></footer>
</main></div></body></html>`;
}

/** Loader: on the first touch, hover or keypress on the map, fetch the physics and hand over. ~1 KB. */
const BOOT = `(()=>{const b=document.body,m=document.querySelector('.map');if(!m)return;let go=null;const on=e=>{if(b.classList.contains('map-on'))return;if(e&&e.type==='pointerenter'&&e.pointerType!=='mouse')return;const t=()=>b.classList.add('map-on');document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches?document.startViewTransition(t):t();go=go||import('/link-assets/graph.js').then(g=>g.start(m)).catch(()=>{});};m.addEventListener('pointerenter',on);m.addEventListener('pointerdown',on);m.querySelector('.map-open').addEventListener('click',on);const off=()=>{if(!b.classList.contains('map-on'))return;const t=()=>b.classList.remove('map-on');document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches?document.startViewTransition(t):t();window.dispatchEvent(new Event('lp-map-off'));};document.querySelector('.back').addEventListener('click',off);addEventListener('keydown',e=>{if(e.key==='Escape')off()});})();`;

const CSS = `
:root{--bg:#f4f7f1;--bg2:#e6efdd;--card:#fff;--ink:#132010;--muted:#5d6c56;--line:#dce6d4;--accent:#3f9c00;--accent-ink:#175a00;--tile:#eef4e8;--shadow:0 1px 2px rgb(19 32 16/5%),0 6px 20px rgb(19 32 16/6%);--r:18px;--ease:cubic-bezier(.2,.8,.2,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0b1208;--bg2:#13200e;--card:#141f10;--ink:#e9f2e3;--muted:#9bad92;--line:#22331b;--accent:#87bd25;--accent-ink:#b7e27c;--tile:#1c2b16;--shadow:0 1px 2px rgb(0 0 0/40%)}}
*{box-sizing:border-box}html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;font:16px/1.45 system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:radial-gradient(70rem 34rem at 30% -12rem,var(--bg2),transparent 70%),var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.shell{max-width:76rem;margin:0 auto;padding:max(2.5rem,env(safe-area-inset-top)) 1rem 2rem;display:grid;grid-template-columns:minmax(0,34rem);justify-content:center;gap:3rem}
.has-map .shell{grid-template-columns:minmax(0,34rem) minmax(20rem,1fr)}
.list{view-transition-name:lp-list;min-width:0}
.top{text-align:center;margin-bottom:1.6rem}
.avatar{display:block;width:6.5rem;height:6.5rem;margin:0 auto 1rem;border-radius:50%;object-fit:cover;background:var(--card);box-shadow:0 0 0 4px var(--card),var(--shadow)}
.avatar.ph{display:grid;place-items:center;font-size:2.1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#87bd25,#175a00)}
.logo{display:block;width:11rem;height:auto;margin:.5rem auto 1.2rem}
@media (prefers-color-scheme:dark){.logo,.minilogo{filter:invert(1) hue-rotate(180deg) brightness(1.1)}}
h1{font-size:1.75rem;line-height:1.15;margin:0;letter-spacing:-.015em;font-weight:680}
.bio{margin:.6rem auto 0;max-width:27rem;color:var(--muted);text-wrap:balance}
ul{list-style:none;margin:0;padding:0}
.tree,.tree ul{display:grid;gap:.55rem}
.tree ul{padding:.55rem 0 .2rem .9rem;margin-left:.55rem;border-left:1.5px solid var(--line)}
.item,.note summary{display:flex;align-items:center;gap:.9rem;padding:.65rem .9rem .65rem .65rem;background:var(--card);border:1px solid var(--line);border-radius:var(--r);text-decoration:none;box-shadow:var(--shadow);transition:transform .2s var(--ease),border-color .2s,box-shadow .2s}
.item:hover,.note summary:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 60%,var(--line))}
.item:active{transform:scale(.985)}
.item:focus-visible,summary:focus-visible,.seg a:focus-visible,.back:focus-visible,.map-open:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ico{flex:none;width:2.75rem;height:2.75rem;border-radius:13px;display:grid;place-items:center;background:var(--tile);color:var(--accent-ink);overflow:hidden}
.ico img{width:100%;height:100%;object-fit:cover}
.ico svg{width:1.4rem;height:1.4rem}
svg.ib,use.ib{fill:var(--brand,currentColor)}
svg.il,use.il{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-color-scheme:dark){svg.ib,use.ib{fill:var(--brand-d,currentColor)}}
.text{flex:1;min-width:0;display:grid}
.label{font-weight:600;line-height:1.3}
.host{font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chev{flex:none;width:1.1rem;height:1.1rem;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}
.item:hover .chev{transform:translateX(2px)}
summary{list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
summary::-webkit-details-marker{display:none}
.grp:not(.note)>details>summary{display:flex;align-items:center;gap:.55rem;padding:.35rem .4rem;margin-top:.6rem;border-radius:10px;font-size:.78rem;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.grp:first-child>details>summary{margin-top:0}
.twisty{flex:none;width:.55rem;height:.55rem;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);transition:transform .25s var(--ease);margin:0 .2rem}
details[open]>summary .twisty{transform:rotate(45deg)}
.twisty.end{margin-left:auto;color:var(--muted)}
.glabel{flex:1}
.count{font-size:.72rem;font-weight:600;letter-spacing:0;padding:.05rem .45rem;border-radius:99px;background:var(--tile);color:var(--muted)}
.notebody{padding:.8rem 1rem .2rem 4.4rem;color:var(--ink)}
.notebody p,.entry p{margin:0 0 .7rem}
.notebody a,.entry a{color:var(--accent-ink);text-underline-offset:2px}
@supports (interpolate-size:allow-keywords){:root{interpolate-size:allow-keywords}details::details-content{block-size:0;overflow:clip;transition:block-size .3s var(--ease),content-visibility .3s allow-discrete}details[open]::details-content{block-size:auto}}
.foot{margin-top:2.6rem;text-align:center;font-size:.8rem;color:var(--muted)}
.foot a{color:inherit}
/* map */
.map{position:sticky;top:2rem;align-self:start;height:min(40rem,calc(100vh - 4rem));border-radius:28px;background:radial-gradient(circle at 50% 45%,var(--card),transparent 72%);view-transition-name:lp-map;cursor:pointer}
.map-open{position:absolute;inset:0;width:100%;height:100%;background:none;border:0;border-radius:inherit;cursor:pointer;z-index:1}
.mapsvg{width:100%;height:100%;display:block;overflow:visible}
.mapsvg .edges line{stroke:var(--line);stroke-width:1.5}
.mapsvg .edges line.e2{stroke-width:1}
.mapsvg .dot{fill:var(--muted);opacity:.45}
.mapsvg .hub{fill:var(--card);stroke:var(--line);stroke-width:1.5}
.mapsvg .initials{font-size:26px;font-weight:700;text-anchor:middle;fill:var(--accent-ink)}
.mapsvg .n circle{fill:var(--card);stroke:var(--line);stroke-width:1.5}
.mapsvg .n.group circle{stroke:color-mix(in srgb,var(--accent) 45%,var(--line));stroke-width:2}
.mapsvg .n use{color:var(--accent-ink)}
.mapsvg text{font-size:11px;text-anchor:middle;fill:var(--muted);font-weight:550}
.mapsvg .n{cursor:pointer;outline:none}
.mapsvg .n.near circle,.mapsvg .n:focus-visible circle,.mapsvg a.n:hover circle{stroke:var(--accent);stroke-width:2.5}
.mapsvg .n.near .lbl,.mapsvg .n:focus-visible .lbl{fill:var(--ink)}
.mapsvg .badge circle{fill:var(--accent);stroke:var(--card);stroke-width:2}
.mapsvg .badge text{fill:#fff;font-size:9px;font-weight:700}
.mapsvg .d2 .lbl,.mapsvg .d3 .lbl{font-size:10px}
.map-on .mapsvg{touch-action:none}
.map-hint{position:absolute;left:0;right:0;bottom:1rem;margin:0;text-align:center;font-size:.8rem;color:var(--muted);display:flex;gap:.5rem;align-items:center;justify-content:center;pointer-events:none}
.pulse{width:.5rem;height:.5rem;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 50%,transparent);animation:pulse 2.4s ease-out 3}
@keyframes pulse{to{box-shadow:0 0 0 10px transparent}}
.back{position:fixed;top:max(1rem,env(safe-area-inset-top));left:1rem;z-index:5;width:3rem;height:3rem;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--ink);box-shadow:var(--shadow);display:none;place-items:center;cursor:pointer}
.back svg{width:1.3rem;height:1.3rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.map-on .list{display:none}
.map-on .back{display:grid;view-transition-name:lp-list}
.map-on .map{position:fixed;inset:0;height:auto;border-radius:0;z-index:4;background:var(--bg);cursor:default}
.map-on .map-open,.map-on .map-hint{display:none}
.map-on .shell{display:block}
::view-transition-group(*){animation-duration:.45s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
@media (max-width:56rem){.has-map .shell{grid-template-columns:minmax(0,34rem);gap:1.5rem}.has-map .map{position:relative;top:0;order:-1;height:15rem;margin:-1rem 0 -.5rem}.has-map .list{order:0}.has-map .shell{display:flex;flex-direction:column;align-items:stretch;max-width:36rem}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* diary */
.dtop{margin-bottom:1.4rem}
.backlink{display:inline-flex;align-items:center;gap:.6rem;text-decoration:none;color:var(--muted);font-weight:550;margin-bottom:1rem}
.mini{width:2.5rem;height:2.5rem;border-radius:50%;object-fit:cover}
.minilogo{width:3.4rem;height:auto}
.seg{display:inline-flex;gap:.25rem;padding:.25rem;margin-top:1rem;border-radius:99px;background:var(--tile)}
.seg a{padding:.35rem .95rem;border-radius:99px;text-decoration:none;font-size:.9rem;font-weight:600;color:var(--muted)}
.seg a[aria-current]{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.seg .count{background:none;padding:0 0 0 .2rem}
.entries{display:grid;gap:.9rem}
.entry{padding:1.1rem 1.2rem .5rem;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.entry.hl{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}
.entry header{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:.85rem}
.entry h2{font-size:1.15rem;margin:.25rem 0 .55rem;letter-spacing:-.01em}
.star{color:var(--accent);font-size:1rem}
.empty{color:var(--muted);text-align:center;padding:2rem 0}
.one{grid-template-columns:minmax(0,40rem)!important}
`;
