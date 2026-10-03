// Link pages (amy.bo/~name): data model shared by the page renderer, the editor and the API.

export type NodeKind = 'group' | 'link' | 'text' | 'diary' | 'support' | 'entry';

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
	/** The newest entries the diary shows when opened (highlights only, if that is the owner's default). */
	diaryRecent: DiaryEntry[];
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/** Builds the tree from flat rows, ordered by position. Orphans (missing parent) go to the root. */
export function buildTree(rows: Omit<LinkNode, 'children'>[]): LinkNode[] {
	const byId = new Map<number, LinkNode>();
	for (const r of rows) byId.set(r.id, { ...r, children: [] });
	const roots: LinkNode[] = [];
	for (const n of byId.values()) {
		const parent = n.parent_id != null ? byId.get(n.parent_id) : undefined;
		(parent && parent.kind === 'group' ? parent.children : roots).push(n);
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

/** How many diary entries a page shows when its diary is opened; the rest are on the diary page. */
export const DIARY_ON_PAGE = 8;

/** Every item of a person's page, with its picture style. */
export const NODE_SELECT = `SELECT n.id, n.parent_id, n.kind, n.slug, n.label, n.url, n.icon, n.image, n.body, n.seed, n.position,
	COALESCE(s.tint, '') AS tint, COALESCE(s.zoom, 1) AS zoom
	FROM lp_nodes n LEFT JOIN lp_node_style s ON s.node_id = n.id WHERE n.person_id = ?`;

export async function loadPage(db: D1Database, handle: string): Promise<PageData | null> {
	const person = await db
		.prepare(
			`SELECT p.id, p.handle, p.name, p.bio, p.photo, p.kind, p.basic_mode, p.diary_default, COALESCE(s.accent, '') AS accent
			 FROM lp_people p LEFT JOIN lp_page_style s ON s.person_id = p.id WHERE p.handle = ? AND p.status = 'active'`,
		)
		.bind(handle)
		.first<Person>();
	if (!person) return null;
	const [nodes, diary] = await db.batch([
		db.prepare(NODE_SELECT).bind(person.id),
		db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(highlight), 0) AS h FROM lp_diary WHERE person_id = ?').bind(person.id),
	]);
	const counts = (diary.results[0] ?? { n: 0, h: 0 }) as { n: number; h: number };
	const onlyHighlights = person.diary_default === 'highlights' && counts.h > 0;
	const recent = counts.n ? (await loadDiary(db, person.id, onlyHighlights)).slice(0, DIARY_ON_PAGE) : [];
	return { person, roots: buildTree(nodes.results as Omit<LinkNode, 'children'>[]), diaryCount: counts.n, highlightCount: counts.h, diaryRecent: recent };
}

export async function loadDiary(db: D1Database, personId: number, highlightsOnly: boolean): Promise<DiaryEntry[]> {
	const { results } = await db
		.prepare(`SELECT id, day, title, body, highlight FROM lp_diary WHERE person_id = ? ${highlightsOnly ? 'AND highlight = 1' : ''} ORDER BY day DESC, id DESC LIMIT 500`)
		.bind(personId)
		.all<DiaryEntry>();
	return results;
}
