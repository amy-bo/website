// Link-page map: force-directed physics, loaded only when someone touches the map (see src/links/render.ts).
// Groups open as the pointer approaches them and close again when it leaves. The animation loop stops as soon
// as everything settles, so an untouched map costs nothing and a settled one costs nothing more.
const NS = 'http://www.w3.org/2000/svg';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = (name, attrs = {}, parent) => {
	const e = document.createElementNS(NS, name);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
	if (parent) parent.appendChild(e);
	return e;
};

let started = null;

export function start(map) {
	if (started) {
		started.resume();
		return;
	}
	const data = JSON.parse(document.getElementById('lp-data').textContent);
	const svg = map.querySelector('.mapsvg');
	const staticLayer = [...svg.childNodes];
	const live = el('g', { class: 'live' });

	// ---- model ----
	const hub = { id: 0, parent: null, kind: 'hub', depth: 0, x: 0, y: 0, vx: 0, vy: 0, r: 40, children: [], fixed: true };
	const nodes = new Map([[0, hub]]);
	for (const n of data.nodes) nodes.set(n.id, { ...n, children: [], vx: 0, vy: 0, r: 0, depth: 0 });
	for (const n of nodes.values()) {
		if (n === hub) continue;
		const p = nodes.get(n.parent ?? 0) ?? hub;
		n.parentNode = p;
		p.children.push(n);
	}
	const setDepth = (n, d) => {
		n.depth = d;
		n.r = d === 0 ? 40 : n.kind === 'group' ? (d === 1 ? 22 : 18) : d === 1 ? 19 : 15;
		n.children.forEach((c) => setDepth(c, d + 1));
	};
	setDepth(hub, 0);
	// Start from the static drawing's positions, so the hand-over is seamless.
	for (const n of nodes.values()) {
		if (n.x == null) {
			const p = n.parentNode ?? hub;
			n.x = p.x + (Math.random() - 0.5) * 20;
			n.y = p.y + (Math.random() - 0.5) * 20;
		}
	}
	const open = new Set([0]);
	const visible = () => {
		const out = [];
		const add = (n) => {
			out.push(n);
			if (open.has(n.id)) n.children.forEach(add);
		};
		add(hub);
		return out;
	};

	// ---- drawing ----
	const edgeG = el('g', { class: 'edges' }, live);
	const nodeG = el('g', {}, live);
	const views = new Map();
	const viewFor = (n) => {
		let v = views.get(n.id);
		if (v) return v;
		if (n === hub) {
			const g = el('g', { class: 'hubg' });
			if (data.kind === 'org' && data.photo) {
				el('circle', { class: 'hub', r: 38 }, g);
				el('image', { href: data.photo, x: -27, y: -19, width: 54, height: 38, preserveAspectRatio: 'xMidYMid meet' }, g);
			} else if (data.photo) {
				const clip = el('clipPath', { id: 'lp-hub-live' }, g);
				el('circle', { r: 38 }, clip);
				el('circle', { class: 'hub', r: 40 }, g);
				el('image', { href: data.photo, x: -38, y: -38, width: 76, height: 76, 'clip-path': 'url(#lp-hub-live)', preserveAspectRatio: 'xMidYMid slice' }, g);
			} else {
				el('circle', { class: 'hub', r: 38 }, g);
				el('text', { class: 'initials', y: 9 }, g).textContent = data.initials;
			}
			v = { g, edge: null };
		} else {
			const wrap = n.href ? el('a', { href: n.href }) : el('g', { tabindex: 0, role: 'button', 'aria-expanded': 'false' });
			if (n.href && data.preview && !n.href.startsWith('#')) {
				wrap.setAttribute('target', '_blank');
				wrap.setAttribute('rel', 'noopener');
			}
			wrap.setAttribute('class', `n ${n.kind} d${Math.min(n.depth, 3)}`);
			wrap.setAttribute('aria-label', n.label);
			const c = el('circle', { r: n.r }, wrap);
			let pic;
			if (n.image) {
				const id = `lp-c${n.id}`;
				const clip = el('clipPath', { id }, wrap);
				el('circle', { r: n.r - 2 }, clip);
				pic = el('image', { href: n.image, x: -(n.r - 2), y: -(n.r - 2), width: (n.r - 2) * 2, height: (n.r - 2) * 2, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice' }, wrap);
			} else {
				const s = Math.round(n.r * 1.05);
				pic = el('use', { href: `#i-${n.icon}`, x: -s / 2, y: -s / 2, width: s, height: s, class: n.ic }, wrap);
				if (n.st) pic.setAttribute('style', n.st);
			}
			let badge = null;
			if (n.kind === 'group' && n.children.length) {
				badge = el('g', { class: 'badge' }, wrap);
				el('circle', { r: 8 }, badge);
				el('text', { y: 3.5 }, badge).textContent = String(n.children.length);
			}
			const label = el('text', { class: 'lbl' }, wrap);
			for (const [i, line] of (n.lines || [n.label]).entries()) {
				const t = el('tspan', { dy: i ? 13 : 0 }, label);
				t.textContent = line;
			}
			v = { g: wrap, circle: c, pic, label, badge, edge: el('line', { class: n.depth > 1 ? 'e2' : '' }) };
			wrap.addEventListener('focus', () => {
				focusNode = n;
				// Only keyboard focus opens a group; a click or tap is handled once, by the click handler.
				if (n.kind === 'group' && keyboard) expand(n);
			});
			wrap.addEventListener('keydown', (e) => {
				if ((e.key === 'Enter' || e.key === ' ') && n.kind === 'group') {
					e.preventDefault();
					open.has(n.id) ? collapse(n) : expand(n);
				}
			});
			wrap.addEventListener('click', (e) => {
				if (dragMoved) {
					e.preventDefault();
					return;
				}
				if (n.kind === 'group') {
					e.preventDefault();
					if (!open.has(n.id)) expand(n);
					else if (performance.now() - (openedAt.get(n.id) ?? 0) > 450) collapse(n);
				} else if (n.href && n.href.startsWith('#')) {
					// A note, not a link: go back to the list with it open.
					e.preventDefault();
					document.querySelector('.back')?.click();
					const d = document.querySelector(n.href);
					if (d) {
						d.open = true;
						d.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
					}
				}
			});
			wrap.addEventListener('pointerdown', (e) => beginDrag(e, n));
		}
		views.set(n.id, v);
		return v;
	};

	let shown = [];
	const sync = () => {
		shown = visible();
		const want = new Set(shown.map((n) => n.id));
		for (const [id, v] of views) {
			const on = want.has(id);
			if (on && !v.g.isConnected) {
				nodeG.appendChild(v.g);
				if (v.edge) edgeG.appendChild(v.edge);
			} else if (!on && v.g.isConnected) {
				v.g.remove();
				v.edge?.remove();
			}
		}
		for (const n of shown) {
			const v = viewFor(n);
			if (!v.g.isConnected) {
				nodeG.appendChild(v.g);
				if (v.edge) edgeG.appendChild(v.edge);
				v.g.animate?.([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: reduce ? 0 : 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
			}
			if (n.kind === 'group') {
				v.g.setAttribute('aria-expanded', open.has(n.id) ? 'true' : 'false');
				if (v.badge) v.badge.style.display = open.has(n.id) ? 'none' : '';
			}
		}
		nodeG.appendChild(viewFor(hub).g);
	};

	const draw = () => {
		for (const n of shown) {
			const v = views.get(n.id);
			if (n === hub) {
				v.g.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
				continue;
			}
			v.circle.setAttribute('cx', n.x.toFixed(1));
			v.circle.setAttribute('cy', n.y.toFixed(1));
			const s = Number(v.pic.getAttribute('width'));
			v.pic.setAttribute('x', (n.x - s / 2).toFixed(1));
			v.pic.setAttribute('y', (n.y - s / 2).toFixed(1));
			const clip = v.g.querySelector('clipPath circle');
			if (clip) {
				clip.setAttribute('cx', n.x.toFixed(1));
				clip.setAttribute('cy', n.y.toFixed(1));
			}
			// Labels sit on the side away from the centre.
			const dx = n.x - (n.parentNode?.x ?? 0);
			const dy = n.y - (n.parentNode?.y ?? 0);
			const below = dy >= -Math.abs(dx) * 0.35;
			const extra = ((n.lines?.length || 1) - 1) * 13;
			v.label.setAttribute('x', n.x.toFixed(1));
			v.label.setAttribute('y', (below ? n.y + n.r + 14 : n.y - n.r - 7 - extra).toFixed(1));
			for (const t of v.label.children) t.setAttribute('x', n.x.toFixed(1));
			if (v.badge) v.badge.setAttribute('transform', `translate(${(n.x + n.r * 0.72).toFixed(1)} ${(n.y - n.r * 0.72).toFixed(1)})`);
			const p = n.parentNode;
			const ex = n.x - p.x;
			const ey = n.y - p.y;
			const d = Math.hypot(ex, ey) || 1;
			v.edge.setAttribute('x1', (p.x + (ex / d) * p.r).toFixed(1));
			v.edge.setAttribute('y1', (p.y + (ey / d) * p.r).toFixed(1));
			v.edge.setAttribute('x2', (n.x - (ex / d) * n.r).toFixed(1));
			v.edge.setAttribute('y2', (n.y - (ey / d) * n.r).toFixed(1));
			v.g.classList.toggle('near', n === nearNode);
		}
		svg.setAttribute('viewBox', cam.map((c) => c.toFixed(1)).join(' '));
	};

	// ---- physics ----
	let alpha = 1;
	const tick = () => {
		const list = shown;
		for (let i = 0; i < list.length; i++) {
			const a = list[i];
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 0.01) {
					dx = Math.random() - 0.5;
					dy = Math.random() - 0.5;
					d2 = 0.25;
				}
				const d = Math.sqrt(d2);
				const min = a.r + b.r + 26;
				// Charge, plus a firm push when two nodes and their labels would overlap.
				let f = (2600 * alpha) / d2;
				if (d < min) f += ((min - d) / d) * 0.5;
				const fx = dx * f;
				const fy = dy * f;
				if (!a.fixed) {
					a.vx -= fx;
					a.vy -= fy;
				}
				if (!b.fixed) {
					b.vx += fx;
					b.vy += fy;
				}
			}
		}
		for (const n of list) {
			if (n === hub || n.fixed) continue;
			const p = n.parentNode;
			const rest = n.depth === 1 ? 135 : n.kind === 'group' ? 95 : 78;
			const dx = n.x - p.x;
			const dy = n.y - p.y;
			const d = Math.hypot(dx, dy) || 1;
			const k = 0.06 * ((d - rest) / d);
			n.vx -= dx * k;
			n.vy -= dy * k;
			if (!p.fixed) {
				p.vx += dx * k * 0.3;
				p.vy += dy * k * 0.3;
			}
			// A gentle pull outwards along the parent's own direction keeps subtrees fanned, not folded back.
			if (n.depth > 1) {
				const gp = p.parentNode ?? hub;
				const ox = p.x - gp.x;
				const oy = p.y - gp.y;
				const od = Math.hypot(ox, oy) || 1;
				n.vx += (ox / od) * 0.6 * alpha;
				n.vy += (oy / od) * 0.6 * alpha;
			}
		}
		let energy = 0;
		for (const n of list) {
			if (n.fixed) {
				n.vx = n.vy = 0;
				continue;
			}
			n.vx *= 0.72;
			n.vy *= 0.72;
			n.x += n.vx;
			n.y += n.vy;
			energy += n.vx * n.vx + n.vy * n.vy;
		}
		alpha = Math.max(alpha * 0.975, 0.04);
		return energy / Math.max(list.length, 1);
	};

	// ---- camera: fits whatever is open, easing towards it ----
	const box = () => svg.getBoundingClientRect();
	let cam = data.view.slice();
	const target = () => {
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const n of shown) {
			x0 = Math.min(x0, n.x - n.r - 70);
			x1 = Math.max(x1, n.x + n.r + 70);
			y0 = Math.min(y0, n.y - n.r - 34 - ((n.lines?.length || 1) - 1) * 13);
			y1 = Math.max(y1, n.y + n.r + 40 + ((n.lines?.length || 1) - 1) * 13);
		}
		const b = box();
		const aspect = b.width / Math.max(b.height, 1) || 1;
		let w = Math.max(x1 - x0, 360);
		let h = Math.max(y1 - y0, 360);
		if (w / h > aspect) h = w / aspect;
		else w = h * aspect;
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2;
		return [cx - w / 2, cy - h / 2, w, h];
	};
	const ease = () => {
		const t = target();
		let moved = 0;
		cam = cam.map((c, i) => {
			const nv = reduce ? t[i] : c + (t[i] - c) * 0.1;
			moved += Math.abs(nv - c);
			return nv;
		});
		return moved;
	};

	// ---- loop: runs only while something is moving ----
	let raf = 0;
	let paused = false;
	const frame = () => {
		raf = 0;
		if (paused) return;
		const e = tick();
		const m = ease();
		draw();
		if (e > 0.004 || m > 0.3 || dragging) raf = requestAnimationFrame(frame);
	};
	const kick = (a = 0.9) => {
		alpha = Math.max(alpha, a);
		if (reduce) {
			for (let i = 0; i < 260; i++) tick();
			ease();
			draw();
			return;
		}
		if (!raf && !paused) raf = requestAnimationFrame(frame);
	};

	// ---- opening and closing ----
	const expand = (n) => {
		if (n.kind !== 'group' || open.has(n.id)) return;
		for (let a = n.parentNode; a && a !== hub; a = a.parentNode) open.add(a.id);
		open.add(n.id);
		const p = n.parentNode ?? hub;
		const base = Math.atan2(n.y - p.y, n.x - p.x);
		n.children.forEach((c, i) => {
			const spread = Math.min(Math.PI * 0.9, 0.5 * n.children.length);
			const a = base + (n.children.length > 1 ? -spread / 2 + (i * spread) / (n.children.length - 1) : 0);
			c.x = n.x + Math.cos(a) * 12;
			c.y = n.y + Math.sin(a) * 12;
			c.vx = Math.cos(a) * 6;
			c.vy = Math.sin(a) * 6;
		});
		lastNear.set(n.id, performance.now());
		openedAt.set(n.id, performance.now());
		sync();
		kick(0.8);
	};
	const collapse = (n) => {
		if (!open.has(n.id) || n === hub) return;
		const close = (x) => {
			open.delete(x.id);
			x.children.forEach(close);
		};
		close(n);
		sync();
		kick(0.5);
	};

	// ---- pointer: approach opens, distance closes ----
	let nearNode = null;
	let focusNode = null;
	const lastNear = new Map();
	const openedAt = new Map();
	let keyboard = false;
	addEventListener('keydown', (e) => {
		if (e.key === 'Tab' || e.key.startsWith('Arrow')) keyboard = true;
	});
	addEventListener('pointerdown', () => (keyboard = false), true);
	const toWorld = (e) => {
		const b = box();
		return [cam[0] + ((e.clientX - b.left) / b.width) * cam[2], cam[1] + ((e.clientY - b.top) / b.height) * cam[3]];
	};
	const isAncestor = (a, n) => {
		for (let x = n; x; x = x.parentNode) if (x === a) return true;
		return false;
	};
	let pending = null;
	const onMove = (e) => {
		if (dragging) return;
		pending = e;
		if (onMove.raf) return;
		onMove.raf = requestAnimationFrame(() => {
			onMove.raf = 0;
			const [wx, wy] = toWorld(pending);
			const now = performance.now();
			let best = null;
			let bestD = Infinity;
			for (const n of shown) {
				const d = Math.hypot(n.x - wx, n.y - wy) - n.r;
				if (d < bestD) {
					bestD = d;
					best = n;
				}
				if (n.kind === 'group' && d < 46) lastNear.set(n.id, now);
			}
			const prev = nearNode;
			nearNode = bestD < 34 ? best : null;
			if (nearNode && nearNode.kind === 'group' && bestD < 26) expand(nearNode);
			for (let a = nearNode; a; a = a.parentNode) lastNear.set(a.id, now);
			// Close groups the pointer has left behind for a moment (never the one being looked at, or its line).
			for (const id of [...open]) {
				const g = nodes.get(id);
				if (!g || g === hub) continue;
				if (nearNode && (isAncestor(g, nearNode) || isAncestor(nearNode, g))) continue;
				if (focusNode && isAncestor(g, focusNode)) continue;
				const sub = [];
				const add = (x) => {
					sub.push(x);
					if (open.has(x.id)) x.children.forEach(add);
				};
				add(g);
				const dist = Math.min(...sub.map((x) => Math.hypot(x.x - wx, x.y - wy)));
				if (dist > 150 && now - (lastNear.get(id) ?? 0) > 900) collapse(g);
			}
			if (prev !== nearNode) draw();
		});
	};

	// ---- dragging a node ----
	let dragging = null;
	let dragMoved = false;
	let dragStart = null;
	let dragPointer = 0;
	const beginDrag = (e, n) => {
		if (e.button !== 0) return;
		dragging = n;
		dragMoved = false;
		dragStart = [e.clientX, e.clientY];
		dragPointer = e.pointerId;
	};
	svg.addEventListener('pointermove', (e) => {
		if (!dragging) return onMove(e);
		if (!dragMoved && Math.hypot(e.clientX - dragStart[0], e.clientY - dragStart[1]) > 5) {
			// Capture only once it is really a drag, so a plain click still reaches the link or group.
			dragMoved = true;
			dragging.fixed = true;
			svg.setPointerCapture?.(dragPointer);
		}
		if (!dragMoved) return;
		const [wx, wy] = toWorld(e);
		dragging.x = wx;
		dragging.y = wy;
		kick(0.3);
	});
	const endDrag = () => {
		if (!dragging) return;
		if (dragging !== hub) dragging.fixed = false;
		dragging = null;
		setTimeout(() => (dragMoved = false), 0);
		kick(0.3);
	};
	svg.addEventListener('pointerup', endDrag);
	svg.addEventListener('pointercancel', endDrag);
	svg.addEventListener('pointerleave', () => {
		nearNode = null;
		draw();
	});

	// ---- hand-over from the static drawing ----
	for (const n of staticLayer) n.remove?.();
	svg.appendChild(live);
	svg.removeAttribute('role');
	svg.setAttribute('aria-label', `Map of ${data.name}'s links`);
	sync();
	draw();
	kick(0.6);

	const pause = () => {
		paused = true;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
	};
	addEventListener('lp-map-off', () => {
		if (matchMedia('(max-width: 56rem)').matches) pause();
		else requestAnimationFrame(() => started.resume());
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) pause();
		else if (map.classList.contains('live')) started.resume();
	});
	started = {
		resume() {
			paused = false;
			kick(0.3);
		},
	};
}
