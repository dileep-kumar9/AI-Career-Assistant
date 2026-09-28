import type { CareerContext } from './context.js';
import { ProfileService } from './profile.js';
import { ApplicationService } from './applications.js';
import { AgentService } from './agent.js';
import { TrackerService } from './tracker.js';
import { InterviewService } from './interview.js';
import { InterviewSessionService } from './interviewSession.js';
import { SkillsService } from './skills.js';
import { RagService } from './rag.js';
import { AssistantService } from './assistant.js';
import { BrowserManager } from './automation/browser.js';

export interface CareerModules {
  ctx: CareerContext;
  browser: BrowserManager;
  profiles: ProfileService;
  apps: ApplicationService;
  agent: AgentService;
  tracker: TrackerService;
  interviews: InterviewService;
  sessions: InterviewSessionService;
  skills: SkillsService;
  rag: RagService;
  assistant: AssistantService;
}

/** Wires every career module together (one instance per server). */
export function createCareer(ctx: CareerContext, browser = new BrowserManager(ctx.config.automation)): CareerModules {
  const profiles = new ProfileService(ctx);
  const apps = new ApplicationService(ctx, profiles, browser);
  const agent = new AgentService(ctx, apps, profiles, browser);
  const tracker = new TrackerService(ctx, apps, profiles);
  const interviews = new InterviewService(ctx, apps);
  const sessions = new InterviewSessionService(ctx, interviews);
  const skills = new SkillsService(ctx, apps, agent, profiles);
  const rag = new RagService(ctx, { profiles, apps, interviews, sessions, skills, agent });
  const assistant = new AssistantService(ctx, rag, { apps, agent, sessions, skills });
  return { ctx, browser, profiles, apps, agent, tracker, interviews, sessions, skills, rag, assistant };
}
