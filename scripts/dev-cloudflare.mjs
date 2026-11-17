import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2);
const value=(flag,fallback)=>{const index=args.indexOf(flag);return index>=0?args[index+1]:fallback;};
const port=value('--port',process.env.PORT || '4173');
const host=value('--host','127.0.0.1');
// Accept the host/port arguments used by preview tools. A fixed inspector port
// also avoids Wrangler probing unavailable network interfaces in containers.
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),
  'pages','dev','docs','--d1','DB=nhfls-menu','--compatibility-date','2026-11-17','--port',port,'--ip',host,'--inspector-port','9229'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code || 0));
