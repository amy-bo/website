// The link-page editor (/links/edit/): sign in by emailed link, then edit your page with a live preview.
// Plain DOM, no framework. State is a tree; every change re-renders the affected part and autosaves.
import { guessIcon, icon } from './icons';
import { type DiaryEntry, type LinkNode, type NodeKind, type PageData, buildTree } from './model';
import { esc, hostLine, renderPage } from './render';

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
}

interface MeResponse {
	person: Person;
	nodes: (Omit<LinkNode, 'children'> & { parent_id: number | null })[];
	diary: DiaryEntry[];
	stats: { slug: string; total: number; d30: number }[];
	uploads: boolean;
	icons: string[];
}

const S = {
	person: null as Person | null,
	tree: [] as ENode[],
	diary: [] as DiaryEntry[],
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
			out.push({ id: n.id, key: n.key, parent, kind: n.kind, label: n.label.trim() || 'Untitled', url, icon: n.icon, image: n.image, body: n.body } as never);
			add(n.children, n.key);
		});
	add(S.tree, null);
	return { nodes: out, pending };
};

let saving: Promise<void> | null = null;
async function saveNodes() {
	const send = async () => {
		const { nodes, pending } = flatten();
		const r = await api<{ ids: Record<string, number> }>('nodes', { method: 'PUT', body: { nodes } });
		const sent = new Map(nodes.map((x) => [x.key, x.url]));
		for (const n of walkE(S.tree)) {
			if (r.ids[n.key] != null) n.id = r.ids[n.key];
			if (n.kind === 'link' && sent.has(n.key) && validUrl(n.url)) n.savedUrl = n.url.trim();
		}
		if (pending.length) throw new Error(`Saved, except the address for "${pending[0]}": it needs to start https://`);
	};
	// One save at a time, so new items never get created twice.
	saving = (saving ?? Promise.resolve()).catch(() => {}).then(send);
	await saving;
}
const changed = (structural = false) => {
	if (structural) renderTree();
	preview();
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
				children: n.children.map((c) => toLink(c, myId)),
			};
		};
		const data: PageData = {
			person: { id: 0, ...S.person, basic_mode: S.person.basic_mode },
			roots: S.tree.map((n) => toLink(n, null)),
			diaryCount: S.diary.length,
			highlightCount: S.diary.filter((d) => d.highlight).length,
		};
		// The preview is sandboxed (its own origin), so its scroll position can't be read; just redraw it.
		$<HTMLIFrameElement>('#preview').srcdoc = renderPage(data, { preview: true });
	}, 250);
}

// ---------- rendering the editor ----------

const tileHtml = (n: { icon: string; image: string; kind?: NodeKind }) => {
	if (n.image) return `<img src="${esc(mediaUrl(n.image))}" alt="">`;
	const key = n.icon || (n.kind === 'diary' ? 'diary' : n.kind === 'support' ? 'heart' : n.kind === 'group' ? 'folder' : 'link');
	const i = icon(key);
	if (i.logo) return `<img src="${esc(i.logo.src)}" alt="" class="${i.logo.cover ? 'cover' : 'fit'}${i.logo.invert ? ' inv' : ''}">`;
	return `<svg viewBox="0 0 24 24" class="${i.brand ? 'ib' : 'il'}" aria-hidden="true"${i.brand && i.hex ? ` style="--brand:#${i.hex}"` : ''}>${i.svg}</svg>`;
};

const KIND_NAME: Record<NodeKind, string> = { group: 'group', link: 'link', diary: 'diary', support: 'support note' };

function rowHtml(n: ENode, depth: number): string {
	const st = n.slug ? S.stats.get(n.slug) : undefined;
	const clicks = n.kind === 'link' && st ? `<span class="chip" title="Clicks in the last 30 days (all time ${st.total + n.seed})">${st.d30} in 30 days</span>` : '';
	const tile = n.kind === 'group' ? '' : `<button type="button" class="tile" data-act="icon" aria-label="Change the picture for ${esc(n.label)}">${tileHtml(n)}</button>`;
	let fields = `<input class="lbl" data-f="label" value="${esc(n.label)}" aria-label="Name" placeholder="Name">`;
	if (n.kind === 'link') fields += `<input class="url" data-f="url" value="${esc(n.url)}" aria-label="Web address" placeholder="https://" inputmode="url" spellcheck="false">`;
	if (n.kind === 'support')
		fields += `<textarea class="body" data-f="body" rows="3" aria-label="How you support AMYBO" placeholder="In your own words. Nobody needs to know about money: say only what you'd like to.">${esc(n.body)}</textarea>`;
	if (n.kind === 'diary') fields += `<span class="sub">${S.diary.length} ${S.diary.length === 1 ? 'entry' : 'entries'} · write them below</span>`;
	const twisty =
		n.kind === 'group'
			? `<button type="button" class="tw${n.collapsed ? '' : ' open'}" data-act="fold" aria-expanded="${!n.collapsed}" aria-label="${n.collapsed ? 'Show' : 'Hide'} what's in ${esc(n.label)}"></button>`
			: '';
	const count = n.kind === 'group' ? `<span class="chip">${[...walkE(n.children)].filter((c) => c.kind !== 'group').length}</span>` : '';
	const kids =
		n.kind === 'group'
			? `<ul class="kids"${n.collapsed ? ' hidden' : ''}>${n.children.map((c) => rowHtml(c, depth + 1)).join('')}<li class="addin"><button type="button" class="ghost" data-act="add-in">+ Add a link here</button></li></ul>`
			: '';
	return `<li class="row lp-${n.kind}" data-key="${n.key}"><div class="rowin">
<span class="grip" draggable="true" aria-hidden="true" title="Drag to move"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>
${twisty}${tile}<div class="fields">${fields}</div>${count}${clicks}
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
	$('#diary-card').hidden = !hasDiary;
}

function renderProfile() {
	const p = S.person!;
	$<HTMLInputElement>('#p-name').value = p.name;
	$<HTMLTextAreaElement>('#p-bio').value = p.bio;
	$('#p-count').textContent = `${p.bio.length}/300`;
	$('#p-photo').innerHTML = p.photo ? `<img src="${esc(mediaUrl(p.photo))}" alt="">` : `<span>${esc(p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span>`;
	$('#p-photo').classList.toggle('logo', p.kind === 'org');
	$('#addr').textContent = pageUrl();
	$<HTMLAnchorElement>('#view').href = p.handle === 'amybo' ? '/links' : `/~${p.handle}`;
	$<HTMLInputElement>('#s-map').checked = !p.basic_mode;
	for (const r of document.querySelectorAll<HTMLInputElement>('input[name="ddef"]')) r.checked = r.value === p.diary_default;
	$('#who').textContent = p.email;
	$('#upload-note').hidden = S.uploads;
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function renderDiary() {
	const ul = $('#entries');
	ul.innerHTML = S.diary.length
		? S.diary
				.map(
					(e) => `<li class="entry${e.highlight ? ' hl' : ''}" data-id="${e.id}">
<button type="button" class="star" data-act="star" aria-pressed="${!!e.highlight}" aria-label="${e.highlight ? 'Remove from' : 'Add to'} highlights">${e.highlight ? '★' : '☆'}</button>
<div class="etext"><span class="eday">${esc(fmtDay(e.day))}</span><span class="etitle">${esc(e.title)}</span></div>
<button type="button" class="ghost" data-act="edit">Edit</button></li>`,
				)
				.join('')
		: `<li class="empty">No entries yet. Your first could be what you're working on now.</li>`;
	preview();
}

// ---------- event handling for the tree ----------

function onTreeInput(e: Event) {
	const t = e.target as HTMLInputElement;
	const row = t.closest<HTMLElement>('.row');
	if (!row || !t.dataset.f) return;
	const n = find(row.dataset.key!)!.node;
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
		['indent', `Move into "${prev?.label ?? ''}"`, prev?.kind === 'group'],
		['outdent', 'Move out of this group', !!f.parent],
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
		if (prev?.kind !== 'group') return;
		f.list.splice(i, 1);
		prev.children.push(n);
		prev.collapsed = false;
	} else if (a === 'outdent' && f.parent) {
		const pf = find(f.parent.key)!;
		f.list.splice(i, 1);
		pf.list.splice(pf.list.indexOf(f.parent) + 1, 0, n);
	} else if (a === 'delete') {
		const what = n.kind === 'group' && n.children.length ? `the group "${n.label}" and everything in it` : `"${n.label}"`;
		if (!confirm(`Delete ${what}?`)) return;
		f.list.splice(i, 1);
		toast(`Deleted ${n.label}`);
	}
	changed(true);
	requestAnimationFrame(() => document.querySelector<HTMLElement>(`.row[data-key="${n.key}"] .more`)?.focus());
}

// Drag and drop: drop on the top or bottom half of a row to go before or after it; on the middle of a group to go inside.
let dragKey: string | null = null;
function setupDrag() {
	const tree = $('#tree');
	tree.addEventListener('dragstart', (e) => {
		const grip = (e.target as HTMLElement).closest?.('.grip');
		const row = grip?.closest<HTMLElement>('.row');
		if (!row) return;
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
		const group = row.classList.contains('lp-group');
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

async function toWebp(blob: Blob, size: number, cover = true): Promise<Blob> {
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		const w = img.naturalWidth || size;
		const hgt = img.naturalHeight || size;
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const g = c.getContext('2d')!;
		const s = cover ? Math.max(size / w, size / hgt) : Math.min(size / w, size / hgt);
		g.imageSmoothingQuality = 'high';
		g.drawImage(img, (size - w * s) / 2, (size - hgt * s) / 2, w * s, hgt * s);
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

function pickPicture(n: ENode, suggestions: Proposal | null = null): Promise<void> {
	return new Promise((resolve) => {
		const dlg = $<HTMLDialogElement>('#picker');
		const grid = $('#icon-grid', dlg);
		const search = $<HTMLInputElement>('#icon-search', dlg);
		const sug = $('#suggested', dlg);
		$('#picker-title', dlg).textContent = `Picture for "${n.label || 'this link'}"`;
		const drawGrid = () => {
			const q = search.value.trim().toLowerCase();
			grid.innerHTML = S.icons
				.filter((k) => !q || k.includes(q) || icon(k).title.toLowerCase().includes(q))
				.slice(0, 160)
				.map((k) => `<button type="button" class="ichoice${!n.image && n.icon === k ? ' on' : ''}" data-icon="${esc(k)}" title="${esc(icon(k).title)}">${tileHtml({ icon: k, image: '' })}</button>`)
				.join('');
		};
		search.value = '';
		drawGrid();
		const guess = guessIcon(n.url);
		const sugg: string[] = [`<button type="button" class="sugg" data-icon="${esc(guess)}">${tileHtml({ icon: guess, image: '' })}<span>${esc(icon(guess).title)} icon</span></button>`];
		if (S.uploads && suggestions?.favicon) sugg.push(`<button type="button" class="sugg" data-remote="${esc(suggestions.favicon)}" data-fit="1"><img src="/api/links/remote-image?url=${encodeURIComponent(suggestions.favicon)}" alt=""><span>The site's icon</span></button>`);
		if (S.uploads && suggestions?.image) sugg.push(`<button type="button" class="sugg" data-remote="${esc(suggestions.image)}"><img src="/api/links/remote-image?url=${encodeURIComponent(suggestions.image)}" alt=""><span>The site's picture</span></button>`);
		sug.innerHTML = sugg.join('');
		$('#pick-upload', dlg).hidden = !S.uploads;
		const done = () => {
			dlg.close();
			changed(true);
			resolve();
		};
		const onClick = async (e: Event) => {
			const b = (e.target as HTMLElement).closest<HTMLElement>('button');
			if (!b) return;
			if (b.dataset.icon) {
				n.icon = b.dataset.icon;
				n.image = '';
				done();
			} else if (b.dataset.remote) {
				b.classList.add('busy');
				try {
					n.image = await fromRemote(b.dataset.remote, 256, !b.dataset.fit);
					done();
				} catch (err) {
					toast((err as Error).message, 'err');
					b.classList.remove('busy');
				}
			} else if (b.id === 'pick-close') {
				dlg.close();
				resolve();
			}
		};
		const onFile = async (e: Event) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			try {
				n.image = await uploadBlob(file, 256);
				done();
			} catch (err) {
				toast((err as Error).message, 'err');
			}
		};
		search.oninput = drawGrid;
		dlg.onclick = onClick;
		$<HTMLInputElement>('#pick-file', dlg).onchange = onFile;
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
	const n: ENode = { key: newKey(), kind: 'link', label: '', url: '', icon: 'link', image: '', body: '', seed: 0, children: [] };
	url.value = '';
	name.value = '';
	tile.innerHTML = tileHtml(n);
	hint.textContent = 'Paste a web address and we will suggest a name and picture.';
	let seq = 0;
	const look = async () => {
		let v = url.value.trim();
		if (v && !/^[a-z]+:/i.test(v)) v = v.includes('@') && !v.includes('/') ? `mailto:${v}` : `https://${v}`;
		n.url = v;
		n.icon = guessIcon(v);
		tile.innerHTML = tileHtml(n);
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
			url.focus();
			return;
		}
		n.label = name.value.trim() || prop?.title || hostLine(n.url);
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

function addSpecial(kind: 'group' | 'diary' | 'support') {
	const labels = { group: 'New group', diary: 'AMYBO diary', support: 'How I support AMYBO' };
	const n: ENode = { key: newKey(), kind, label: labels[kind], url: '', icon: kind === 'diary' ? 'diary' : kind === 'support' ? 'heart' : '', image: '', body: '', seed: 0, children: [] };
	S.tree.push(n);
	changed(true);
	requestAnimationFrame(() => {
		const inp = document.querySelector<HTMLInputElement>(`.row[data-key="${n.key}"] .lbl`);
		inp?.focus();
		inp?.select();
	});
}

// ---------- diary ----------

function editEntry(e: DiaryEntry | null) {
	const dlg = $<HTMLDialogElement>('#entry');
	const today = new Date().toISOString().slice(0, 10);
	$<HTMLInputElement>('#e-day', dlg).value = e?.day ?? today;
	$<HTMLInputElement>('#e-title', dlg).value = e?.title ?? '';
	$<HTMLTextAreaElement>('#e-body', dlg).value = e?.body ?? '';
	$<HTMLInputElement>('#e-hl', dlg).checked = !!e?.highlight;
	$('#e-delete', dlg).hidden = !e;
	$('#entry-title', dlg).textContent = e ? 'Edit entry' : 'New diary entry';
	$<HTMLFormElement>('#e-form', dlg).onsubmit = async (ev) => {
		ev.preventDefault();
		const body = {
			id: e?.id,
			day: $<HTMLInputElement>('#e-day', dlg).value,
			title: $<HTMLInputElement>('#e-title', dlg).value,
			body: $<HTMLTextAreaElement>('#e-body', dlg).value,
			highlight: $<HTMLInputElement>('#e-hl', dlg).checked,
		};
		try {
			const r = await api<{ id: number }>('diary', { body });
			const entry: DiaryEntry = { id: r.id, day: body.day, title: body.title.trim(), body: body.body, highlight: body.highlight ? 1 : 0 };
			S.diary = [entry, ...S.diary.filter((x) => x.id !== r.id)].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
			dlg.close();
			renderDiary();
			renderTree();
			toast('Entry saved');
		} catch (err) {
			toast((err as Error).message, 'err');
		}
	};
	$('#e-delete', dlg).onclick = async () => {
		if (!e || !confirm(`Delete "${e.title}"?`)) return;
		try {
			await api(`diary?id=${e.id}`, { method: 'DELETE' });
			S.diary = S.diary.filter((x) => x.id !== e.id);
			dlg.close();
			renderDiary();
			renderTree();
		} catch (err) {
			toast((err as Error).message, 'err');
		}
	};
	$('#e-cancel', dlg).onclick = () => dlg.close();
	dlg.showModal();
	$<HTMLInputElement>('#e-title', dlg).focus();
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
	S.diary = me.diary;
	S.stats = new Map(me.stats.map((s) => [s.slug, s]));
	const tree = buildTree(me.nodes as Omit<LinkNode, 'children'>[]);
	const conv = (n: LinkNode): ENode => ({ key: newKey(), id: n.id, slug: n.slug, kind: n.kind, label: n.label, url: n.url, savedUrl: n.url, icon: n.icon, image: n.image, body: n.body, seed: n.seed, children: n.children.map(conv) });
	S.tree = tree.map(conv);
	renderProfile();
	renderTree();
	renderDiary();
	show('editor');
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
	$('#p-photo').addEventListener('click', () => {
		if (!S.uploads) {
			toast("Photo uploads aren't switched on yet", 'err');
			return;
		}
		$<HTMLInputElement>('#p-file').click();
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
	document.querySelectorAll<HTMLInputElement>('input[name="ddef"]').forEach((r) =>
		r.addEventListener('change', () => {
			S.person!.diary_default = r.value as 'all' | 'highlights';
			later('profile', saveProfile, 0);
		}),
	);
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
	});
	setupDrag();
	document.addEventListener('click', (e) => {
		if (!(e.target as HTMLElement).closest('.menu,[data-act="menu"]')) closeMenus();
	});
	$('#add-link').addEventListener('click', () => addLink(null));
	$('#add-group').addEventListener('click', () => addSpecial('group'));
	$('#add-diary').addEventListener('click', () => addSpecial('diary'));
	$('#add-support').addEventListener('click', () => addSpecial('support'));

	// diary
	$('#new-entry').addEventListener('click', () => editEntry(null));
	$('#entries').addEventListener('click', async (e) => {
		const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
		const li = b?.closest<HTMLElement>('.entry');
		if (!b || !li) return;
		const entry = S.diary.find((x) => x.id === Number(li.dataset.id))!;
		if (b.dataset.act === 'edit') editEntry(entry);
		if (b.dataset.act === 'star') {
			entry.highlight = entry.highlight ? 0 : 1;
			renderDiary();
			try {
				await api('diary', { body: entry });
			} catch (err) {
				toast((err as Error).message, 'err');
			}
		}
	});

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
	// One at a time, each sending the latest state, so an older save can never land after a newer one.
	const send = async () => {
		const p = S.person;
		if (!p) return;
		await api('profile', { method: 'PUT', body: { name: p.name, bio: p.bio, photo: p.photo, basic_mode: !!p.basic_mode, diary_default: p.diary_default } });
	};
	profileSaving = (profileSaving ?? Promise.resolve()).catch(() => {}).then(send);
	await profileSaving;
}

init();
