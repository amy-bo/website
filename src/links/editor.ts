// The link-page editor (/links/edit/): sign in by emailed link, then edit your page with a live preview.
// Plain DOM, no framework. State is a tree; every change re-renders the affected part and autosaves.
import { guessIcon, icon } from './icons';
import { type LinkNode, type NodeKind, type PageData, buildTree, diaryEntries } from './model';
import { TILE_CSS, esc, hostLine, renderPage, tileSvg, tintProps } from './render';

// ---------- types and state ----------

interface ENode {
	key: string;
	id?: number;
	slug?: string;
	kind: NodeKind;
	label: string;
	url: string;
	icon: string;
	image: string;
	body: string;
	seed: number;
	/** Picture colour ('' original, 'mono', '#rrggbb') and size in its circle (0.6 to 1.6). */
	tint: string;
	zoom: number;
	/** Optional short date (YY, YYMM, YYMMDD) and highlight, for diary entries. */
	day: string;
	highlight: number;
	/** Dark-mode picture: used when dk_linked is 0. */
	dk_linked: number;
	dk_icon: string;
	dk_tint: string;
	dk_zoom: number;
	children: ENode[];
	collapsed?: boolean;
	/** The last address the server accepted; used while the one being typed isn't valid yet. */
	savedUrl?: string;
}

interface Person {
	handle: string;
	email: string;
	name: string;
	bio: string;
	photo: string;
	kind: 'person' | 'org';
	basic_mode: number;
	diary_default: 'all' | 'highlights';
	accent: string;
	hub_icon: string;
	hub_tint: string;
	hub_zoom: number;
	hub_dk_linked: number;
	hub_dk_icon: string;
	hub_dk_tint: string;
	hub_dk_zoom: number;
}

interface MeResponse {
	person: Person;
	nodes: (Omit<LinkNode, 'children'> & { parent_id: number | null })[];
	stats: { slug: string; total: number; d30: number }[];
	uploads: boolean;
	icons: string[];
}

const S = {
	person: null as Person | null,
	tree: [] as ENode[],
	stats: new Map<string, { total: number; d30: number }>(),
	uploads: false,
	icons: [] as string[],
};

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const h = (html: string) => {
	const t = document.createElement('template');
	t.innerHTML = html.trim();
	return t.content.firstElementChild as HTMLElement;
};
const mediaUrl = (v: string) => (v.startsWith('r2:') ? `/links/media/${v.slice(3)}` : v);
const pageUrl = () => (S.person!.handle === 'amybo' ? 'amy.bo/links' : `amy.bo/~${S.person!.handle}`);

// ---------- API ----------

async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: Blob } = {}): Promise<T> {
	const res = await fetch(`/api/links/${path}`, {
		method: opts.method ?? (opts.body || opts.raw ? 'POST' : 'GET'),
		headers: opts.raw ? { 'content-type': opts.raw.type } : opts.body ? { 'content-type': 'application/json' } : {},
		body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
		credentials: 'same-origin',
	});
	const j = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) {
		if (res.status === 401 && path !== 'me') showSignIn('Your sign-in has expired. Send yourself a new link.');
		throw new Error(j.error || `Something went wrong (${res.status})`);
	}
	return j;
}

// ---------- toasts and save status ----------

function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
	if (!msg) return;
	const t = h(`<div class="toast ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${esc(msg)}</div>`);
	$('#toasts').append(t);
	setTimeout(() => t.classList.add('out'), kind === 'err' ? 5200 : 2400);
	setTimeout(() => t.remove(), kind === 'err' ? 5600 : 2800);
}

const status = (text: string, cls = '') => {
	const s = $('#savestate');
	s.textContent = text;
	s.className = `savestate ${cls}`;
};

const timers = new Map<string, number>();
function later(name: string, fn: () => Promise<void>, ms = 700) {
	clearTimeout(timers.get(name));
	status('Editing…');
	timers.set(
		name,
		window.setTimeout(async () => {
			status('Saving…', 'busy');
			try {
				await fn();
				status('Saved', 'ok');
			} catch (e) {
				status('Not saved', 'err');
				toast((e as Error).message, 'err');
			}
		}, ms),
	);
}

// ---------- tree helpers ----------

function* walkE(list: ENode[]): Generator<ENode> {
	for (const n of list) {
		yield n;
		yield* walkE(n.children);
	}
}
const find = (key: string, list = S.tree, parent: ENode | null = null): { node: ENode; list: ENode[]; parent: ENode | null } | null => {
	for (const n of list) {
		if (n.key === key) return { node: n, list, parent };
		const r = find(key, n.children, n);
		if (r) return r;
	}
	return null;
};
const validUrl = (u: string) => /^(https?:\/\/[^\s]+\.[^\s]+|mailto:[^\s]+@[^\s]+)$/i.test(u.trim());
/** The tree as the API wants it. A link whose address is still being typed keeps its last saved address, or
 * (if it has never been saved) waits, so one half-typed address never holds up every other change. */
const flatten = () => {
	const out: { key: string; url: string }[] = [];
	const pending: string[] = [];
	const add = (list: ENode[], parent: string | null) =>
		list.forEach((n) => {
			let url = n.url.trim();
			if (n.kind === 'link' && !validUrl(url)) {
				pending.push(n.label || 'a link');
				if (!n.savedUrl) return;
				url = n.savedUrl;
			}
			out.push({ id: n.id, key: n.key, parent, kind: n.kind, label: n.label.trim() || 'Untitled', url, icon: n.icon, image: n.image, body: n.body, tint: n.tint, zoom: n.zoom, day: n.day, highlight: !!n.highlight, dk_linked: n.dk_linked, dk_icon: n.dk_icon, dk_tint: n.dk_tint, dk_zoom: n.dk_zoom } as never);
			add(n.children, n.key);
		});
	add(S.tree, null);
	return { nodes: out, pending };
};

let saving: Promise<void> | null = null;
async function saveNodes() {
	const send = async () => {
		const { nodes, pending } = flatten();
		const r = await api<{ ids: Record<string, number>; slugs: Record<string, string> }>('nodes', { method: 'PUT', body: { nodes } });
		const sent = new Map(nodes.map((x) => [x.key, x.url]));
		for (const n of walkE(S.tree)) {
			if (r.ids[n.key] != null) n.id = r.ids[n.key];
			if (r.slugs?.[n.key]) n.slug = r.slugs[n.key];
			if (n.kind === 'link' && sent.has(n.key) && validUrl(n.url)) n.savedUrl = n.url.trim();
		}
		remember();
		if (pending.length) throw new Error(`Saved, except the address for "${pending[0]}": it needs to start https://`);
	};
	// One save at a time, so new items never get created twice.
	saving = (saving ?? Promise.resolve()).catch(() => {}).then(send);
	await saving;
}
// ---------- undo: every change this session is a step back ----------
const undoStack: string[] = [];
const redoStack: string[] = [];
let lastSnap = '';
let snapTimer = 0;
// Steps leave out what saving fills in (ids, addresses), so a save never looks like a change; restoring puts back
// those that the server still has, and anything it no longer has is created afresh.
const VOLATILE = new Set(['id', 'slug', 'savedUrl', 'collapsed']);
const snapshot = () => JSON.stringify({ tree: S.tree, person: S.person }, (k, v) => (VOLATILE.has(k) ? undefined : v));
const saved = new Map<string, { id: number; slug?: string; savedUrl?: string }>();
const remember = () => {
	saved.clear();
	for (const n of walkE(S.tree)) if (n.id != null) saved.set(n.key, { id: n.id, slug: n.slug, savedUrl: n.savedUrl });
};
/** Records the current state as an undo step (typing is grouped: one step per pause). */
function record(now = false) {
	clearTimeout(snapTimer);
	const take = () => {
		const snap = snapshot();
		if (snap === lastSnap) return;
		if (lastSnap) undoStack.push(lastSnap);
		redoStack.length = 0;
		lastSnap = snap;
	};
	if (now) take();
	else snapTimer = window.setTimeout(take, 500);
}
function restore(snap: string) {
	const st = JSON.parse(snap);
	const open = new Map([...walkE(S.tree)].map((n) => [n.key, n.collapsed]));
	S.tree = st.tree;
	for (const n of walkE(S.tree)) {
		Object.assign(n, saved.get(n.key) ?? { id: undefined, slug: '' });
		n.collapsed = open.get(n.key);
	}
	S.person = st.person;
	lastSnap = snap;
	renderProfile();
	renderTree();
	preview();
	later('nodes', saveNodes, 200);
	later('profile', saveProfile, 200);
}
function undo() {
	record(true);
	const prev = undoStack.pop();
	if (!prev) return toast('Nothing to undo');
	redoStack.push(lastSnap);
	restore(prev);
	toast('Undone');
}
function redo() {
	const next = redoStack.pop();
	if (!next) return toast('Nothing to redo');
	undoStack.push(lastSnap);
	restore(next);
	toast('Redone');
}

const changed = (structural = false) => {
	if (structural) renderTree();
	preview();
	record(structural);
	later('nodes', saveNodes);
};

// ---------- live preview ----------

let previewTimer = 0;
function preview() {
	clearTimeout(previewTimer);
	previewTimer = window.setTimeout(() => {
		if (!S.person) return;
		let id = -1;
		const toLink = (n: ENode, parent: number | null): LinkNode => {
			const myId = n.id ?? id--;
			return {
				id: myId,
				parent_id: parent,
				kind: n.kind,
				slug: n.slug ?? n.key,
				label: n.label || 'Untitled',
				url: n.url,
				icon: n.icon,
				image: n.image,
				body: n.body,
				seed: 0,
				position: 0,
				tint: n.tint,
				zoom: n.zoom,
				day: n.day,
				highlight: n.highlight,
				dk_linked: n.dk_linked,
				dk_icon: n.dk_icon,
				dk_tint: n.dk_tint,
				dk_zoom: n.dk_zoom,
				children: n.children.map((c) => toLink(c, myId)),
			};
		};
		const roots = S.tree.map((n) => toLink(n, null));
		const entries = diaryEntries(roots);
		const data: PageData = {
			person: { id: 0, ...S.person, basic_mode: S.person.basic_mode },
			roots,
			diaryCount: entries.length,
			highlightCount: entries.filter((e) => e.highlight).length,
		};
		// The preview is sandboxed (its own origin), so its scroll position can't be read; just redraw it.
		$<HTMLIFrameElement>('#preview').srcdoc = renderPage(data, { preview: true });
	}, 250);
}

// ---------- rendering the editor ----------

let tileSeq = 0;
/** An item's picture exactly as the page draws it (see tileSvg). */
const tileHtml = (n: { icon: string; image: string; kind?: NodeKind; tint?: string; zoom?: number; dk_linked?: number; dk_icon?: string; dk_tint?: string; dk_zoom?: number; children?: unknown[] }) =>
	tileSvg(
		{ kind: n.kind ?? 'link', icon: n.icon, image: n.image, tint: n.tint ?? '', zoom: n.zoom ?? 1, dk_linked: n.dk_linked ?? 1, dk_icon: n.dk_icon ?? '', dk_tint: n.dk_tint ?? '', dk_zoom: n.dk_zoom ?? 1, children: (n.children ?? []) as LinkNode[] },
		`e${++tileSeq}`,
	);

/** Tiles take the page's tint, as on the page. */
function applyTint() {
	const t = tintProps(S.person?.accent ?? '');
	const b = document.body;
	for (const k of ['--t', '--ti', '--td', '--tid']) b.style.removeProperty(k);
	if (t) for (const [k, v] of Object.entries(t)) b.style.setProperty(k, v);
	b.toggleAttribute('data-tint', !!t);
}

const KIND_NAME: Record<NodeKind, string> = { group: 'group', link: 'link', text: 'text', diary: 'diary', support: 'support note' };

/** Today as a short date, YYMMDD. */
const today = () => new Date().toISOString().slice(2, 10).replace(/-/g, '');

const openDates = new Set<string>();

function rowHtml(n: ENode, depth: number, inDiary = false): string {
	const st = n.slug ? S.stats.get(n.slug) : undefined;
	const clicks = n.kind === 'link' && st ? `<span class="chip" title="Clicks in the last 30 days (all time ${st.total + n.seed})">${st.d30} in 30 days</span>` : '';
	const tile = `<button type="button" class="tile" data-act="icon" aria-label="Change the picture for ${esc(n.label)}">${tileHtml(n)}</button>`;
	let fields = `<input class="lbl" data-f="label" value="${esc(n.label)}" aria-label="Name" placeholder="Name">`;
	if (n.kind === 'link') fields += `<input class="url" data-f="url" value="${esc(n.url)}" aria-label="Web address" placeholder="https://" inputmode="url" spellcheck="false">`;
	if (n.kind === 'support')
		fields += `<textarea class="body" data-f="body" rows="3" aria-label="How you support AMYBO" placeholder="In your own words. Nobody needs to know about money: say only what you'd like to.">${esc(n.body)}</textarea>`;
	if (n.kind === 'text') fields += `<textarea class="body" data-f="body" rows="3" aria-label="Text" placeholder="Anything you'd like to say. Links work as they are, or [like this](https://…).">${esc(n.body)}</textarea>`;
	// Every item can carry a short date and a star. Both stay faint until set; the date field opens on the calendar.
	const dateOpen = !!n.day || openDates.has(n.key);
	const diaryBits =
		(dateOpen
			? `<input class="day" data-f="day" value="${esc(n.day)}" aria-label="Date: YY, YYMM or YYMMDD" placeholder="${today()}" inputmode="numeric" maxlength="6" title="Date: 26, 2608 or 260822">`
			: `<button type="button" class="cal" data-act="date" title="Add a date" aria-label="Add a date to ${esc(n.label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></button>`) +
		`<button type="button" class="star${n.highlight ? ' on' : ''}" data-act="star" aria-pressed="${!!n.highlight}" title="${n.highlight ? 'Starred: shown first in its group' : 'Star: show it first in its group'}">${n.highlight ? '★' : '☆'}</button>`;
	const holds = n.kind === 'group' || n.kind === 'diary';
	const twisty = holds
		? `<button type="button" class="tw${n.collapsed ? '' : ' open'}" data-act="fold" aria-expanded="${!n.collapsed}" aria-label="${n.collapsed ? 'Show' : 'Hide'} what's in ${esc(n.label)}"></button>`
		: '';
	const count = holds ? `<span class="chip">${[...walkE(n.children)].filter((c) => c.kind !== 'group').length}</span>` : '';
	const addText = n.kind === 'diary' ? '+ Add an entry' : '+ Add a link here';
	const kids = holds
		? `<ul class="kids"${n.collapsed ? ' hidden' : ''}>${n.children.map((c) => rowHtml(c, depth + 1, inDiary || n.kind === 'diary')).join('')}<li class="addin"><button type="button" class="ghost" data-act="add-in">${addText}</button></li></ul>`
		: '';
	return `<li class="row l-${n.kind}" data-key="${n.key}"><div class="rowin">
<span class="grip" draggable="true" aria-hidden="true" title="Drag to move"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>
${twisty}${tile}<div class="fields">${fields}</div>${diaryBits}${count}${clicks}
<button type="button" class="more" data-act="menu" aria-label="More for ${esc(n.label)}" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>
</div>${kids}</li>`;
}

function renderTree() {
	const ul = $('#tree');
	ul.innerHTML = S.tree.length ? S.tree.map((n) => rowHtml(n, 0)).join('') : `<li class="empty">Nothing here yet. Add your first link below.</li>`;
	const hasDiary = [...walkE(S.tree)].some((n) => n.kind === 'diary');
	const hasSupport = [...walkE(S.tree)].some((n) => n.kind === 'support');
	$('#add-diary').hidden = hasDiary;
	$('#add-support').hidden = hasSupport;
}

function renderProfile() {
	applyTint();
	const p = S.person!;
	$<HTMLInputElement>('#p-name').value = p.name;
	$<HTMLTextAreaElement>('#p-bio').value = p.bio;
	$('#p-count').textContent = `${p.bio.length}/300`;
	$('#p-photo').innerHTML = p.hub_icon
		? tileHtml({ icon: p.hub_icon, image: '', tint: p.hub_tint, zoom: p.hub_zoom, dk_linked: p.hub_dk_linked, dk_icon: p.hub_dk_icon, dk_tint: p.hub_dk_tint, dk_zoom: p.hub_dk_zoom })
		: p.photo
			? `<img src="${esc(mediaUrl(p.photo))}" alt="">`
			: `<span>${esc(p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span>`;
	$('#p-photo').classList.toggle('logo', p.kind === 'org');
	$('#addr').textContent = pageUrl();
	$<HTMLAnchorElement>('#view').href = p.handle === 'amybo' ? '/links' : `/~${p.handle}`;
	$<HTMLInputElement>('#s-map').checked = !p.basic_mode;
	$('#who').textContent = p.email;
	$<HTMLInputElement>('#s-tint').value = $<HTMLInputElement>('#s-tint-hex').value = p.accent || '#3f9c00';
	$('#s-tint-reset').hidden = !p.accent;
	$('#upload-note').hidden = S.uploads;
}


// ---------- event handling for the tree ----------

function onTreeInput(e: Event) {
	const t = e.target as HTMLInputElement;
	const row = t.closest<HTMLElement>('.row');
	if (!row || !t.dataset.f) return;
	const n = find(row.dataset.key!)!.node;
	if (t.dataset.f === 'day') {
		const v = t.value.replace(/\D/g, '').slice(0, 6);
		t.value = v;
		if (!/^(|\d{2}|\d{4}|\d{6})$/.test(v)) return; // waits until it's 2, 4 or 6 digits
		n.day = v;
		changed();
		return;
	}
	(n as unknown as Record<string, string>)[t.dataset.f] = t.value;
	if (t.dataset.f === 'url' && !n.image && (!n.icon || n.icon === 'globe' || n.icon === 'link')) {
		n.icon = guessIcon(t.value.trim());
		const tile = row.querySelector('.tile');
		if (tile) tile.innerHTML = tileHtml(n);
	}
	changed();
}

function closeMenus() {
	document.querySelectorAll('.menu').forEach((m) => m.remove());
}

function openMenu(btn: HTMLElement, n: ENode) {
	closeMenus();
	const f = find(n.key)!;
	const i = f.list.indexOf(n);
	const prev = f.list[i - 1];
	const items: [string, string, boolean][] = [
		['up', 'Move up', i > 0],
		['down', 'Move down', i < f.list.length - 1],
		['indent', `Move into "${prev?.label ?? ''}"`, prev?.kind === 'group' || prev?.kind === 'diary'],
		['outdent', 'Move out of this group', !!f.parent],
		['address', "Copy this item's address (paste it into another link to make an alias)", !!n.slug],
		['delete', `Delete this ${KIND_NAME[n.kind]}`, true],
	];
	const m = h(
		`<div class="menu" role="menu">${items
			.filter((x) => x[2])
			.map(([a, l]) => `<button type="button" role="menuitem" data-m="${a}"${a === 'delete' ? ' class="danger"' : ''}>${esc(l)}</button>`)
			.join('')}</div>`,
	);
	document.body.append(m);
	const r = btn.getBoundingClientRect();
	m.style.top = `${Math.min(r.bottom + 6 + scrollY, scrollY + innerHeight - m.offsetHeight - 10)}px`;
	m.style.left = `${Math.max(10, r.right - m.offsetWidth)}px`;
	(m.querySelector('button') as HTMLElement)?.focus();
	m.addEventListener('keydown', (e) => {
		const bs = [...m.querySelectorAll<HTMLElement>('button')];
		const k = bs.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') bs[(k + 1) % bs.length].focus();
		if (e.key === 'ArrowUp') bs[(k - 1 + bs.length) % bs.length].focus();
		if (e.key === 'Escape') {
			closeMenus();
			btn.focus();
		}
	});
	m.addEventListener('click', (e) => {
		const a = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
		if (!a) return;
		closeMenus();
		act(a, n);
	});
}

function act(a: string, n: ENode) {
	const f = find(n.key)!;
	const i = f.list.indexOf(n);
	if (a === 'up' && i > 0) [f.list[i - 1], f.list[i]] = [f.list[i], f.list[i - 1]];
	else if (a === 'down' && i < f.list.length - 1) [f.list[i + 1], f.list[i]] = [f.list[i], f.list[i + 1]];
	else if (a === 'indent') {
		const prev = f.list[i - 1];
		if (prev?.kind !== 'group' && prev?.kind !== 'diary') return;
		f.list.splice(i, 1);
		prev.children.push(n);
		prev.collapsed = false;
	} else if (a === 'outdent' && f.parent) {
		const pf = find(f.parent.key)!;
		f.list.splice(i, 1);
		pf.list.splice(pf.list.indexOf(f.parent) + 1, 0, n);
	} else if (a === 'address') {
		const url = `https://${pageUrl()}#${n.slug}`;
		navigator.clipboard?.writeText(url).then(
			() => toast('Address copied: paste it into a link to make an alias'),
			() => prompt('This item\'s address:', url),
		);
		return;
	} else if (a === 'delete') {
		const what = n.kind === 'group' && n.children.length ? `the group "${n.label}" and everything in it` : `"${n.label}"`;
		if (!confirm(`Delete ${what}?`)) return;
		f.list.splice(i, 1);
		toast(`Deleted ${n.label}`);
	}
	changed(true);
	requestAnimationFrame(() => document.querySelector<HTMLElement>(`.row[data-key="${n.key}"] ${keyboardMove ? '.lbl' : '.more'}`)?.focus());
	keyboardMove = false;
}
let keyboardMove = false;

/** Outliner keys in a row's name field: Tab and Shift+Tab move it into the group above or out of its group;
 * Option/Alt with the up and down arrows moves it among its neighbours; Enter starts a new item below it. */
function onTreeKey(e: KeyboardEvent) {
	const t = e.target as HTMLElement;
	if (!t.matches('.lbl')) return;
	const row = t.closest<HTMLElement>('.row');
	if (!row) return;
	const f = find(row.dataset.key!);
	if (!f) return;
	const n = f.node;
	let a = '';
	if (e.key === 'Tab') a = e.shiftKey ? 'outdent' : 'indent';
	else if (e.altKey && e.key === 'ArrowUp') a = 'up';
	else if (e.altKey && e.key === 'ArrowDown') a = 'down';
	else if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		const fresh: ENode = { key: newKey(), kind: 'text', label: '', url: '', icon: 'text', image: '', body: '', seed: 0, tint: '', zoom: 1, day: f.parent?.kind === 'diary' ? today() : '', highlight: 0, dk_linked: 1, dk_icon: '', dk_tint: '', dk_zoom: 1, children: [] };
		f.list.splice(f.list.indexOf(n) + 1, 0, fresh);
		changed(true);
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`.row[data-key="${fresh.key}"] .lbl`)?.focus());
		return;
	}
	if (!a) return;
	e.preventDefault();
	const i = f.list.indexOf(n);
	const prev = f.list[i - 1];
	if (a === 'indent' && prev?.kind !== 'group' && prev?.kind !== 'diary') {
		toast('Tab moves an item into the group just above it');
		return;
	}
	if (a === 'outdent' && !f.parent) return;
	keyboardMove = true;
	act(a, n);
}

// Drag and drop: drop on the top or bottom half of a row to go before or after it; on the middle of a group to go inside.
let dragKey: string | null = null;
function setupDrag() {
	const tree = $('#tree');
	// Rows can be dragged from anywhere except their text fields and buttons (so text can still be selected).
	tree.addEventListener('pointerdown', (e) => {
		const rowin = (e.target as HTMLElement).closest<HTMLElement>('.rowin');
		if (rowin) rowin.draggable = !(e.target as HTMLElement).closest('input,textarea,button');
	});
	tree.addEventListener('dragstart', (e) => {
		const row = (e.target as HTMLElement).closest?.('.row') as HTMLElement | null;
		if (!row || (e.target as HTMLElement).closest?.('input,textarea')) return;
		dragKey = row.dataset.key!;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', dragKey);
		const rowin = row.querySelector<HTMLElement>('.rowin')!;
		e.dataTransfer!.setDragImage(rowin, 24, rowin.offsetHeight / 2);
		requestAnimationFrame(() => row.classList.add('dragging'));
	});
	const clear = () => tree.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-in'));
	const where = (e: DragEvent) => {
		const rowin = (e.target as HTMLElement).closest<HTMLElement>('.rowin');
		const row = rowin?.parentElement;
		if (!rowin || !row || !dragKey || row.dataset.key === dragKey) return null;
		if (find(dragKey)!.node && row.closest(`.row[data-key="${dragKey}"]`)) return null; // not into itself
		const r = rowin.getBoundingClientRect();
		const y = (e.clientY - r.top) / r.height;
		const group = row.classList.contains('l-group') || row.classList.contains('l-diary');
		const pos = group && y > 0.3 && y < 0.7 ? 'in' : y < 0.5 ? 'before' : 'after';
		return { row, rowin, pos };
	};
	tree.addEventListener('dragover', (e) => {
		const w = where(e);
		clear();
		if (!w) return;
		e.preventDefault();
		w.rowin.classList.add(`drop-${w.pos}`);
	});
	tree.addEventListener('dragleave', (e) => {
		if (!(e.relatedTarget as HTMLElement)?.closest?.('#tree')) clear();
	});
	tree.addEventListener('drop', (e) => {
		const w = where(e);
		clear();
		if (!w || !dragKey) return;
		e.preventDefault();
		const moving = find(dragKey)!;
		moving.list.splice(moving.list.indexOf(moving.node), 1);
		const target = find(w.row.dataset.key!)!;
		if (w.pos === 'in') {
			target.node.children.unshift(moving.node);
			target.node.collapsed = false;
		} else target.list.splice(target.list.indexOf(target.node) + (w.pos === 'after' ? 1 : 0), 0, moving.node);
		dragKey = null;
		changed(true);
	});
	tree.addEventListener('dragend', () => {
		dragKey = null;
		clear();
		tree.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
	});
}

// ---------- pictures: icons, suggested images and uploads ----------

interface Crop {
	/** 1 = the picture just covers the circle; more zooms in. */
	zoom: number;
	/** Shift of the picture's centre, as a fraction of the circle's width. */
	dx: number;
	dy: number;
}

/** Lets the person choose which part of a picture shows in its circle: drag to move it, slide or scroll to zoom.
 * Resolves with the crop, or null if they cancel. */
function chooseCrop(img: HTMLImageElement): Promise<Crop | null> {
	return new Promise((resolve) => {
		const dlg = h(`<dialog class="cropper" aria-label="Choose the part of the picture to show">
			<h2>Choose what shows</h2>
			<div class="cropbox"><img alt="" draggable="false"></div>
			<label class="field"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"></label>
			<div class="actions"><button type="button" class="ghost" data-x="cancel">Cancel</button><button type="button" class="primary" data-x="ok">Use this</button></div>
		</dialog>`) as HTMLDialogElement;
		document.body.append(dlg);
		const box = dlg.querySelector<HTMLElement>('.cropbox')!;
		const pic = dlg.querySelector<HTMLImageElement>('img')!;
		const zoom = dlg.querySelector<HTMLInputElement>('input')!;
		pic.src = img.src;
		const w = img.naturalWidth || 1;
		const hh = img.naturalHeight || 1;
		const c: Crop = { zoom: 1, dx: 0, dy: 0 };
		// Keep the picture covering the circle wherever it's moved.
		const clamp = () => {
			const k = c.zoom / Math.min(w, hh);
			const maxX = Math.max(0, (w * k - 1) / 2);
			const maxY = Math.max(0, (hh * k - 1) / 2);
			c.dx = Math.min(maxX, Math.max(-maxX, c.dx));
			c.dy = Math.min(maxY, Math.max(-maxY, c.dy));
		};
		const draw = () => {
			clamp();
			const side = box.clientWidth;
			const k = (c.zoom * side) / Math.min(w, hh);
			pic.style.width = `${w * k}px`;
			pic.style.height = `${hh * k}px`;
			pic.style.left = `${side / 2 - (w * k) / 2 + c.dx * side}px`;
			pic.style.top = `${side / 2 - (hh * k) / 2 + c.dy * side}px`;
		};
		let drag: { x: number; y: number; dx: number; dy: number } | null = null;
		box.onpointerdown = (e) => {
			box.setPointerCapture(e.pointerId);
			drag = { x: e.clientX, y: e.clientY, dx: c.dx, dy: c.dy };
		};
		box.onpointermove = (e) => {
			if (!drag) return;
			c.dx = drag.dx + (e.clientX - drag.x) / box.clientWidth;
			c.dy = drag.dy + (e.clientY - drag.y) / box.clientWidth;
			draw();
		};
		box.onpointerup = box.onpointercancel = () => (drag = null);
		box.onwheel = (e) => {
			e.preventDefault();
			c.zoom = Math.min(4, Math.max(1, c.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
			zoom.value = String(c.zoom);
			draw();
		};
		box.tabIndex = 0;
		box.onkeydown = (e) => {
			const step = 0.02;
			const m: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
			if (!m[e.key]) return;
			e.preventDefault();
			c.dx += m[e.key][0];
			c.dy += m[e.key][1];
			draw();
		};
		zoom.oninput = () => {
			c.zoom = Number(zoom.value);
			draw();
		};
		const end = (v: Crop | null) => {
			dlg.close();
			dlg.remove();
			resolve(v);
		};
		dlg.onclick = (e) => {
			const x = (e.target as HTMLElement).closest<HTMLElement>('[data-x]')?.dataset.x;
			if (x) end(x === 'ok' ? { ...c } : null);
		};
		dlg.oncancel = (e) => {
			e.preventDefault();
			end(null);
		};
		dlg.showModal();
		requestAnimationFrame(draw);
		box.focus();
	});
}

async function toWebp(blob: Blob, size: number, cover = true): Promise<Blob> {
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		const w = img.naturalWidth || size;
		const hgt = img.naturalHeight || size;
		// A photo for a circle: the person picks the part that shows.
		const crop = cover ? await chooseCrop(img) : { zoom: 1, dx: 0, dy: 0 };
		if (!crop) throw new Error('');
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const g = c.getContext('2d')!;
		const s = (cover ? Math.max(size / w, size / hgt) : Math.min(size / w, size / hgt)) * crop.zoom;
		g.imageSmoothingQuality = 'high';
		g.drawImage(img, (size - w * s) / 2 + crop.dx * size, (size - hgt * s) / 2 + crop.dy * size, w * s, hgt * s);
		const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.86));
		if (out && out.type === 'image/webp') return out;
		return await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function uploadBlob(blob: Blob, size: number, cover = true): Promise<string> {
	const small = await toWebp(blob, size, cover);
	const r = await api<{ value: string }>('upload', { raw: small });
	return r.value;
}

async function fromRemote(url: string, size: number, cover = true): Promise<string> {
	const res = await fetch(`/api/links/remote-image?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
	if (!res.ok) throw new Error('Could not fetch that picture');
	return uploadBlob(await res.blob(), size, cover);
}

interface Proposal {
	url: string;
	title: string;
	icon: string;
	image?: string;
	favicon?: string;
}

type Mode = 'light' | 'dark';
const MODE_COLOURS = {
	light: { bg: '#f6f8f4', node: '#ffffff', line: '#d8e2cf', ink: '#16210f', accent: '#1d6b00' },
	dark: { bg: '#0b1208', node: '#142010', line: '#24361d', ink: '#e6f0df', accent: '#b7e27c' },
};

const lum = (hex: string) => {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
};

/** Exactly how a picture looks on the page in one mode: page background, the node's circle, and its picture with the
 * same colour rules the page uses (brand colours adjusted for the background, logos inverted for dark when linked). */
function previewSvg(n: ENode, mode: Mode): string {
	const c = MODE_COLOURS[mode];
	const own = mode === 'dark' && n.dk_linked === 0;
	const key = (own ? n.dk_icon : '') || n.icon || (n.kind === 'diary' ? 'diary' : n.kind === 'support' ? 'heart' : n.kind === 'text' ? 'text' : n.kind === 'group' ? 'folder' : 'link');
	const tint = own ? n.dk_tint : n.tint;
	const z = Math.min(2.4, Math.max(0.6, (own ? n.dk_zoom : n.zoom) || 1));
	const r = 22;
	const id = `pv${mode}${Math.random().toString(36).slice(2, 7)}`;
	const single = tint === 'mono' ? c.ink : /^#[0-9a-f]{6}$/i.test(tint) ? tint : '';
	let pic = '';
	if (n.image) {
		pic = `<clipPath id="${id}c"><circle cx="32" cy="32" r="${r - 1.5}"/></clipPath><image href="${esc(mediaUrl(n.image))}" x="${32 - r * z}" y="${32 - r * z}" width="${2 * r * z}" height="${2 * r * z}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>`;
	} else {
		const i = icon(key);
		if (i.logo) {
			const l = i.logo;
			const bg = l.bg ? `<circle cx="32" cy="32" r="${r - 1}" fill="${l.bg}"/>` : '';
			if (l.cover) {
				const s2 = (r * 2 - 3) * z;
				pic = `<clipPath id="${id}c"><circle cx="32" cy="32" r="${r - 1.5}"/></clipPath><image href="${esc(l.src)}" x="${32 - s2 / 2}" y="${32 - s2 / 2}" width="${s2}" height="${s2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>`;
			} else {
				const w = r * (l.scale ?? 1.3) * z;
				const filt = single
					? `<filter id="${id}f" color-interpolation-filters="sRGB"><feFlood flood-color="${single}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`
					: '';
				const style = !single && l.invert && mode === 'dark' && !own ? ' style="filter:invert(1) hue-rotate(180deg) brightness(1.15)"' : '';
				pic = `${filt}${bg}<image href="${esc(l.src)}" x="${32 - w / 2}" y="${32 - w / 2}" width="${w}" height="${w}" preserveAspectRatio="xMidYMid meet"${single ? ` filter="url(#${id}f)"` : ''}${style}/>`;
			}
		} else {
			const s2 = r * 1.05 * z;
			let colour = single;
			if (!colour) {
				if (i.brand && i.hex) {
					const L = lum(i.hex);
					colour = mode === 'light' ? (L > 0.55 ? c.ink : `#${i.hex}`) : L < 0.12 ? c.ink : `#${i.hex}`;
				} else colour = c.accent;
			}
			const paint = i.brand ? `fill="${colour}"` : `fill="none" stroke="${colour}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
			pic = `<svg x="${32 - s2 / 2}" y="${32 - s2 / 2}" width="${s2}" height="${s2}" viewBox="0 0 24 24" ${paint}>${i.svg.replace(/fill="currentColor"/g, `fill="${colour}"`)}</svg>`;
		}
	}
	return `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="${c.bg}"/><circle cx="32" cy="32" r="${r}" fill="${c.node}" stroke="${c.line}" stroke-width="1.5"/>${pic}</svg>`;
}

/** The picture dialog. Light and dark each show live; click one to edit it. The chain between them links dark to
 * light; unlinking gives dark its own picture, colour and size, and relinking keeps those for next time. */
function pickPicture(n: ENode, suggestions: Proposal | null = null, onChange: () => void = () => changed(true), uploadSize = 256): Promise<void> {
	return new Promise((resolve) => {
		const dlg = $<HTMLDialogElement>('#picker');
		const grid = $('#icon-grid', dlg);
		const search = $<HTMLInputElement>('#icon-search', dlg);
		const sug = $('#suggested', dlg);
		$('#picker-title', dlg).textContent = `Picture for "${n.label || 'this link'}"`;
		let mode: Mode = 'light';
		const own = () => mode === 'dark' && n.dk_linked === 0;
		// Values for the mode being edited.
		const cur = () => (own() ? { icon: n.dk_icon || n.icon, tint: n.dk_tint, zoom: n.dk_zoom } : { icon: n.icon, tint: n.tint, zoom: n.zoom });
		const unlink = () => {
			if (n.dk_linked === 0) return;
			n.dk_linked = 0;
			// First time apart: dark starts as a copy of light. Later, it keeps what was chosen for it.
			if (!n.dk_icon && !n.dk_tint && (n.dk_zoom || 1) === 1) {
				n.dk_icon = n.icon;
				n.dk_tint = n.tint;
				n.dk_zoom = n.zoom;
			}
		};
		const set = (patch: { icon?: string; tint?: string; zoom?: number }) => {
			if (mode === 'dark') {
				unlink();
				if (patch.icon !== undefined) n.dk_icon = patch.icon;
				if (patch.tint !== undefined) n.dk_tint = patch.tint;
				if (patch.zoom !== undefined) n.dk_zoom = patch.zoom;
			} else Object.assign(n, patch);
		};
		const drawModes = () => {
			$('#pv-light', dlg).innerHTML = previewSvg(n, 'light');
			$('#pv-dark', dlg).innerHTML = previewSvg(n, 'dark');
			dlg.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
			const chain = $('#chain', dlg);
			chain.setAttribute('aria-pressed', String(n.dk_linked !== 0));
			chain.title = n.dk_linked !== 0 ? 'Light and dark are linked: dark follows light. Click to give dark its own.' : 'Dark has its own picture. Click to link it to light again (its own choices are kept).';
			chain.classList.toggle('broken', n.dk_linked === 0);
		};
		const drawGrid = () => {
			const q = search.value.trim().toLowerCase();
			const c = cur();
			grid.innerHTML = S.icons
				.filter((k) => !q || k.includes(q) || icon(k).title.toLowerCase().includes(q))
				.slice(0, 160)
				.map((k) => `<button type="button" class="ichoice${!n.image && c.icon === k ? ' on' : ''}" data-icon="${esc(k)}" title="${esc(icon(k).title)}">${tileHtml({ icon: k, image: '', tint: c.tint })}</button>`)
				.join('');
		};
		const colour = $<HTMLInputElement>('#tint-colour', dlg);
		const hex = $<HTMLInputElement>('#tint-hex', dlg);
		const textBtn = $<HTMLInputElement>('#tint-text', dlg);
		const zoom = $<HTMLInputElement>('#pick-zoom', dlg);
		const syncControls = () => {
			const c = cur();
			const logo = !n.image ? icon(c.icon).logo : undefined;
			const canSingle = !n.image && !(logo && logo.cover);
			$('#tint-single-wrap', dlg).hidden = !canSingle;
			$('.pickstyle', dlg).hidden = !!n.image;
			for (const r of dlg.querySelectorAll<HTMLInputElement>('input[name="tint"]')) r.checked = r.value === (canSingle && c.tint ? 'single' : 'orig');
			const fixed = /^#[0-9a-f]{6}$/i.test(c.tint);
			colour.value = hex.value = fixed ? c.tint : '#3f9c00';
			textBtn.checked = c.tint === 'mono' || !fixed;
			zoom.value = String(c.zoom || 1);
		};
		const refresh = () => {
			drawModes();
			drawGrid();
			onChange();
		};
		const restyle = () => {
			const single = dlg.querySelector<HTMLInputElement>('input[name="tint"]:checked')?.value === 'single';
			set({ tint: !single ? '' : textBtn.checked ? 'mono' : /^#[0-9a-f]{6}$/i.test(hex.value) ? hex.value.toLowerCase() : 'mono', zoom: Number(zoom.value) || 1 });
			refresh();
		};
		const pickSingle = () => ((dlg.querySelector('input[name="tint"][value="single"]') as HTMLInputElement).checked = true);
		dlg.querySelectorAll<HTMLInputElement>('input[name="tint"]').forEach((r) => (r.onchange = restyle));
		textBtn.onchange = () => {
			pickSingle();
			restyle();
		};
		colour.oninput = () => {
			hex.value = colour.value;
			textBtn.checked = false;
			pickSingle();
			restyle();
		};
		hex.oninput = () => {
			if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
			colour.value = hex.value;
			textBtn.checked = false;
			pickSingle();
			restyle();
		};
		zoom.oninput = restyle;

		search.value = '';
		const guess = guessIcon(n.url);
		const sugg: string[] = [`<button type="button" class="sugg" data-icon="${esc(guess)}">${tileHtml({ icon: guess, image: '' })}<span>${esc(icon(guess).title)} icon</span></button>`];
		if (S.uploads && suggestions?.favicon) sugg.push(`<button type="button" class="sugg" data-remote="${esc(suggestions.favicon)}" data-fit="1"><img src="/api/links/remote-image?url=${encodeURIComponent(suggestions.favicon)}" alt=""><span>The site's icon</span></button>`);
		if (S.uploads && suggestions?.image) sugg.push(`<button type="button" class="sugg" data-remote="${esc(suggestions.image)}"><img src="/api/links/remote-image?url=${encodeURIComponent(suggestions.image)}" alt=""><span>The site's picture</span></button>`);
		sug.innerHTML = sugg.join('');
		$('#pick-upload', dlg).hidden = !S.uploads;
		syncControls();
		drawModes();
		drawGrid();

		const finish = () => {
			dlg.close();
			resolve();
		};
		dlg.onclick = async (e: Event) => {
			const b = (e.target as HTMLElement).closest<HTMLElement>('button');
			if (!b) return;
			if (b.dataset.mode) {
				mode = b.dataset.mode as Mode;
				syncControls();
				drawModes();
				drawGrid();
			} else if (b.id === 'chain') {
				if (n.dk_linked === 0) n.dk_linked = 1;
				else unlink();
				syncControls();
				refresh();
			} else if (b.dataset.icon) {
				set({ icon: b.dataset.icon });
				if (mode === 'light') n.image = '';
				syncControls();
				refresh();
			} else if (b.dataset.remote) {
				b.classList.add('busy');
				try {
					n.image = await fromRemote(b.dataset.remote, 256, !b.dataset.fit);
					syncControls();
					refresh();
				} catch (err) {
					toast((err as Error).message, 'err');
				}
				b.classList.remove('busy');
			} else if (b.id === 'pick-close' || b.id === 'pick-done') finish();
		};
		$<HTMLInputElement>('#pick-file', dlg).onchange = async (e: Event) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			try {
				n.image = await uploadBlob(file, uploadSize);
				syncControls();
				refresh();
			} catch (err) {
				toast((err as Error).message, 'err');
			}
		};
		search.oninput = drawGrid;
		dlg.onclose = () => resolve();
		dlg.showModal();
		search.focus();
	});
}

// ---------- adding things ----------

function addLink(into: ENode | null) {
	const dlg = $<HTMLDialogElement>('#adder');
	const url = $<HTMLInputElement>('#a-url', dlg);
	const name = $<HTMLInputElement>('#a-name', dlg);
	const tile = $('#a-tile', dlg);
	const hint = $('#a-hint', dlg);
	let prop: Proposal | null = null;
	const n: ENode = { key: newKey(), kind: 'link', label: '', url: '', icon: 'link', image: '', body: '', seed: 0, tint: '', zoom: 1, day: '', highlight: 0, dk_linked: 1, dk_icon: '', dk_tint: '', dk_zoom: 1, children: [] };
	url.value = '';
	name.value = '';
	tile.innerHTML = tileHtml(n);
	hint.textContent = 'Paste a web address and we will suggest a name and picture. Or leave it empty and just give a name, for some text instead of a link.';
	let seq = 0;
	const look = async () => {
		let v = url.value.trim();
		if (v && !/^[a-z]+:/i.test(v)) v = v.includes('@') && !v.includes('/') ? `mailto:${v}` : `https://${v}`;
		n.url = v;
		n.icon = guessIcon(v);
		tile.innerHTML = tileHtml(n);
		const own = new RegExp(`/(~${S.person!.handle}|links)/?#([a-z0-9-]+)$`, 'i').exec(v);
		const original = own ? [...walkE(S.tree)].find((x) => x.slug === own[2]) : undefined;
		if (original) {
			if (!name.value || name.dataset.auto) {
				name.value = original.label;
				name.dataset.auto = '1';
			}
			n.icon = original.icon;
			tile.innerHTML = tileHtml(n);
			hint.textContent = `An alias: it will take visitors to "${original.label}" on your page.`;
			return;
		}
		if (!/^(https?:\/\/[^\s.]+\.[^\s]+|mailto:\S+@\S+)$/i.test(v)) return;
		const mine = ++seq;
		hint.textContent = 'Looking…';
		try {
			const p = await api<Proposal>(`propose?url=${encodeURIComponent(v)}`);
			if (mine !== seq) return;
			prop = p;
			if (!name.value || name.dataset.auto) {
				name.value = p.title;
				name.dataset.auto = '1';
			}
			n.icon = p.icon || n.icon;
			tile.innerHTML = tileHtml(n);
			hint.textContent = S.uploads && (p.image || p.favicon) ? 'Tap the picture to use one from the site instead.' : '';
		} catch {
			if (mine === seq) hint.textContent = '';
		}
	};
	let t = 0;
	url.oninput = () => {
		clearTimeout(t);
		t = window.setTimeout(look, 450);
	};
	name.oninput = () => delete name.dataset.auto;
	$('#a-tile', dlg).onclick = async () => {
		n.label = name.value || 'this link';
		await pickPicture(n, prop);
		tile.innerHTML = tileHtml(n);
		dlg.showModal();
	};
	$<HTMLFormElement>('#a-form', dlg).onsubmit = (e) => {
		e.preventDefault();
		if (!n.url) {
			// A name with no address is a text item: something to say rather than somewhere to go.
			if (!name.value.trim()) {
				name.focus();
				return;
			}
			n.kind = 'text';
			if (n.icon === 'link' || n.icon === 'globe') n.icon = 'text';
		}
		n.label = name.value.trim() || prop?.title || hostLine(n.url);
		if (into?.kind === 'diary') n.day = today(); // a new diary entry is dated today; change it in its row
		(into ? into.children : S.tree).push(n);
		if (into) into.collapsed = false;
		dlg.close();
		changed(true);
		toast(`Added ${n.label}`);
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`.row[data-key="${n.key}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
	};
	$('#a-cancel', dlg).onclick = () => dlg.close();
	dlg.showModal();
	url.focus();
}

function addSpecial(kind: 'group' | 'text' | 'diary' | 'support') {
	const labels = { group: 'New group', text: 'New text', diary: 'AMYBO diary', support: 'How I support AMYBO' };
	const icons = { group: '', text: 'text', diary: 'diary', support: 'heart' };
	const n: ENode = { key: newKey(), kind, label: labels[kind], url: '', icon: icons[kind], image: '', body: '', seed: 0, tint: '', zoom: 1, day: '', highlight: 0, dk_linked: 1, dk_icon: '', dk_tint: '', dk_zoom: 1, children: [] };
	S.tree.push(n);
	changed(true);
	requestAnimationFrame(() => {
		const inp = document.querySelector<HTMLInputElement>(`.row[data-key="${n.key}"] .lbl`);
		inp?.focus();
		inp?.select();
	});
}

// ---------- sign-in ----------

function show(view: 'signin' | 'sent' | 'editor' | 'loading' | 'confirm') {
	for (const v of ['signin', 'sent', 'editor', 'loading', 'confirm']) $(`#v-${v}`).hidden = v !== view;
	document.body.dataset.view = view;
}

function showSignIn(message = '') {
	$('#signin-msg').textContent = message;
	show('signin');
}

async function load() {
	show('loading');
	let me: MeResponse;
	try {
		me = await api<MeResponse>('me');
	} catch {
		showSignIn();
		return;
	}
	S.person = me.person;
	S.uploads = me.uploads;
	S.icons = me.icons;
	S.stats = new Map(me.stats.map((s) => [s.slug, s]));
	const tree = buildTree(me.nodes as Omit<LinkNode, 'children'>[]);
	const conv = (n: LinkNode): ENode => ({ key: newKey(), id: n.id, slug: n.slug, kind: n.kind, label: n.label, url: n.url, savedUrl: n.url, icon: n.icon, image: n.image, body: n.body, seed: n.seed, tint: n.tint || '', zoom: n.zoom || 1, day: n.day || '', highlight: n.highlight || 0, dk_linked: n.dk_linked ?? 1, dk_icon: n.dk_icon || '', dk_tint: n.dk_tint || '', dk_zoom: n.dk_zoom || 1, children: n.children.map(conv) });
	S.tree = tree.map(conv);
	renderProfile();
	renderTree();
	show('editor');
	lastSnap = snapshot();
	remember();
	status('All changes saved', 'ok');
	preview();
}

function init() {
	// Sign-in links carry their token after # so it never reaches a server log; it is swapped for a session here.
	const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash);
	history.replaceState(null, '', location.pathname);
	if (m) {
		// Say whose page the link is for, and only sign in when they confirm it.
		show('loading');
		api<{ handle: string; name: string }>('verify', { body: { token: m[1], peek: true } }).then(
			(who) => {
				$('#confirm-who').textContent = who.handle === 'amybo' ? 'amy.bo/links' : `amy.bo/~${who.handle}`;
				$('#confirm-name').textContent = who.name;
				show('confirm');
				$<HTMLButtonElement>('#confirm-go').onclick = () => api('verify', { body: { token: m[1] } }).then(load, (e) => showSignIn((e as Error).message));
				$<HTMLButtonElement>('#confirm-no').onclick = () => showSignIn('');
			},
			(e) => showSignIn((e as Error).message),
		);
	} else load();

	$<HTMLFormElement>('#signin-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const email = $<HTMLInputElement>('#signin-email').value;
		const b = $<HTMLButtonElement>('#signin-form button');
		b.disabled = true;
		try {
			await api('signin', { body: { email } });
			$('#sent-to').textContent = email;
			show('sent');
		} catch (err) {
			$('#signin-msg').textContent = (err as Error).message;
		} finally {
			b.disabled = false;
		}
	});
	$('#sent-again').addEventListener('click', () => show('signin'));

	// profile
	$('#p-name').addEventListener('input', (e) => {
		S.person!.name = (e.target as HTMLInputElement).value;
		preview();
		later('profile', saveProfile);
	});
	$('#p-bio').addEventListener('input', (e) => {
		S.person!.bio = (e.target as HTMLTextAreaElement).value.slice(0, 300);
		$('#p-count').textContent = `${S.person!.bio.length}/300`;
		preview();
		later('profile', saveProfile);
	});
	$('#p-photo').addEventListener('click', async () => {
		// The centre has the same picture options as any item: a photo, an icon or a logo, a colour and a size.
		const p = S.person!;
		const proxy: ENode = { key: 'hub', kind: 'link', label: p.name, url: '', icon: p.hub_icon, image: p.hub_icon ? '' : p.photo, body: '', seed: 0, tint: p.hub_tint, zoom: p.hub_zoom || 1, day: '', highlight: 0, dk_linked: 1, dk_icon: '', dk_tint: '', dk_zoom: 1, children: [] };
		await pickPicture(proxy, null, () => {
			if (proxy.image) {
				p.photo = proxy.image;
				p.hub_icon = '';
			} else p.hub_icon = proxy.icon;
			p.hub_tint = proxy.tint;
			p.hub_zoom = proxy.zoom;
			p.hub_dk_linked = proxy.dk_linked;
			p.hub_dk_icon = proxy.dk_icon;
			p.hub_dk_tint = proxy.dk_tint;
			p.hub_dk_zoom = proxy.dk_zoom;
			renderProfile();
			preview();
			later('profile', saveProfile, 300);
		}, p.kind === 'org' ? 512 : 384);
	});
	$('#p-file').addEventListener('change', async (e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		status('Uploading…', 'busy');
		try {
			S.person!.photo = await uploadBlob(file, S.person!.kind === 'org' ? 512 : 384, S.person!.kind !== 'org');
			renderProfile();
			preview();
			await saveProfile();
			status('Saved', 'ok');
		} catch (err) {
			status('Not saved', 'err');
			toast((err as Error).message, 'err');
		}
	});
	$('#s-map').addEventListener('change', (e) => {
		S.person!.basic_mode = (e.target as HTMLInputElement).checked ? 0 : 1;
		preview();
		later('profile', saveProfile, 0);
	});
	$('#copy').addEventListener('click', async () => {
		await navigator.clipboard?.writeText(`https://${pageUrl()}`);
		toast('Address copied');
	});
	$('#signout').addEventListener('click', async () => {
		await api('signout', { body: {} }).catch(() => {});
		for (const t of timers.values()) clearTimeout(t);
		timers.clear();
		S.person = null;
		showSignIn('Signed out.');
	});

	// tree
	const tree = $('#tree');
	tree.addEventListener('input', onTreeInput);
	tree.addEventListener('keydown', onTreeKey);
	document.head.append(Object.assign(document.createElement('style'), { textContent: TILE_CSS }));
	addEventListener('keydown', (e) => {
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || document.querySelector('dialog[open]')) return;
		// In a text field, the field's own undo comes first; outside one, the whole editor's.
		if ((e.target as HTMLElement).closest('input,textarea') && !e.altKey) return;
		e.preventDefault();
		e.shiftKey ? redo() : undo();
	});
	tree.addEventListener('click', (e) => {
		const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
		const row = b?.closest<HTMLElement>('.row');
		if (!b || !row) return;
		const n = find(row.dataset.key!)!.node;
		const a = b.dataset.act;
		if (a === 'fold') {
			n.collapsed = !n.collapsed;
			renderTree();
		} else if (a === 'menu') openMenu(b, n);
		else if (a === 'icon') pickPicture(n);
		else if (a === 'add-in') addLink(n);
		else if (a === 'date') {
			openDates.add(n.key);
			if (!n.day) n.day = '';
			renderTree();
			requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`.row[data-key="${n.key}"] .day`)?.focus());
		} else if (a === 'star') {
			n.highlight = n.highlight ? 0 : 1;
			changed(true);
		}
	});
	setupDrag();
	document.addEventListener('click', (e) => {
		if (!(e.target as HTMLElement).closest('.menu,[data-act="menu"]')) closeMenus();
	});
	$('#add-link').addEventListener('click', () => addLink(null));
	$('#undo').addEventListener('click', undo);
	$('#help-open').addEventListener('click', () => $<HTMLDialogElement>('#help').showModal());
	$('#help-close').addEventListener('click', () => $<HTMLDialogElement>('#help').close());
	$('#redo').addEventListener('click', redo);
	$('#add-group').addEventListener('click', () => addSpecial('group'));
	$('#add-diary').addEventListener('click', () => addSpecial('diary'));
	$('#add-support').addEventListener('click', () => addSpecial('support'));
	$('#add-text').addEventListener('click', () => addSpecial('text'));
	// The page's tint.
	const setTint = (v: string) => {
		S.person!.accent = v;
		$<HTMLInputElement>('#s-tint').value = $<HTMLInputElement>('#s-tint-hex').value = v || '#3f9c00';
		$('#s-tint-reset').hidden = !v;
		applyTint();
		renderTree();
		preview();
		later('profile', saveProfile, 300);
	};
	$('#s-tint').addEventListener('input', (e) => setTint((e.target as HTMLInputElement).value.toLowerCase()));
	$('#s-tint-hex').addEventListener('input', (e) => {
		const v = (e.target as HTMLInputElement).value.trim();
		if (/^#[0-9a-f]{6}$/i.test(v)) setTint(v.toLowerCase());
	});
	$('#s-tint-reset').addEventListener('click', () => setTint(''));

	// phone: switch between editing and the preview
	document.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach((b) =>
		b.addEventListener('click', () => {
			document.body.dataset.pane = b.dataset.pane;
			document.querySelectorAll('[data-pane]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
		}),
	);
	addEventListener('beforeunload', (e) => {
		if (['Editing…', 'Saving…', 'Not saved'].includes($('#savestate').textContent ?? '')) e.preventDefault();
	});
}

let profileSaving: Promise<void> | null = null;
async function saveProfile() {
	record();
	// One at a time, each sending the latest state, so an older save can never land after a newer one.
	const send = async () => {
		const p = S.person;
		if (!p) return;
		await api('profile', { method: 'PUT', body: { name: p.name, bio: p.bio, photo: p.photo, basic_mode: !!p.basic_mode, diary_default: p.diary_default, accent: p.accent, hub_icon: p.hub_icon, hub_tint: p.hub_tint, hub_zoom: p.hub_zoom, hub_dk_linked: p.hub_dk_linked, hub_dk_icon: p.hub_dk_icon, hub_dk_tint: p.hub_dk_tint, hub_dk_zoom: p.hub_dk_zoom } });
	};
	profileSaving = (profileSaving ?? Promise.resolve()).catch(() => {}).then(send);
	await profileSaving;
}

init();
