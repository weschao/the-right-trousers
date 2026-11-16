import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('artifacts/cloud',{recursive:true});
await build({entryPoints:['supabase/functions/trt-api/index.js'],bundle:true,format:'esm',platform:'neutral',target:'es2022',outfile:'artifacts/cloud/trt-api.js',minify:true});
console.log('Built Supabase Edge Function: artifacts/cloud/trt-api.js');
