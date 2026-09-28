import {readFile,writeFile} from 'node:fs/promises';
import {readStattoZip,convertStatto} from '../web/statto.js';
const [input,output]=process.argv.slice(2);if(!input||!output){console.error('Usage: node scripts/convert-statto.mjs input.statto output.json');process.exit(1);}
const bytes=await readFile(input);const raw=await readStattoZip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));const converted=convertStatto(raw);await writeFile(output,JSON.stringify(converted,null,2));console.log(JSON.stringify({teams:converted.teams.length,games:converted.games.length,points:converted.games.reduce((s,g)=>s+g.events.filter(e=>e.type==='point_start').length,0),passes:converted.games.reduce((s,g)=>s+g.events.filter(e=>e.type==='pass').length,0),output},null,2));
