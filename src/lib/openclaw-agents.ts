import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SESSIONS_DIR = '/Users/andrew/.openclaw/agents/main/sessions';
const SUBAGENT_RUNS_FILE = '/Users/andrew/.openclaw/subagents/runs.json';

const OPENCLAW_BIN_CANDIDATES = [
  process.env.OPENCLAW_BIN,
  '/Users/andrew/.nvm/versions/node/v24.9.0/bin/openclaw',
  '/opt/homebrew/bin/openclaw',
  '/usr/local/bin/openclaw',
  'openclaw',
].filter((value): value is string => Boolean(value));

const RECENT_AGE_MS = 20 * 60 * 1000;
const IDLE_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_AGENT_COLUMNS = 8;
const MAX_MESSAGES_PER_AGENT = 40;
const MAX_LINES_PER_SESSION_PARSE = 250;

export type AgentStatus = 'active' | 'queued' | 'recent' | 'idle' | 'completed' | 'failed' | 'unknown';

export interface AgentThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp?: string;
}

export interface AgentColumnData {
  id: string;
  name: string;
  sessionId?: string;
  sessionKey: string;
  status: AgentStatus;
  model?: string;
  runtime?: string;
  lastActivity?: string;
  messages: AgentThreadMessage[];
  canSend: boolean;
  source: 'session' | 'subagent-run';
}

export interface AgentsSnapshot {
  agents: AgentColumnData[];
  lastUpdated: string;
  limitations: string[];
}

interface SessionRecord {
  key: string;
  updatedAt?: number;
  ageMs?: number;
  sessionId?: string;
  model?: string;
}

interface SubagentRunRecord {
  childSessionKey: string;
  label?: string;
  model?: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  status?: string;
  state?: string;
  phase?: string;
  outcome?: {
    status?: string;
  };
}

interface SessionsCommandOutput {
  sessions?: SessionRecord[];
}

interface RunsJson {
  runs?: Record<string, SubagentRunRecord>;
}

async function runOpenclaw(
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  let lastError: unknown;

  for (const bin of OPENCLAW_BIN_CANDIDATES) {
    try {
      return await execFileAsync(bin, args, {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        env: {
          ...process.env,
          PATH: [
            process.env.PATH,
            '/Users/andrew/.nvm/versions/node/v24.9.0/bin',
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
          ]
            .filter(Boolean)
            .join(':'),
        },
      });
    } catch (error) {
      const execError = error as NodeJS.ErrnoException;
      lastError = error;

      if (execError.code === 'ENOENT') {
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error('Unable to locate openclaw binary');
}

function toIso(ms?: number): string | undefined {
  return typeof ms === 'number' ? new Date(ms).toISOString() : undefined;
}

function formatAgentName(key: string): string {
  if (key.includes(':subagent:')) {
    const subagentId = key.split(':subagent:')[1] ?? key;
    return `Subagent ${subagentId.slice(0, 8)}`;
  }

  if (key.endsWith(':main')) {
    return 'Main Agent';
  }

  const parts = key.split(':');
  return parts[parts.length - 1] ?? key;
}

function runtimeFromSessionKey(key: string): string {
  if (key.includes(':subagent:')) return 'subagent';
  if (key.includes(':cron:')) return 'cron';
  return 'agent';
}

function normalizeRole(rawRole: string | undefined): AgentThreadMessage['role'] {
  if (rawRole === 'user') return 'user';
  if (rawRole === 'assistant') return 'assistant';
  if (rawRole === 'system') return 'system';
  return 'tool';
}

function extractTextParts(content: unknown): string {
  if (!content) return '';

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;

      const maybeType = (item as { type?: string }).type;
      if (maybeType === 'thinking' || maybeType === 'toolCall') continue;

      const maybeText = (item as { text?: unknown }).text;
      if (typeof maybeText === 'string' && maybeText.trim()) {
        parts.push(maybeText);
      }

      const nestedContent = (item as { content?: unknown }).content;
      if (nestedContent) {
        const nestedText = extractTextParts(nestedContent);
        if (nestedText.trim()) parts.push(nestedText);
      }
    }

    return parts.join('\n\n').trim();
  }

  if (typeof content === 'object') {
    const maybeText = (content as { text?: unknown }).text;
    if (typeof maybeText === 'string') return maybeText;
  }

  return '';
}

function parseSessionMessages(sessionId: string): AgentThreadMessage[] {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const recentLines = lines.slice(-MAX_LINES_PER_SESSION_PARSE);
  const messages: AgentThreadMessage[] = [];

  for (const line of recentLines) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const item = parsed as {
      type?: string;
      id?: string;
      message?: {
        role?: string;
        content?: unknown;
        timestamp?: string;
      };
      timestamp?: string;
    };

    if (item.type !== 'message' || !item.message?.role) continue;

    const role = normalizeRole(item.message.role);
    if (role === 'tool') continue;

    const text = extractTextParts(item.message.content).trim();
    if (!text) continue;

    messages.push({
      id: item.id ?? `${sessionId}-${messages.length}`,
      role,
      text: text.slice(0, 6000),
      timestamp: item.message.timestamp ?? item.timestamp,
    });
  }

  return messages.slice(-MAX_MESSAGES_PER_AGENT);
}

async function loadSessions(): Promise<SessionRecord[]> {
  const { stdout } = await runOpenclaw(['sessions', '--active', '360', '--json'], {
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as SessionsCommandOutput;
  return parsed.sessions ?? [];
}

function loadRuns(): SubagentRunRecord[] {
  if (!fs.existsSync(SUBAGENT_RUNS_FILE)) return [];

  const parsed = JSON.parse(fs.readFileSync(SUBAGENT_RUNS_FILE, 'utf-8')) as RunsJson;
  return Object.values(parsed.runs ?? {});
}

function normalizeStatusToken(status: string | undefined): string {
  return (status ?? '').trim().toLowerCase();
}

const RUNNING_STATUS_TOKENS = ['running', 'in_progress', 'in-progress', 'active', 'processing'];
const QUEUED_STATUS_TOKENS = ['queued', 'queue', 'pending', 'created', 'scheduled', 'waiting'];
const COMPLETED_STATUS_TOKENS = ['done', 'completed', 'complete', 'success', 'succeeded', 'ok', 'finished'];
const FAILED_STATUS_TOKENS = ['failed', 'error', 'errored', 'failure', 'timeout', 'timed_out', 'timed-out'];

function runStatusCandidates(run: SubagentRunRecord): string[] {
  return [run.status, run.state, run.phase, run.outcome?.status]
    .map(normalizeStatusToken)
    .filter((value) => Boolean(value));
}

function hasAnyToken(candidates: string[], tokens: string[]): boolean {
  return candidates.some((value) => tokens.includes(value));
}

function runRecencyMs(run: SubagentRunRecord): number {
  return Math.max(run.endedAt ?? 0, run.startedAt ?? 0, run.createdAt ?? 0);
}

function deriveRunStatus(run: SubagentRunRecord): AgentStatus {
  const candidates = runStatusCandidates(run);

  if (run.endedAt) {
    if (hasAnyToken(candidates, FAILED_STATUS_TOKENS)) return 'failed';
    return 'completed';
  }

  if (hasAnyToken(candidates, FAILED_STATUS_TOKENS)) return 'failed';
  if (hasAnyToken(candidates, COMPLETED_STATUS_TOKENS)) return 'completed';
  if (hasAnyToken(candidates, QUEUED_STATUS_TOKENS)) return 'queued';

  if (hasAnyToken(candidates, RUNNING_STATUS_TOKENS)) {
    const ageMs = Date.now() - runRecencyMs(run);
    return ageMs <= RECENT_AGE_MS ? 'active' : 'idle';
  }

  if (run.startedAt) {
    const ageMs = Date.now() - run.startedAt;
    return ageMs <= RECENT_AGE_MS ? 'recent' : 'idle';
  }

  if (run.createdAt) return 'queued';
  return 'unknown';
}

function deriveSessionOnlyStatus(session: SessionRecord): AgentStatus {
  if (typeof session.ageMs !== 'number') return 'unknown';
  if (session.ageMs <= RECENT_AGE_MS) return 'recent';
  if (session.ageMs <= IDLE_AGE_MS) return 'idle';
  return 'completed';
}

function deriveStatus(session: SessionRecord, runBySessionKey: Map<string, SubagentRunRecord>): AgentStatus {
  const sessionStatus = deriveSessionOnlyStatus(session);
  const run = runBySessionKey.get(session.key);
  if (!run) return sessionStatus;

  const runStatus = deriveRunStatus(run);

  if (runStatus === 'active' && sessionStatus !== 'recent') {
    return sessionStatus;
  }

  if (runStatus === 'recent' || runStatus === 'unknown') {
    return sessionStatus;
  }

  return runStatus;
}

export async function getAgentsSnapshot(): Promise<AgentsSnapshot> {
  const limitations: string[] = [];

  let sessions: SessionRecord[] = [];
  try {
    sessions = await loadSessions();
  } catch (error) {
    console.error('Failed to load OpenClaw sessions:', error);
    limitations.push('Could not query `openclaw sessions`; showing fallback data only.');
  }

  let runs: SubagentRunRecord[] = [];
  try {
    runs = loadRuns();
  } catch (error) {
    console.error('Failed to load subagent runs:', error);
    limitations.push('Could not read subagent run metadata from ~/.openclaw/subagents/runs.json.');
  }

  const runBySessionKey = new Map<string, SubagentRunRecord>();
  for (const run of runs) {
    if (!run.childSessionKey) continue;

    const current = runBySessionKey.get(run.childSessionKey);
    if (!current || runRecencyMs(run) >= runRecencyMs(current)) {
      runBySessionKey.set(run.childSessionKey, run);
    }
  }

  const baseSessions = sessions
    .filter((s) => s.key?.startsWith('agent:'))
    .filter((s) => !s.key.includes(':run:'))
    .filter((s) => !s.key.includes(':cron:'))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const columns: AgentColumnData[] = [];

  for (const session of baseSessions.slice(0, MAX_AGENT_COLUMNS)) {
    const status = deriveStatus(session, runBySessionKey);

    columns.push({
      id: session.sessionId ?? session.key,
      name: formatAgentName(session.key),
      sessionId: session.sessionId,
      sessionKey: session.key,
      status,
      model: session.model,
      runtime: runtimeFromSessionKey(session.key),
      lastActivity: toIso(session.updatedAt),
      messages: session.sessionId ? parseSessionMessages(session.sessionId) : [],
      canSend: Boolean(session.sessionId),
      source: 'session',
    });
  }

  for (const run of runs) {
    if (!run.childSessionKey || columns.some((c) => c.sessionKey === run.childSessionKey)) {
      continue;
    }

    columns.push({
      id: run.childSessionKey,
      name: run.label || formatAgentName(run.childSessionKey),
      sessionKey: run.childSessionKey,
      status: deriveRunStatus(run),
      model: run.model,
      runtime: 'subagent',
      lastActivity: toIso(run.endedAt ?? run.startedAt ?? run.createdAt),
      messages: [],
      canSend: false,
      source: 'subagent-run',
    });
  }

  if (!columns.length) {
    limitations.push('No active agent/subagent sessions were found in local OpenClaw artifacts.');
  }

  return {
    agents: columns,
    lastUpdated: new Date().toISOString(),
    limitations,
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export async function sendMessageToAgentSession(sessionId: string, message: string): Promise<{ reply: string }> {
  const trimmedSessionId = sessionId.trim();
  const trimmedMessage = message.trim();

  if (!trimmedSessionId) {
    throw new Error('Missing sessionId');
  }

  if (!trimmedMessage) {
    throw new Error('Message cannot be empty');
  }

  if (trimmedMessage.length > 4000) {
    throw new Error('Message is too long (max 4000 characters)');
  }

  const { stdout } = await runOpenclaw(
    ['agent', '--session-id', trimmedSessionId, '--message', trimmedMessage, '--timeout', '120'],
    {
      timeout: 130_000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );

  return {
    reply: stripAnsi(stdout).trim().slice(0, 8000),
  };
}

export type AgentControlAction = 'nudge' | 'stop' | 'spawnTemplate';
export type AgentControlTemplateId = 'research-brief' | 'bug-triage' | 'build-feature';

export interface RunAgentControlInput {
  action: AgentControlAction;
  sessionId: string;
  templateId?: AgentControlTemplateId;
}

export interface AgentControlResult {
  action: AgentControlAction;
  messageSent: string;
  reply: string;
}

const CONTROL_MESSAGE_BY_ACTION: Record<Exclude<AgentControlAction, 'spawnTemplate'>, string> = {
  nudge: 'Quick status check: what are you working on, any blockers, and your exact next action?',
  stop: 'Stop now and return a short handoff summary with unfinished work and recommended next step.',
};

const SPAWN_TEMPLATE_MESSAGES: Record<AgentControlTemplateId, string> = {
  'research-brief': [
    'Run the research workflow for this request.',
    'Output format: context, key findings, tradeoffs, recommendation, and 3 citations/links.',
    'Keep it decision-ready and concise.',
  ].join(' '),
  'bug-triage': [
    'Run bug triage mode for the current issue.',
    'Output format: reproduction steps, likely root cause, blast radius, fix options, and suggested patch plan.',
    'Prioritize lowest-risk fix first.',
  ].join(' '),
  'build-feature': [
    'Run feature implementation workflow for the requested feature.',
    'Output format: scope, constraints, implementation plan, validation steps, and rollout notes.',
    'Prefer a minimal shippable slice first.',
  ].join(' '),
};

async function assertMainSessionForTemplate(sessionId: string): Promise<void> {
  const sessions = await loadSessions();
  const target = sessions.find((session) => session.sessionId === sessionId);

  if (!target) {
    throw new Error('Session not found for template control');
  }

  if (!target.key.endsWith(':main')) {
    throw new Error('Template controls are only allowed on Main Agent sessions');
  }
}

export async function runAgentControl(input: RunAgentControlInput): Promise<AgentControlResult> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    throw new Error('Missing sessionId');
  }

  let messageSent = '';

  if (input.action === 'spawnTemplate') {
    if (!input.templateId) {
      throw new Error('templateId is required for spawnTemplate');
    }

    const templateMessage = SPAWN_TEMPLATE_MESSAGES[input.templateId];
    if (!templateMessage) {
      throw new Error('Unknown templateId');
    }

    if (templateMessage.length > 2000) {
      throw new Error('Template message exceeds safety length cap');
    }

    await assertMainSessionForTemplate(sessionId);
    messageSent = templateMessage;
  } else {
    messageSent = CONTROL_MESSAGE_BY_ACTION[input.action];
    if (!messageSent) {
      throw new Error('Unsupported control action');
    }
  }

  const result = await sendMessageToAgentSession(sessionId, messageSent);

  return {
    action: input.action,
    messageSent,
    reply: result.reply,
  };
}
