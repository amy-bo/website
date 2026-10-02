// Link pages admin: invite people, enable or disable pages, and see views and clicks. Behind Cloudflare Access
// via ../_middleware.ts; changes go through /api/admin/links/*, which has its own Access check.
import type { Env } from '../../../src/links/server';
import { esc } from '../../../src/links/render';
import { pagePath } from '../../../src/links/model';

interface PersonRow { id: number; handle: string; name: string; email: string; kind: string; status: string; last_sign_in: string | null }
interface CountRow { page: string; slug: string; total: number; d30: number; d7: number }
interface NodeRow { handle: string; slug: string; label: string; seed: number; kind: string }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
	const [people, counts, nodes] = await env.DB.batch([
		env.DB.prepare('SELECT id, handle, name, email, kind, status, last_sign_in FROM lp_people ORDER BY handle'),
		env.DB.prepare(
			`SELECT page, slug, COUNT(*) AS total,
				SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS d30,
				SUM(at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days')) AS d7
			 FROM link_events GROUP BY page, slug`,
		),
		env.DB.prepare(`SELECT p.handle, n.slug, n.label, n.seed, n.kind FROM lp_nodes n JOIN lp_people p ON p.id = n.person_id WHERE n.kind = 'link'`),
	]);
	const c = counts.results as unknown as CountRow[];
	const get = (page: string, slug: string) => c.find((r) => r.page === page && r.slug === slug) ?? { total: 0, d30: 0, d7: 0 };
	const rows = people.results as unknown as PersonRow[];

	const peopleTable = rows
		.map((p) => {
			const v = get(p.handle, '_view');
			const action =
				p.status === 'disabled'
					? `<button data-act="enable" data-id="${p.id}">Enable</button>`
					: `${p.status === 'invited' ? `<button data-act="resend" data-id="${p.id}">Resend invite</button> ` : ''}<button data-act="disable" data-id="${p.id}">Disable</button>`;
			const email = `${esc(p.email)}${p.email.endsWith('.invalid') ? ' <b>(placeholder)</b>' : ''} <button data-act="email" data-id="${p.id}" data-email="${esc(p.email)}">Change</button>`;
			return `<tr><td><a href="${pagePath(p.handle)}">${esc(pagePath(p.handle))}</a></td><td>${esc(p.name)}</td><td>${email}</td><td>${esc(p.status)}</td><td>${esc(p.last_sign_in?.slice(0, 10) ?? '')}</td><td>${v.d30}</td><td>${action}</td></tr>`;
		})
		.join('');

	const stats = rows
		.filter((p) => p.status === 'active')
		.map((p) => {
			const v = get(p.handle, '_view');
			const links = (nodes.results as unknown as NodeRow[])
				.filter((n) => n.handle === p.handle)
				.map((n) => ({ n, s: get(p.handle, n.slug) }))
				.map((x) => ({ ...x, all: x.n.seed + x.s.total }))
				.sort((a, b) => b.all - a.all);
			const clicks = links.reduce((t, x) => t + x.s.total, 0);
			const rate = v.total ? `${Math.round((clicks / v.total) * 100)}%` : 'n/a';
			return `<h3><a href="${pagePath(p.handle)}">${esc(pagePath(p.handle))}</a></h3>
<p>Page views <b>${v.total}</b> (7 days ${v.d7}, 30 days ${v.d30}). Clicks <b>${clicks}</b>, ${rate} of views.</p>
<table><thead><tr><th>Link</th><th>7 days</th><th>30 days</th><th>Here</th><th>Before</th><th>All time</th></tr></thead><tbody>
${links.map(({ n, s, all }) => `<tr><td>${esc(n.label)}</td><td>${s.d7}</td><td>${s.d30}</td><td>${s.total}</td><td>${n.seed || ''}</td><td><b>${all}</b></td></tr>`).join('')}
</tbody></table>`;
		})
		.join('');

	const body = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link pages</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#14210f}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{padding:.4rem .5rem;border-bottom:1px solid #dde5d8;text-align:left;vertical-align:top}th{font-size:.8rem;color:#4b5d44}a{color:#175a00}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.6rem;align-items:end;padding:1rem;border:1px solid #dde5d8;border-radius:12px}label{display:grid;gap:.2rem;font-size:.85rem}input,select,button{font:inherit;padding:.45rem .6rem;border:1px solid #c9d6c0;border-radius:8px}button{background:#175a00;color:#fff;border-color:#175a00;cursor:pointer}td button{background:#fff;color:#175a00;padding:.2rem .5rem}#msg{min-height:1.4em;color:#175a00}</style>
<h1>Link pages</h1>
<h2>Invite someone</h2>
<form id="invite"><label>Email<input name="email" type="email" required></label><label>Name<input name="name" required></label><label>Address amy.bo/~<input name="handle" required pattern="[a-z0-9][a-z0-9-]{0,28}[a-z0-9]?" placeholder="gerrit"></label><label>Page type<select name="role"><option value="volunteer">Volunteer (with diary)</option><option value="supporter">Supporter</option><option value="both">Volunteer and supporter</option><option value="plain">Links only</option></select></label><button>Send invitation</button></form>
<p id="msg" role="status"></p>
<h2>Pages</h2>
<table><thead><tr><th>Page</th><th>Name</th><th>Email</th><th>Status</th><th>Last sign-in</th><th>Views 30 days</th><th></th></tr></thead><tbody>${peopleTable}</tbody></table>
<h2>Images</h2>
<p>Pictures people replace or remove are deleted straight away. This also clears uploads that never got used (older than a day). <button id="sweep">Tidy images</button></p>
<h2>Views and clicks</h2>
<p>People only: crawlers and link previews are skipped. Nothing is stored about visitors except the page, the link and the time. "Before" is the count carried over from Linktree.</p>
${stats}
<script>
const msg=document.getElementById('msg');
const post=(path,body)=>fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);return j;});
document.getElementById('invite').addEventListener('submit',e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));msg.textContent='Sending…';post('/api/admin/links/invite',f).then(()=>{msg.textContent='Invitation sent to '+f.email+'.';setTimeout(()=>location.reload(),1200)}).catch(err=>msg.textContent=err.message)});
document.getElementById('sweep').addEventListener('click',()=>{msg.textContent='Tidying…';post('/api/admin/links/sweep',{}).then(r=>msg.textContent='Removed '+r.removed+' unused image'+(r.removed===1?'':'s')+'; '+r.kept+' in use.').catch(err=>msg.textContent=err.message)});
document.querySelectorAll('td button').forEach(b=>b.addEventListener('click',()=>{let email;if(b.dataset.act==='email'){email=prompt('New sign-in email for this page',b.dataset.email.endsWith('.invalid')?'':b.dataset.email);if(!email)return;}msg.textContent='Working…';post('/api/admin/links/person',{id:Number(b.dataset.id),action:b.dataset.act,email}).then(()=>location.reload()).catch(err=>msg.textContent=err.message)}));
</script></html>`;
	return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
};
