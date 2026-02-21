import type { Task } from '@/lib/vault-parser';

export interface NextActionTaskInput {
  id: string;
  text: string;
  source?: string;
  sourcePath?: string;
  linkedProject?: string;
  instructions?: string[];
  needsAndrew?: boolean;
  priority?: Task['priority'];
}

export interface NextActionPlan {
  hasAutonomousSteps: boolean;
  autonomousSteps: string[];
  needsYouSteps: string[];
  userMessage: string;
  orchestrationMessage: string;
}

const MANUAL_REQUIRED_PATTERNS: RegExp[] = [
  /\b(andrew|you)\b/i,
  /\b(admin|administrator|sudo|password|passcode|2fa|otp)\b/i,
  /\b(sign in|log in|login|sign up|signup|authorize|approval|approve)\b/i,
  /\b(call|text|email|reply|book|attend|meeting|meetup)\b/i,
  /\b(system settings|filevault|firewall|stealth mode)\b/i,
  /\b(auth_token|ct0|cookie)\b/i,
  /\(admin\)/i,
  /\bneeds\s+you\b/i,
  /\bsend to jarvis\b/i,
];

const DECISION_PATTERNS: RegExp[] = [
  /\b(decide|decision|choose|pick)\b/i,
  /\b(update now|defer)\b/i,
];

const AUTONOMOUS_HINT_PATTERNS: RegExp[] = [
  /\bopenclaw\b/i,
  /\b(run|rerun|review|draft|prepare|research|summarize|document|triage|verify|check|implement)\b/i,
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanStep(value: string): string {
  return normalizeText(value)
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/[.;]+$/, '')
    .replace(/\s+(?:or|and)$/i, '')
    .trim();
}

function toPlainEnglishStep(value: string): string {
  return cleanStep(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\)\s+[A-Z][A-Za-z0-9\- ]+$/, '')
    .replace(/openclaw\s+security\s+audit\s+--deep/gi, 'run the OpenClaw deep security audit')
    .replace(/openclaw\s+--version/gi, 'check the current OpenClaw version')
    .replace(/openclaw\s+update\s+(?:status|check)/gi, 'check whether an OpenClaw update is available')
    .replace(/auth_token/gi, 'auth token')
    .replace(/\bct0\b/gi, 'ct0 token')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLinkedProjectSuffix(text: string, linkedProject?: string): string {
  if (!linkedProject) return text;

  const escapedProject = linkedProject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutProject = text.replace(new RegExp(`\\s*${escapedProject}\\s*$`, 'i'), '').trim();

  return withoutProject || text;
}

function needsYouPriority(step: string): number {
  if (/\b(firewall|filevault|admin|password|login|system settings|auth token|cookie|ct0)\b/i.test(step)) {
    return 0;
  }

  if (/\b(decide|decision|choose|update now|defer)\b/i.test(step)) {
    return 2;
  }

  return 1;
}

function dedupeSteps(steps: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawStep of steps) {
    const step = cleanStep(rawStep);
    if (!step) continue;

    const key = step.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(step);
  }

  return deduped;
}

function stepNeedsAndrew(step: string): boolean {
  if (MANUAL_REQUIRED_PATTERNS.some((pattern) => pattern.test(step))) {
    return true;
  }

  if (DECISION_PATTERNS.some((pattern) => pattern.test(step))) {
    return true;
  }

  if (AUTONOMOUS_HINT_PATTERNS.some((pattern) => pattern.test(step))) {
    return false;
  }

  return false;
}

function classifySteps(task: NextActionTaskInput): { autonomousSteps: string[]; needsYouSteps: string[] } {
  const sourceSteps = dedupeSteps(
    task.instructions && task.instructions.length > 0 ? task.instructions : [task.text]
  );

  const autonomousSteps: string[] = [];
  const needsYouSteps: string[] = [];

  for (const step of sourceSteps) {
    if (stepNeedsAndrew(step)) {
      needsYouSteps.push(step);
    } else {
      autonomousSteps.push(step);
    }
  }

  if (autonomousSteps.length === 0 && needsYouSteps.length === 0) {
    needsYouSteps.push(cleanStep(task.text));
  }

  return {
    autonomousSteps,
    needsYouSteps,
  };
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function buildNextStepText(needsYouSteps: string[], hasAutonomousSteps: boolean): string {
  if (needsYouSteps.length > 0) {
    const prioritized = [...needsYouSteps].sort((a, b) => needsYouPriority(a) - needsYouPriority(b));
    return numberedList(prioritized.slice(0, 3));
  }

  if (hasAutonomousSteps) {
    return 'No action needed right now. I will message you when I need a decision or quick confirmation.';
  }

  return 'Please reply with one specific step you want me to execute first so I can move this forward immediately.';
}

function buildUserMessage(task: NextActionTaskInput, autonomousSteps: string[], needsYouSteps: string[]): string {
  const hasAutonomousSteps = autonomousSteps.length > 0;
  const plainAutonomousSteps = autonomousSteps.map(toPlainEnglishStep);
  const plainNeedsYouSteps = needsYouSteps.map(toPlainEnglishStep);

  const whatDoingSection = hasAutonomousSteps
    ? numberedList(plainAutonomousSteps.slice(0, 4))
    : '1. I reviewed this task and mapped what is blocked waiting on you.';

  const intro = hasAutonomousSteps
    ? 'I’m taking this on now.'
    : 'I can’t start this one without your input yet, but I already mapped the next move.';

  const readableTaskText = toPlainEnglishStep(stripLinkedProjectSuffix(task.text, task.linkedProject));

  const taskContext = task.linkedProject
    ? `Task: ${readableTaskText} (${task.linkedProject.replace(' - Project Board', '')})`
    : `Task: ${readableTaskText}`;

  return [
    intro,
    taskContext,
    '',
    'What I’m doing:',
    whatDoingSection,
    '',
    'Your next step:',
    buildNextStepText(plainNeedsYouSteps, hasAutonomousSteps),
  ].join('\n');
}

function truncateLine(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function buildOrchestrationMessage(task: NextActionTaskInput, plan: NextActionPlan): string {
  const compactAutonomousSteps = plan.autonomousSteps.map((step) => truncateLine(step, 160)).slice(0, 4);
  const compactNeedsYouSteps = plan.needsYouSteps.map((step) => truncateLine(step, 160)).slice(0, 3);

  const autonomousSection =
    compactAutonomousSteps.length > 0
      ? numberedList(compactAutonomousSteps)
      : 'None. This task is currently blocked on Andrew input.';

  const needsYouSection =
    compactNeedsYouSteps.length > 0
      ? numberedList(compactNeedsYouSteps)
      : 'No immediate Andrew dependency identified.';

  const sourceLine = task.source ? `Source: ${truncateLine(task.source, 120)}` : 'Source: Mission Control';
  const projectLine = task.linkedProject
    ? `Linked project: ${truncateLine(task.linkedProject, 120)}`
    : 'Linked project: (none)';

  return [
    'Mission Control: "Take Action" was clicked.',
    `Task ID: ${truncateLine(task.id, 120)}`,
    `Task: ${truncateLine(task.text, 220)}`,
    sourceLine,
    projectLine,
    '',
    'Execute these now (in order):',
    autonomousSection,
    '',
    'Andrew dependencies to flag:',
    needsYouSection,
    '',
    'After beginning execution, send Andrew a concise status update with:',
    '- what started',
    '- what still needs Andrew',
    '- exact next step for Andrew',
  ].join('\n');
}

export function planNextActionTake(task: NextActionTaskInput): NextActionPlan {
  const normalizedTask: NextActionTaskInput = {
    ...task,
    id: normalizeText(task.id),
    text: normalizeText(task.text),
    source: task.source ? normalizeText(task.source) : undefined,
    sourcePath: task.sourcePath ? normalizeText(task.sourcePath) : undefined,
    linkedProject: task.linkedProject ? normalizeText(task.linkedProject) : undefined,
    instructions: Array.isArray(task.instructions)
      ? task.instructions.map((step) => normalizeText(step)).filter(Boolean)
      : undefined,
  };

  const { autonomousSteps, needsYouSteps } = classifySteps(normalizedTask);

  const plan: NextActionPlan = {
    hasAutonomousSteps: autonomousSteps.length > 0,
    autonomousSteps,
    needsYouSteps,
    userMessage: buildUserMessage(normalizedTask, autonomousSteps, needsYouSteps),
    orchestrationMessage: '',
  };

  plan.orchestrationMessage = buildOrchestrationMessage(normalizedTask, plan);

  return plan;
}
