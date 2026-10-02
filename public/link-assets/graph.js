// Link-page map, loaded only when someone opens a group on the map (or taps the map on a phone).
// Every position is worked out on the server and never changes: opening a group grows its items out of it,
// closing draws them back in. The movement is CSS transitions, so there is no animation loop at all, and a
// map nobody touches never loads this file.
const NS = 'http://www.w3.org/2000/svg';
let api = null;

export function start(map) {
	if (api) return api;
	const data = JSON.parse(document.getElementById('lp-data').textContent);
	const svg = map.querySelector('.mapsvg');
	const edgeLayer = svg.querySelector('.edges');
	const nodeLayer = svg.querySelector('.nodes');
	const buds = svg.querySelector('.buds');
	const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const byId = new Map(data.nodes.map((n) => [n.id, { ...n, children: [] }]));
	for (const n of byId.values()) if (n.parent != null) byId.get(n.parent)?.children.push(n);
	const firstLevel = new Set(data.nodes.filter((n) => n.parent == null).map((n) => n.id));
	const open = new Set();
	const els = new Map();

	const el = (name, attrs) => {
		const e = document.createElementNS(NS, name);
		for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
		return e;
	};

	/** The element for a node: a first-level one already on the page, or a new one. */
	function nodeEl(n) {
		let e = els.get(n.id) || nodeLayer.querySelector(`[data-g="${n.id}"]`);
		if (e) {
			els.set(n.id, e);
			return e;
		}
		if (n.kind === 'group') e = el('g', { class: 'n group', 'data-g': n.id, tabindex: 0, role: 'button', 'aria-expanded': 'false', 'aria-label': n.label });
		else {
			e = el('a', { class: `n ${n.kind}`, 'data-g': n.id, href: n.href, 'aria-label': n.label });
			if (data.preview && n.kind === 'link') {
				e.setAttribute('target', '_blank');
				e.setAttribute('rel', 'noopener');
			}
		}
		const t = el('title', {});
		t.textContent = n.label;
		e.append(t, el('circle', { cx: n.x, cy: n.y, r: n.r }));
		e.insertAdjacentHTML('beforeend', n.pic);
		els.set(n.id, e);
		return e;
	}

	function edgeEl(n) {
		const p = byId.get(n.parent);
		const dx = n.x - p.x;
		const dy = n.y - p.y;
		const d = Math.hypot(dx, dy) || 1;
		return el('line', {
			'data-e': n.id,
			x1: (p.x + (dx / d) * p.r).toFixed(1),
			y1: (p.y + (dy / d) * p.r).toFixed(1),
			x2: (n.x - (dx / d) * n.r).toFixed(1),
			y2: (n.y - (dy / d) * n.r).toFixed(1),
		});
	}

	const away = (n) => {
		const p = byId.get(n.parent);
		return `translate(${(p.x - n.x).toFixed(1)}px, ${(p.y - n.y).toFixed(1)}px) scale(.3)`;
	};

	/** Grow a child out of its parent: start there, small and clear, and let CSS carry it to its place. */
	function grow(n, e, line) {
		e.style.transition = line.style.transition = 'none';
		e.style.transform = away(n);
		e.style.opacity = line.style.opacity = '0';
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				e.style.transition = line.style.transition = '';
				e.style.transform = '';
				e.style.opacity = line.style.opacity = '';
			}),
		);
	}

	function shrink(n) {
		const e = els.get(n.id);
		const line = edgeLayer.querySelector(`[data-e="${n.id}"]`);
		if (!e) return;
		e.style.transform = away(n);
		e.style.opacity = '0';
		if (line) line.style.opacity = '0';
		const finish = () => {
			if (open.has(n.parent)) return; // reopened meanwhile
			e.remove();
			line?.remove();
			e.style.transform = e.style.opacity = '';
		};
		reduce() ? finish() : setTimeout(finish, 300);
	}

	const ancestors = (n) => {
		const out = [];
		for (let a = byId.get(n.parent); a; a = byId.get(a.parent)) out.push(a);
		return out;
	};

	// The list and the map open and close together.
	const detailsFor = (id) => document.querySelector(`.tree summary[data-n="${id}"]`)?.parentElement;
	let syncing = false;
	const syncList = (n, isOpen) => {
		syncing = true;
		const d = detailsFor(n.id);
		if (d) d.open = isOpen;
		if (isOpen) for (const a of ancestors(n)) if (detailsFor(a.id)) detailsFor(a.id).open = true;
		setTimeout(() => (syncing = false), 0);
	};

	function mark(n, isOpen) {
		const e = nodeEl(n);
		e.classList.toggle('open', isOpen);
		e.setAttribute('aria-expanded', String(isOpen));
		buds.querySelectorAll(`[data-b="${n.id}"]`).forEach((b) => (b.style.opacity = isOpen ? '0' : ''));
	}

	function expand(n, fromList = false) {
		if (n.kind !== 'group' || open.has(n.id)) return;
		// One branch open at a time, so branches never crowd each other.
		const keep = new Set([n.id, ...ancestors(n).map((a) => a.id)]);
		for (const id of [...open]) if (!keep.has(id)) collapse(byId.get(id), fromList);
		for (const a of ancestors(n).reverse()) if (!open.has(a.id)) expand(a, true);
		open.add(n.id);
		mark(n, true);
		for (const c of n.children) {
			const e = nodeEl(c);
			let line = edgeLayer.querySelector(`[data-e="${c.id}"]`);
			if (!line) edgeLayer.append((line = edgeEl(c)));
			nodeLayer.append(e);
			grow(c, e, line);
		}
		if (!fromList) syncList(n, true);
	}

	function collapse(n, fromList = false) {
		if (!n || !open.has(n.id)) return;
		for (const c of n.children) if (open.has(c.id)) collapse(c, true);
		open.delete(n.id);
		mark(n, false);
		for (const c of n.children) shrink(c);
		if (!fromList) syncList(n, false);
	}

	const toggle = (id) => {
		const n = byId.get(id);
		if (n) open.has(id) ? collapse(n) : expand(n);
	};

	// Groups deeper than the first level are new elements; the page's loader handles the first level.
	const groupFrom = (e) => {
		const g = e.target.closest && e.target.closest('g.n[data-g]');
		return g && !firstLevel.has(+g.dataset.g) ? g : null;
	};
	nodeLayer.addEventListener('click', (e) => {
		const g = groupFrom(e);
		if (g) {
			e.preventDefault();
			toggle(+g.dataset.g);
			return;
		}
		// A support note on the map opens it in the list.
		const a = e.target.closest('a.n.support');
		if (!a) return;
		e.preventDefault();
		map.querySelector('.back')?.click();
		const d = document.getElementById('lp-support');
		if (d) {
			d.open = true;
			d.scrollIntoView({ block: 'center' });
		}
	});
	nodeLayer.addEventListener('keydown', (e) => {
		const g = groupFrom(e);
		if (g && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			toggle(+g.dataset.g);
		}
	});
	document.querySelectorAll('.tree details').forEach((d) =>
		d.addEventListener('toggle', () => {
			if (syncing) return;
			const n = byId.get(+d.querySelector(':scope > summary')?.dataset.n);
			if (n && n.kind === 'group') d.open ? expand(n, true) : collapse(n, true);
		}),
	);

	api = { toggle };
	return api;
}
