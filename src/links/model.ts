// Link pages (amy.bo/~name): data model shared by the page renderer, the editor and the API.

export type NodeKind = 'group' | 'link' | 'text' | 'diary' | 'support';

export interface Person {
	id: number;
	handle: string;
	name: string;
	bio: string;
	photo: string;
	kind: 'person' | 'org';
	basic_mode: number;
	diary_default: 'all' | 'highlights';
	/** Page tint: '' for AMYBO green, or '#rrggbb'. */
	accent: string;
	/** The centre's picture when it isn't the photo (an icon or logo key), with its colour and size. */
	hub_icon: string;
	hub_tint: string;
	hub_zoom: number;
}

export interface LinkNode {
	id: number;
	parent_id: number | null;
	kind: NodeKind;
	slug: string;
	label: string;
	url: string;
	icon: string;
	image: string;
	body: string;
	seed: number;
	position: number;
	/** Picture colour: '' original, 'mono', or '#rrggbb'; and size within the circle (1 = normal). */
	tint: string;
	zoom: number;
	/** Optional short date, YY, YYMM or YYMMDD (diary entries), and whether it is a highlight. */
	day: string;
	highlight: number;
	children: LinkNode[];
}

export interface DiaryEntry {
	id: number;
	day: string;
	title: string;
	body: string;
	highlight: number;
}

export interface PageData {
	person: Person;
	roots: LinkNode[];
	diaryCount: number;
	highlightCount: number;
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/** Builds the tree from flat rows, ordered by position. Items sit in groups and diaries; orphans go to the root. */
export function buildTree(rows: Omit<LinkNode, 'children'>[]): LinkNode[] {
	const byId = new Map<number, LinkNode>();
	for (const r of rows) byId.set(r.id, { ...r, children: [] });
	const roots: LinkNode[] = [];
	for (const n of byId.values()) {
		const parent = n.parent_id != null ? byId.get(n.parent_id) : undefined;
		(parent && (parent.kind === 'group' || parent.kind === 'diary') ? parent.children : roots).push(n);
	}
	const sort = (list: LinkNode[]) => {
		list.sort((a, b) => a.position - b.position || a.id - b.id);
		list.forEach((n) => sort(n.children));
	};
	sort(roots);
	return roots;
}

export function* walk(nodes: LinkNode[]): Generator<LinkNode> {
	for (const n of nodes) {
		yield n;
		yield* walk(n.children);
	}
}

/** Public URL of an image field: "r2:<key>" is served from the bucket, anything else is a site path or URL. */
export const mediaUrl = (v: string) => (v.startsWith('r2:') ? `/links/media/${v.slice(3)}` : v);

/** The path of a person's page on the site ("/links" for AMYBO's own). */
export const pagePath = (handle: string) => (handle === 'amybo' ? '/links' : `/~${handle}`);

/** Every item of a person's page, with its picture style. */
export const NODE_SELECT = `SELECT n.id, n.parent_id, n.kind, n.slug, n.label, n.url, n.icon, n.image, n.body, n.seed, n.position,
	COALESCE(m.tint, '') AS tint, COALESCE(m.zoom, 1) AS zoom, COALESCE(m.day, '') AS day, COALESCE(m.highlight, 0) AS highlight
	FROM lp_nodes n LEFT JOIN lp_node_meta m ON m.node_id = n.id WHERE n.person_id = ?`;

/** The person's row with their page settings. */
export const PERSON_SELECT = `SELECT p.id, p.handle, p.email, p.name, p.bio, p.photo, p.kind, p.basic_mode, p.diary_default,
	COALESCE(m.accent, '') AS accent, COALESCE(m.hub_icon, '') AS hub_icon, COALESCE(m.hub_tint, '') AS hub_tint, COALESCE(m.hub_zoom, 1) AS hub_zoom
	FROM lp_people p LEFT JOIN lp_page_meta m ON m.person_id = p.id`;

/** Diary entries: everything inside a diary item that isn't a group, at any depth. */
export function diaryEntries(roots: LinkNode[]): LinkNode[] {
	const out: LinkNode[] = [];
	const collect = (list: LinkNode[]) => list.forEach((n) => (n.kind === 'group' ? collect(n.children) : out.push(n)));
	for (const n of walk(roots)) if (n.kind === 'diary') collect(n.children);
	return out;
}

/** Newest first; undated entries keep their place after the dated ones. Partial dates sort as their start. */
export const byDate = (a: LinkNode, b: LinkNode) => (b.day.padEnd(6, '0') > a.day.padEnd(6, '0') ? 1 : b.day.padEnd(6, '0') < a.day.padEnd(6, '0') ? -1 : a.position - b.position);

export async function loadPage(db: D1Database, handle: string): Promise<PageData | null> {
	const person = await db.prepare(`${PERSON_SELECT} WHERE p.handle = ? AND p.status = 'active'`).bind(handle).first<Person>();
	if (!person) return null;
	const nodes = await db.prepare(NODE_SELECT).bind(person.id).all<Omit<LinkNode, 'children'>>();
	const roots = buildTree(nodes.results);
	const entries = diaryEntries(roots);
	return { person, roots, diaryCount: entries.length, highlightCount: entries.filter((e) => e.highlight).length };
}

