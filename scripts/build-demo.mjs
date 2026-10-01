// Builds the online demo: one self-contained HTML file that runs IMS entirely in the browser (see demo/main.ts).
//   npm run build:demo   →  dist/demo/ims-demo.html   (open it in a browser, or send it to someone)
//                           dist/demo/ims-demo-page.html (the same page without the document wrapper, for hosts that add their own)
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

execFileSync(process.execPath, ['scripts/build.mjs'], {stdio: 'inherit'});
const root = process.cwd();
const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '');

// The server code for the browser, with Node-only modules replaced (demo/storage.ts, demo/stubs.ts).
const replace = {name: 'demo-replacements', setup(b) {
 b.onResolve({filter: /^(\.\.?\/)+storage$/}, a => a.importer.includes(`${root}/server`) ? {path: resolve(root, 'demo/storage.ts')} : undefined);
 b.onResolve({filter: /^(node:net|nodemailer)$/}, () => ({path: resolve(root, 'demo/stubs.ts')}));
}};
const server = await build({entryPoints: ['demo/main.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', minify: true,
 plugins: [replace], define: {Request: 'DemoRequest', Response: 'DemoResponse', Headers: 'DemoHeaders', IMS_DEMO_BUILD: JSON.stringify(stamp)}, logLevel: 'warning'});
const demoJs = server.outputFiles[0].text;

// The built app (dist/client), with its stylesheet and the icon font inlined.
const html = readFileSync('dist/client/index.html', 'utf8');
const asset = re => resolve('dist/client', html.match(re)[1].replace(/^\//, ''));
const appJs = readFileSync(asset(/src="([^"]+\.js)"/), 'utf8');
const woff2 = readFileSync(resolve('dist/client/assets', readFileSync(asset(/href="([^"]+\.css)"/), 'utf8').match(/fontawesome-webfont-[\w-]+\.woff2/)[0])).toString('base64');
const css = readFileSync(asset(/href="([^"]+\.css)"/), 'utf8')
 .replace(/@font-face\{font-family:\s*['"]?FontAwesome['"]?;[^}]*\}/, `@font-face{font-family:FontAwesome;src:url(data:font/woff2;base64,${woff2}) format("woff2");font-weight:400;font-style:normal}`);
if (/url\(\/assets/.test(css)) throw Error('A stylesheet asset was not inlined.');
const sqlJs = readFileSync('node_modules/sql.js/dist/sql-asm-memory-growth.js', 'utf8');
const script = js => js.replace(/<\/script/gi, '<\\/script');

const body = `<title>IMS Demo</title>
<style>${css}</style>
<div id="root"></div>
<script>${script(sqlJs)}</script>
<script>${script(demoJs)}</script>
<script type="module">${script(appJs)}</script>`;
mkdirSync('dist/demo', {recursive: true});
writeFileSync('dist/demo/ims-demo-page.html', body);
writeFileSync('dist/demo/ims-demo.html', `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${body.replace('<div id="root"></div>', '</head><body><div id="root"></div>')}
</body></html>`);
console.log(`Online demo built: dist/demo/ims-demo.html (${(readFileSync('dist/demo/ims-demo.html').length / 1048576).toFixed(1)} MB)`);
