#!/usr/bin/env node
/**
 * Accessibility scan of every built page with axe-core in jsdom (Lighthouse needs Chrome, which this
 * environment cannot download). Fails on any serious or critical violation. jsdom has no layout engine,
 * so colour contrast is reported by axe as "incomplete" rather than checked: review contrast in a browser.
 *   npm run build && npm run test:a11y
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk('dist').filter((f) => f.endsWith('.html')).sort();

let bad = 0;
const summary = {};
for (const file of files) {
	const html = readFileSync(file, 'utf8');
	const vc = new VirtualConsole();
	const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: `http://localhost/${file.replace(/^dist\//, '').replace(/index\.html$/, '')}`, virtualConsole: vc });
	dom.window.eval(axeSource);
	const res = await dom.window.axe.run(dom.window.document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false } } });
	const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	for (const v of res.violations) summary[`${v.impact} ${v.id}`] = (summary[`${v.impact} ${v.id}`] || 0) + 1;
	if (serious.length) {
		bad++;
		console.log(`\n✗ ${file}`);
		for (const v of serious) console.log(`  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
	}
	dom.window.close();
}
console.log(`\nScanned ${files.length} pages; ${bad} with serious or critical violations.`);
if (Object.keys(summary).length) console.log('All violations by impact and rule (pages affected):', summary);
process.exit(bad ? 1 : 0);
