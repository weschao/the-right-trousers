import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({stdin:{contents:"export {Input,Output,UrlSource,MP4,QTFF,Mp4OutputFormat,StreamTarget,Conversion,Quality,canEncodeVideo} from 'mediabunny';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',minify:true,outfile:'web/vendor/mediabunny.js',legalComments:'eof',banner:{js:'/* Mediabunny 1.66.0 · MPL-2.0 · see mediabunny.LICENSE. Source: https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.0.tgz */'}});
await copyFile('node_modules/mediabunny/LICENSE','web/vendor/mediabunny.LICENSE');
