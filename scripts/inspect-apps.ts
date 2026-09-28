// Debug helper: prints an owner's most recent applications (stage, reason, step log).
// Usage: node --env-file=.env --import tsx scripts/inspect-apps.ts <ownerUid> [count]
import { loadConfig } from '../server/src/config.js';
import { createStore } from '../server/src/db/store.js';
import type { AppDoc } from '../server/src/career/applications.js';

const owner = process.argv[2];
const count = Number(process.argv[3] || 3);
if (!owner) throw new Error('Pass the owner uid.');
const config = loadConfig();
const store = await createStore(config.databaseUrl, config.firebase, config.firestorePrefix);
const docs = await store.docList<AppDoc>('job_applications', owner, 50);
for (const d of docs.slice(0, count)) {
  console.log('='.repeat(80));
  console.log({ id: d.id, origin: d.origin, source: d.source, stage: d.stage, reason: d.reason, title: d.jobTitle, company: d.company, jobUrl: d.jobUrl, applyUrl: d.applyUrl, match: d.matchScore, atsAfter: d.atsAfter, runnerTask: d.runnerTask, waitingFor: d.waitingFor, pending: d.pendingQuestions?.length, updatedAt: d.updatedAt });
  for (const l of (d.log || []).slice(-25)) console.log(`  ${l.at.slice(11, 19)} ${l.level.padEnd(5)} ${l.message}`);
}
await store.close();
