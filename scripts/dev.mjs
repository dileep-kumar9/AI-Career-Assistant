// Starts the API (http://127.0.0.1:8790) and the web app (http://localhost:8081) together.
// Usage: npm run dev:all   — Ctrl+C stops both.
//
// The API runs WITHOUT file watching here: a restart would close the automation
// browser and interrupt a running agent. Developers who edit server code can use
// `npm run dev:api` (watch mode) in a separate terminal instead.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npm run serve:api'],
  ['web', 'npm run dev'],
].map(([name, command]) => {
  // One command string (not cmd + args) so shell mode needs no argument escaping.
  const p = spawn(command, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [p.stdout, p.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.trim() && !/npm notice/.test(l)) console.log(prefix(l));
    });
  }
  p.on('exit', (code) => {
    console.log(prefix(`exited (${code})`));
    stop();
  });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Open http://localhost:8081 when both are ready.');
