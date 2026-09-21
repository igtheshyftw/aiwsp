import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':resolve(process.cwd())}},build:{outDir:'dist/client',emptyOutDir:true},publicDir:'public'});
