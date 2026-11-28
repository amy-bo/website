// Remote access admin: experiments (each Pi, its address and Access application), applications, and who each Pi lets in.
// Behind Cloudflare Access via ../_middleware.ts; changes go through /api/admin/remote, which has its own Access check.
import { accessApiReady } from '../../../src/remote/access';
import { type ApplicationRow, deleteFrom, type ExperimentRow, hostnameWarning, letsPeopleIn, parseList, sameList } from '../../../src/remote/core';
import { type Env, wantedList } from '../../../src/remote/server';
import { escapeHtml as esc } from '../../../eventsandeye/src/util';

const STATUS_LABEL: Record<string, string> = { unconfirmed: 'Email not confirmed', pending: 'Waiting for you', approved: 'Assigned', rejected: 'Rejected' };

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
	const [expsR, appsR] = await env.DB.batch([
		env.DB.prepare('SELECT * FROM remote_experiments ORDER BY status = \'closed\', name'),
		env.DB.prepare(`SELECT * FROM remote_applications ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'unconfirmed' THEN 2 ELSE 3 END, created_at DESC`),
	]);
	const exps = expsR.results as unknown as ExperimentRow[];
	const apps = appsR.results as unknown as ApplicationRow[];
	const byId = new Map(exps.map((e) => [e.id, e]));
	const api = accessApiReady(env);

	const options = (selected: number | null) => exps.filter((e) => e.status !== 'closed' || e.id === selected).map((e) => `<option value="${e.id}"${e.id === selected ? ' selected' : ''}>${esc(e.name)}</option>`).join('');

	const expBlocks = await Promise.all(exps.map(async (e) => {
		const want = await wantedList(env, e);
		const have = parseList(e.synced_emails);
		const inSync = !!have && sameList(have, want);
		const waiting = apps.filter((a) => a.experiment_id === e.id && a.status === 'approved' && !a.access_emailed_at).length;
		const assigned = apps.filter((a) => a.experiment_id === e.id && a.status === 'approved').length;
		const warn = hostnameWarning(e.hostname);
		const auto = api && e.access_app_id;
		const state = inSync
			? `<span class="ok">Access policy up to date</span>${e.synced_at ? ` (${esc(e.synced_at.slice(0, 16).replace('T', ' '))} UTC)` : ''}`
			: `<span class="bad">Access policy needs updating</span>`;
		const how = auto
			? `<button data-act="experiment.sync" data-id="${e.id}">Sync now</button>`
			: `<p class="help">${api ? 'Add the Access application id above to sync automatically.' : 'Automatic sync is off (no CF_ACCESS_API_TOKEN / CF_ACCOUNT_ID).'} In Cloudflare: Zero Trust → Access → Applications → <b>${esc(e.name)}</b> → Policies → <b>AMYBO remote</b> → Include → Emails: replace the list with the one below, Save, then click the button.</p><button data-act="experiment.mark_synced" data-id="${e.id}">I've pasted it</button>`;
		return `<section class="exp">
<h3>${esc(e.name)} <small>${esc(e.status)}${letsPeopleIn(e) ? ', letting people in' : ''}</small></h3>
<form class="grid" data-exp="${e.id}">
<label>Name<input name="name" value="${esc(e.name)}" required maxlength="80"></label>
<label>Pi address (host name)<input name="hostname" value="${esc(e.hostname)}" required></label>
<label>Status<select name="status">${['planned', 'open', 'closed'].map((s) => `<option${s === e.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<label>Last day of the course<input type="date" name="ends_on" value="${esc(e.ends_on ?? '')}"></label>
<label>Access application id<input name="access_app_id" value="${esc(e.access_app_id ?? '')}" placeholder="from the application's Overview"></label>
<label class="tick"><input type="checkbox" name="offered"${e.offered ? ' checked' : ''}> Offer on the form</label>
<button>Save</button>
</form>
${warn ? `<p class="bad">${esc(warn)}</p>` : ''}
${e.ends_on ? '' : '<p class="help">Set the last day of the course: after it only the admins are let in, and the applications are deleted 30 days later.</p>'}
<p>Open <a href="https://${esc(e.hostname)}/">https://${esc(e.hostname)}/</a>. ${assigned} assigned. ${state}.${e.sync_error ? ` <span class="bad">Last sync failed: ${esc(e.sync_error)}</span>` : ''}</p>
<label>Allowed emails (the admins always, plus the assigned people while the experiment is open)<textarea readonly rows="2">${esc(want.join(', '))}</textarea></label>
${how}
${waiting ? ` <button data-act="experiment.email_links" data-id="${e.id}">Email access links (${waiting} waiting)</button>` : ''}
</section>`;
	}));

	const rows = apps.map((a) => {
		const exp = a.experiment_id ? byId.get(a.experiment_id) ?? null : null;
		const wish = a.wish_experiment_id ? byId.get(a.wish_experiment_id)?.name ?? '' : '';
		const wishText = [wish, a.wish_text].filter(Boolean).join(': ');
		const course = exp ?? (a.wish_experiment_id ? byId.get(a.wish_experiment_id) ?? null : null);
		const actions = a.status === 'unconfirmed'
			? `<button data-act="application.delete" data-id="${esc(a.id)}">Delete</button>`
			: `<select data-for="${esc(a.id)}">${options(a.experiment_id ?? a.wish_experiment_id)}</select> <button data-act="application.assign" data-id="${esc(a.id)}">${a.status === 'approved' ? 'Move' : 'Assign'}</button>${a.status === 'approved' ? ` <button data-act="application.unassign" data-id="${esc(a.id)}">Unassign</button>` : ''}${a.status !== 'rejected' ? ` <button data-act="application.reject" data-id="${esc(a.id)}">Reject</button>` : ''} <button data-act="application.delete" data-id="${esc(a.id)}">Delete</button>`;
		return `<tr><td><b>${esc(a.name)}</b><br>${esc(a.email)}<br><small>${esc(a.institution)}</small></td><td>${esc(wishText)}</td><td class="why">${esc(a.reason)}</td><td>${esc(STATUS_LABEL[a.status] ?? a.status)}${exp ? `<br><b>${esc(exp.name)}</b>${a.access_emailed_at ? '<br><small>link emailed</small>' : ''}` : ''}</td><td><small>applied ${esc(a.created_at.slice(0, 10))}<br>deleted from ${esc(deleteFrom(a, course))}</small></td><td>${actions}</td></tr>`;
	}).join('');

	const body = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remote access</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#14210f}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{padding:.45rem .5rem;border-bottom:1px solid #dde5d8;text-align:left;vertical-align:top}th{font-size:.8rem;color:#4b5d44}td.why{max-width:22rem;white-space:pre-wrap}a{color:#175a00}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.6rem;align-items:end}label{display:grid;gap:.2rem;font-size:.85rem}label.tick{display:flex;gap:.4rem;align-items:center}input,select,button,textarea{font:inherit;padding:.4rem .6rem;border:1px solid #c9d6c0;border-radius:8px}textarea{width:100%;box-sizing:border-box}button{background:#175a00;color:#fff;border-color:#175a00;cursor:pointer}td button{background:#fff;color:#175a00;padding:.2rem .5rem}.exp{padding:1rem;border:1px solid #dde5d8;border-radius:12px;margin:1rem 0}.exp h3{margin-top:0}.exp h3 small{font-weight:normal;color:#4b5d44}.ok{color:#175a00;font-weight:600}.bad{color:#b3261e;font-weight:600}.help{color:#4b5d44;font-size:.9rem}#msg{min-height:1.4em;color:#175a00;font-weight:600;position:sticky;top:0;background:#fff;padding:.3rem 0}</style>
<h1>Remote access</h1>
<p class="help">People apply at <a href="/remote/">amybo.org/remote</a> and confirm their email. Assign them to an experiment: its Pi's Cloudflare Access policy then lets them in (they sign in with a one-time code Cloudflare emails them), and they get an email with the link. Unassign, reject or delete someone to take them off straight away. ${api ? 'Automatic sync with Cloudflare Access is <b>on</b>.' : 'Automatic sync with Cloudflare Access is <b>off</b>: each experiment shows the list to paste into its policy.'}</p>
<p id="msg" role="status"></p>
<h2>Applications</h2>
<table><thead><tr><th>Person</th><th>Asked for</th><th>Why</th><th>Status</th><th>Dates</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">No applications yet.</td></tr>'}</tbody></table>
<h2>Experiments</h2>
${expBlocks.join('')}
<section class="exp"><h3>New experiment</h3>
<form class="grid" data-exp="">
<label>Name<input name="name" required maxlength="80"></label>
<label>Pi address (host name)<input name="hostname" required placeholder="remote-name.amybo.org"></label>
<label>Status<select name="status"><option>planned</option><option>open</option><option>closed</option></select></label>
<label>Last day of the course<input type="date" name="ends_on"></label>
<label>Access application id<input name="access_app_id"></label>
<label class="tick"><input type="checkbox" name="offered" checked> Offer on the form</label>
<button>Add</button>
</form></section>
<script>
const msg=document.getElementById('msg');
const post=(body)=>fetch('/api/admin/remote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw new Error(j.error||r.statusText);return j;});
const report=(j)=>{const a=j.access;let t='Saved.';if(a){t+=a.mode==='api'?(a.inSync?' Access policy updated.':' Access policy NOT updated: '+a.error):' Paste the new list into the Access policy, then click “I’ve pasted it”.';if(a.others&&a.others.length)t+=' Note: the policy also has rules ('+a.others.join(', ')+') that let other people in.';}if(j.emailed)t+=' Access link emailed.';if(j.sent!==undefined)t='Emailed '+j.sent+' access link'+(j.sent===1?'':'s')+'.';return t;};
const go=(body,confirmText)=>{if(confirmText&&!confirm(confirmText))return;msg.textContent='Working…';post(body).then(j=>{msg.textContent=report(j);setTimeout(()=>location.reload(),2500)}).catch(e=>msg.textContent=e.message)};
document.querySelectorAll('form[data-exp]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));go({action:'experiment.save',id:f.dataset.exp?Number(f.dataset.exp):undefined,name:d.name,hostname:d.hostname,status:d.status,ends_on:d.ends_on,access_app_id:d.access_app_id,offered:d.offered==='on'})}));
const ask={'application.delete':'Delete this application? It cannot be undone.','application.reject':'Reject this application? (No email is sent.)'};
document.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>{const act=b.dataset.act;const body={action:act,id:act.startsWith('experiment.')?Number(b.dataset.id):b.dataset.id};if(act==='application.assign'){const s=document.querySelector('select[data-for="'+b.dataset.id+'"]');if(!s||!s.value){msg.textContent='Add an experiment first.';return;}body.experiment_id=Number(s.value);}go(body,ask[act])}));
</script></html>`;
	return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
};
