// Link-page map: live physics, loaded only when someone opens a group on the map (or taps the map on a phone).
//
// The touched node is the fixed point. Tapping a group makes it the focus: it stays exactly where it was, under
// your finger, while its own items spring out around it and its parent drifts back, away from them. Tap the
// parent (or the focus again) to go back up. Any depth works the same way. The simulation stops as soon as
// everything settles, so an idle map costs nothing; until the first tap this file is never even fetched.
const NS = 'http://www.w3.org/2000/svg';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let api = null;

export function start(map) {
	if (api) return api;
	const data = JSON.parse(document.getElementById('lp-data').textContent);
	const svg = map.querySelector('.mapsvg');
	const edgeLayer = svg.querySelector('.edges');
	const nodeLayer = svg.querySelector('.nodes');
	const hubEl = svg.querySelector('.hubg');
	svg.classList.add('live');

	// ---- the tree ----
	const hub = { id: 0, kind: 'hub', parent: null, children: [], x: 0, y: 0, r: 44, el: hubEl };
	const byId = new Map([[0, hub]]);
	for (const n of data.nodes) byId.set(n.id, { ...n, parent: n.parent ?? 0, children: [] });
	for (const n of byId.values()) if (n !== hub) byId.get(n.parent).children.push(n);
	for (const n of byId.values()) Object.assign(n, { vx: 0, vy: 0, s: n === hub ? 1 : 0, ts: 0, op: 0, top: 0, on: false });
	hub.s = hub.ts = 1;
	hub.op = hub.top = 1;

	const ancestors = (n) => {
		const out = [];
		for (let a = byId.get(n.parent); a; a = a.parent == null ? null : byId.get(a.parent)) out.push(a);
		return out;
	};

	// ---- elements ----
	const el = (name, attrs) => {
		const e = document.createElementNS(NS, name);
		for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
		return e;
	};
	function nodeEl(n) {
		if (n.el) return n.el;
		const e =
			n.kind === 'group'
				? el('g', { class: 'n lp-group', 'data-g': n.id, tabindex: 0, role: 'button', 'aria-label': n.label })
				: el('a', { class: `n lp-${n.kind}`, 'data-g': n.id, href: n.href, 'aria-label': n.label });
		if (n.kind === 'link' && data.preview) {
			e.setAttribute('target', '_blank');
			e.setAttribute('rel', 'noopener');
		}
		const t = el('title', {});
		t.textContent = n.label;
		e.append(t, el('circle', { r: n.r }));
		e.insertAdjacentHTML('beforeend', n.pic);
		n.el = e;
		return e;
	}
	function edgeEl(n) {
		if (!n.edge) n.edge = el('line', { 'data-e': n.id });
		return n.edge;
	}

	// The static drawing is replaced by live elements at the same places.
	nodeLayer.textContent = '';
	edgeLayer.textContent = '';

	// ---- who is shown, and how big ----
	let focus = hub;
	const role = new Map();
	const SIZE = { focus: 25, child: 20, parent: 19, anc: 15, sib: 14 };
	const radius = (n) => {
		const r = role.get(n);
		if (n === hub) return r === 'focus' ? 44 : r === 'parent' ? 40 : 34;
		return SIZE[r] ?? 18;
	};

	function arrange() {
		role.clear();
		role.set(focus, 'focus');
		for (const c of focus.children) role.set(c, 'child');
		const anc = ancestors(focus);
		anc.forEach((a, i) => role.set(a, i === 0 ? 'parent' : 'anc'));
		if (anc[0]) for (const s of anc[0].children) if (s !== focus) role.set(s, 'sib');
		for (const n of byId.values()) {
			const show = role.has(n);
			if (show && !n.on) {
				// New arrivals grow out of their parent, a little way along the direction they'll settle in.
				const p = byId.get(n.parent) ?? hub;
				const from = p.on ? p : focus;
				const gp = p.parent != null ? byId.get(p.parent) : null;
				let dx = gp && gp.on ? from.x - gp.x : n.x - from.x;
				let dy = gp && gp.on ? from.y - gp.y : n.y - from.y;
				const d = Math.hypot(dx, dy) || 1;
				// Places in the fan are handed out top to bottom in list order, so the map reads like the list.
				const sibs = from.children;
				const fan = sibs.map((_, i) => ((i - (sibs.length - 1) / 2) / Math.max(sibs.length, 1)) * 2.2).map((sp) => Math.atan2(dy / d, dx / d) + sp);
				fan.sort((p, q) => Math.sin(p) - Math.sin(q));
				const a = fan[Math.max(0, sibs.indexOf(n))];
				n.x = from.x + Math.cos(a) * 14;
				n.y = from.y + Math.sin(a) * 14;
				n.vx = Math.cos(a) * 4;
				n.vy = Math.sin(a) * 4;
				nodeLayer.append(nodeEl(n));
				if (n !== hub) edgeLayer.append(edgeEl(n));
				n.s = 0.2;
				n.op = 0;
			}
			n.on = show || n.op > 0.02;
			n.ts = show ? radius(n) / n.r : 0.2;
			n.top = show ? (role.get(n) === 'anc' ? 0.55 : 1) : 0;
		}
		nodeLayer.append(hubEl);
		const onPath = new Set([focus, ...ancestors(focus)]);
		for (const n of byId.values()) {
			if (n.el) {
				n.el.classList.toggle('open', n === focus && n.kind === 'group');
				// Groups whose items are on show (the focus and the way back to the centre) need no dots.
				n.el.classList.toggle('shown', onPath.has(n));
				if (n.kind === 'group') n.el.setAttribute('aria-expanded', String(n === focus));
			}
		}
	}

	// ---- physics ----
	let alpha = 0;
	let away = [0, -1];
	const REST = { child: 118, parent: 160, anc: 125, sib: 92 };
	function tick() {
		const live = [...byId.values()].filter((n) => n.on);
		const shown = live.filter((n) => role.has(n));
		for (let i = 0; i < shown.length; i++) {
			const a = shown[i];
			for (let j = i + 1; j < shown.length; j++) {
				const b = shown[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1) {
					dx = Math.random() - 0.5;
					dy = Math.random() - 0.5;
					d2 = 1;
				}
				const d = Math.sqrt(d2);
				const min = radius(a) + radius(b) + 22;
				// Inverse-square repulsion (force = C / d²; per axis that is dx · C / d³).
				let f = 9000 / (d2 * d);
				if (d < min) f += ((min - d) / d) * 0.35;
				a.vx -= dx * f;
				a.vy -= dy * f;
				b.vx += dx * f;
				b.vy += dy * f;
			}
		}
		const parentOfFocus = focus.parent != null ? byId.get(focus.parent) : null;
		// The direction "away from where we came from", fixed when the focus was chosen: children fan out along it
		// and the parent drifts against it. Fixing it keeps the picture from slowly turning.
		const [ox, oy] = away;
		// The path back to the centre: focus, its parent, grandparent... Each link holds the next one by a spring.
		const path = [focus, ...ancestors(focus)];
		for (const n of shown) {
			const r = role.get(n);
			if (r === 'focus') continue;
			const anchor = r === 'child' || r === 'parent' ? focus : r === 'sib' ? parentOfFocus : path[path.indexOf(n) - 1];
			if (anchor) {
				const dx = n.x - anchor.x;
				const dy = n.y - anchor.y;
				const d = Math.hypot(dx, dy) || 1;
				const k = 0.11 * ((d - REST[r]) / d);
				n.vx -= dx * k;
				n.vy -= dy * k;
				// Equal and opposite on the other end, or the cluster pushes itself along forever.
				if (anchor !== focus) {
					anchor.vx += dx * k;
					anchor.vy += dy * k;
				}
			}
			const push = 0.9;
			if (r === 'child') {
				n.vx += ox * push;
				n.vy += oy * push;
			} else if (r === 'parent' || r === 'anc') {
				// Straight out from whatever it is tied to: balanced by that spring, so it settles rather than circling.
				const dx = n.x - anchor.x;
				const dy = n.y - anchor.y;
				const d = Math.hypot(dx, dy) || 1;
				n.vx += (dx / d) * push;
				n.vy += (dy / d) * push;
			}
		}
		// Keep each family in list order from top to bottom: a gentle nudge whenever two neighbours swap.
		const families = [focus.children];
		if (parentOfFocus) families.push(parentOfFocus.children);
		for (const fam of families) {
			const vis = fam.filter((c) => role.has(c));
			for (let i = 0; i + 1 < vis.length; i++) {
				const a = vis[i];
				const b = vis[i + 1];
				const over = a.y - (b.y - 16);
				if (over > 0) {
					if (a !== focus) a.vy -= over * 0.15;
					if (b !== focus) b.vy += over * 0.15;
				}
			}
		}
		// Soft walls at the edges of the map: the view never zooms or pans, so everything is kept inside it.
		const pad = 10;
		for (const n of shown) {
			if (n === focus) continue;
			const r = radius(n) + pad;
			const x0 = cam[0] + r;
			const x1 = cam[0] + cam[2] - r;
			const y0 = cam[1] + r;
			const y1 = cam[1] + cam[3] - r;
			if (n.x < x0) n.vx += (x0 - n.x) * 0.25;
			if (n.x > x1) n.vx -= (n.x - x1) * 0.25;
			if (n.y < y0) n.vy += (y0 - n.y) * 0.25;
			if (n.y > y1) n.vy -= (n.y - y1) * 0.25;
		}
		let energy = 0;
		for (const n of live) {
			if (n === focus) {
				n.vx = n.vy = 0; // the touched node never moves
			} else {
				// Friction grows as the system cools, so it comes to a complete stop within a couple of seconds.
				const fr = 0.52 + 0.2 * alpha;
				n.vx *= fr;
				n.vy *= fr;
				n.x += n.vx;
				n.y += n.vy;
				energy += n.vx * n.vx + n.vy * n.vy;
			}
			// Size and fade ease towards their targets.
			n.s += (n.ts - n.s) * 0.22;
			n.op += (n.top - n.op) * 0.22;
			energy += Math.abs(n.ts - n.s) + Math.abs(n.top - n.op) * 0.1;
			// Leavers follow their parent home.
			if (!role.has(n)) {
				const p = byId.get(n.parent) ?? hub;
				n.x += (p.x - n.x) * 0.2;
				n.y += (p.y - n.y) * 0.2;
				if (n.op < 0.03) {
					n.on = false;
					n.el?.remove();
					n.edge?.remove();
				}
			}
		}
		alpha = Math.max(alpha * 0.96, 0.02);
		return energy;
	}

	// ---- drawing ----
	function draw() {
		for (const n of byId.values()) {
			if (!n.on || !n.el) continue;
			n.el.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)}) scale(${n.s.toFixed(3)})`);
			// A group's dots point away from the line to its parent.
			const halo = n.halo ?? (n.halo = n.el.querySelector('.halo') || false);
			if (halo) {
				const p = byId.get(n.parent) ?? hub;
				halo.setAttribute('transform', `rotate(${((Math.atan2(n.y - p.y, n.x - p.x) * 180) / Math.PI).toFixed(1)})`);
			}
			n.el.style.opacity = n.op.toFixed(2);
			if (n.edge && n !== hub) {
				const p = byId.get(n.parent) ?? hub;
				const pr = p.r * p.s;
				const nr = n.r * n.s;
				const dx = n.x - p.x;
				const dy = n.y - p.y;
				const d = Math.hypot(dx, dy) || 1;
				const show = d > pr + nr;
				n.edge.setAttribute('x1', (p.x + (dx / d) * pr).toFixed(1));
				n.edge.setAttribute('y1', (p.y + (dy / d) * pr).toFixed(1));
				n.edge.setAttribute('x2', (n.x - (dx / d) * nr).toFixed(1));
				n.edge.setAttribute('y2', (n.y - (dy / d) * nr).toFixed(1));
				n.edge.style.opacity = show ? Math.min(n.op, p.op).toFixed(2) : '0';
			}
		}
		svg.setAttribute('viewBox', cam.map((v) => v.toFixed(1)).join(' '));
	}

	// ---- camera: the focus keeps its place on screen; only the zoom changes, around it, to fit what's open ----
	const box = () => svg.getBoundingClientRect();
	let cam = svg.getAttribute('viewBox').split(/\s+/).map(Number);
	let holdUntil = 0;
	/** Where a node is on screen, as fractions of the map's box. */
	function screenFraction(n) {
		const b = box();
		const ctm = svg.getScreenCTM && svg.getScreenCTM();
		if (ctm && b.width) {
			const pt = svg.createSVGPoint();
			pt.x = n.x;
			pt.y = n.y;
			const sp = pt.matrixTransform(ctm);
			return [(sp.x - b.left) / b.width, (sp.y - b.top) / b.height];
		}
		return [(n.x - cam[0]) / cam[2], (n.y - cam[1]) / cam[3]];
	}
	/** Give the view the box's own proportions, showing exactly what is on screen now (so nothing moves). */
	function fitAspect() {
		const b = box();
		if (!b.width || !b.height) return;
		const aspect = b.width / b.height;
		const [x, y, w, h] = cam;
		const cx = x + w / 2;
		const cy = y + h / 2;
		const [nw, nh] = w / h > aspect ? [w, w / aspect] : [h * aspect, h];
		cam = [cx - nw / 2, cy - nh / 2, nw, nh];
		svg.setAttribute('viewBox', cam.map((v) => v.toFixed(1)).join(' '));
	}
	fitAspect();
	if (window.ResizeObserver) new ResizeObserver(() => fitAspect()).observe(svg);
	function moveCam() {
		return 0; // the view is fixed: nothing zooms or pans, so what you touch stays under your finger
	}

	// ---- loop: only while something is moving ----
	let raf = 0;
	let stopAt = 0;
	const frame = () => {
		raf = 0;
		const e = tick();
		const m = moveCam();
		draw();
		// Run while things move, but never more than 3 seconds after a tap: then everything is frozen where it is.
		const now = performance.now();
		if (now < stopAt && (e > 0.02 || m > 0.15 || now < holdUntil)) raf = requestAnimationFrame(frame);
		else for (const n of byId.values()) n.vx = n.vy = 0;
	};
	function kick() {
		alpha = 1;
		if (reduce()) {
			for (let i = 0; i < 400; i++) tick();
			draw();
			return;
		}
		holdUntil = performance.now() + 900;
		stopAt = performance.now() + 3000;
		if (!raf) raf = requestAnimationFrame(frame);
	}

	// ---- the list follows the map ----
	const detailsFor = (id) => document.querySelector(`.tree summary[data-n="${id}"]`)?.parentElement;
	let syncing = false;
	function syncList() {
		syncing = true;
		const path = new Set([focus.id, ...ancestors(focus).map((a) => a.id)]);
		document.querySelectorAll('.tree details').forEach((d) => {
			const id = +d.querySelector(':scope > summary')?.dataset.n;
			if (byId.get(id)?.kind === 'group') d.open = path.has(id);
		});
		setTimeout(() => (syncing = false), 0);
	}
	document.querySelectorAll('.tree details').forEach((d) =>
		d.addEventListener('toggle', () => {
			if (syncing) return;
			const n = byId.get(+d.querySelector(':scope > summary')?.dataset.n);
			if (!n || n.kind !== 'group') return;
			if (d.open) setFocus(n);
			else if (n === focus || ancestors(focus).includes(n)) setFocus(byId.get(n.parent) ?? hub);
		}),
	);

	function setFocus(n, fromMap = false) {
		if (!n || n === focus) return;
		focus = n;
		const p = n.parent != null ? byId.get(n.parent) : null;
		const d = p ? Math.hypot(n.x - p.x, n.y - p.y) || 1 : 1;
		away = p ? [(n.x - p.x) / d, (n.y - p.y) / d] : [0, -1];
		// Near an edge of the map, open towards the open space instead, so nothing has to shrink to fit.
		const [u, v] = screenFraction(n);
		const cu = 0.5 - u;
		const cv = 0.5 - v;
		const edge = Math.min(1, Math.max(Math.abs(cu), Math.abs(cv)) * 2.5);
		const cl = Math.hypot(cu, cv) || 1;
		const mx = away[0] * (1 - edge) + (cu / cl) * edge;
		const my = away[1] * (1 - edge) + (cv / cl) * edge;
		const ml = Math.hypot(mx, my) || 1;
		away = [mx / ml, my / ml];
		arrange();
		if (fromMap) syncList();
		kick();
	}

	/** A tap on a group or the centre: it becomes the focus; tapping the focus again goes back up a level. */
	function tap(id) {
		const n = byId.get(id);
		if (!n) return;
		if (n === focus) setFocus(n.parent != null ? byId.get(n.parent) : hub, true);
		else if (n.kind === 'group' || n === hub) setFocus(n, true);
	}

	// A support note on the map opens it in the list.
	nodeLayer.addEventListener('click', (e) => {
		const a = e.target.closest && e.target.closest('a.n.lp-support');
		if (!a) return;
		e.preventDefault();
		map.querySelector('.back')?.click();
		const d = document.getElementById('lp-support');
		if (d) {
			d.open = true;
			d.scrollIntoView({ block: 'center' });
		}
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden && raf) {
			cancelAnimationFrame(raf);
			raf = 0;
		} else if (!document.hidden) kick();
	});

	// First frame: the hub's own items, where the static drawing had them.
	for (const c of hub.children) {
		c.on = true;
		nodeLayer.append(nodeEl(c));
		edgeLayer.append(edgeEl(c));
	}
	arrange();
	for (const c of hub.children) {
		c.s = c.ts;
		c.op = 1;
	}
	draw();

	api = { tap };
	return api;
}
