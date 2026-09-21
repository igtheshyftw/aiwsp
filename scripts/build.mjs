import {build as viteBuild} from 'vite';
import {build as esbuild} from 'esbuild';
import {rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await viteBuild({configFile:'vite.config.ts'});
await esbuild({entryPoints:['server/index.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:'dist/server.mjs',packages:'external',alias:{'@':process.cwd()},tsconfig:'tsconfig.json'});
console.log('Standalone client and server built.');
