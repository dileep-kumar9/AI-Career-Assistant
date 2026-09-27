/**
 * Live smoke test for the public job sources and link readers (hits the real
 * APIs; not part of `npm test`). Usage: npx tsx scripts/smoke-sources.ts
 */
import { API_SOURCES } from '../server/src/career/jobs/apiSources.js';
import { readJobLink } from '../server/src/career/jobs/readers.js';

const q = { keywords: ['Security Engineer', 'Analyst'], skills: ['Python'], locations: [], remoteOk: true, postedWithinDays: 0 };
const signal = { stopped: () => false };
const cfg: Record<string, unknown> = { greenhouse: { boards: ['stripe'] }, lever: { companies: ['palantir'] }, ashby: { orgs: ['ramp'] }, workday: { sites: ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'] } };

for (const [id, src] of Object.entries(API_SOURCES)) {
  const t = Date.now();
  try {
    const jobs = await src.search(id === 'linkedin' ? { ...q, keywords: ['SOC Analyst'], locations: ['India'] } : q, cfg[id] ?? {}, signal);
    const j = jobs[0];
    console.log(`${id.padEnd(10)} ${String(jobs.length).padStart(4)} jobs ${Date.now() - t}ms  e.g. ${j ? `${j.title} | ${j.company} | ${j.location} | desc ${j.description.length} | ${j.applyUrl}` : '-'}`);
  } catch (e) {
    console.log(`${id.padEnd(10)} ERROR ${(e as Error).message}`);
  }
}

for (const url of process.argv.slice(2)) {
  try {
    const p = await readJobLink(url);
    console.log(`READ ${p.source}: ${p.title} | ${p.company} | ${p.location} | desc ${p.description.length} | apply ${p.applyUrl}${p.easyApply !== undefined ? ` | easyApply ${p.easyApply}` : ''}`);
  } catch (e) {
    console.log(`READ FAIL ${url}: ${(e as Error).message}`);
  }
}
