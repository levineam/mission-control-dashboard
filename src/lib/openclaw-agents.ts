import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SESSIONS_DIR =
  process.env.MISSION_CONTROL_SESSIONS_DIR ?? '/Users/andrew/.openclaw/agents/main/sessions';
const SESSIONS_INDEX_FILE =
  process.env.MISSION_CONTROL_SESSIONS_INDEX_FILE ??
  '/Users/andrew/.openclaw/agents/main/sessions/sessions.json';
const SUBAGENT_RUNS_FILE =
  process.env.MISSION_CONTROL_SUBAGENT_RUNS_FILE ?? '/Users/andrew/.openclaw/subagents/runs.json';
const MISSION_CONTROL_STATE_DIR =
  process.env.MISSION_CONTROL_STATE_DIR ?? '/tmp/mission-control-dashboard';
const MIRROR_STATE_FILE = path.join(MISSION_CONTROL_STATE_DIR, 'mirror-state.json');
const WATCHDOG_STATE_FILE = path.join(MISSION_CONTROL_STATE_DIR, 'watchdog-state.json');

const OPENCLAW_BIN_CANDIDATES = [
  process.env.OPENCLAW_BIN,
  '/Users/andrew/.nvm/versions/node/v24.9.0/bin/openclaw',
  '/opt/homebrew/bin/openclaw',
  '/usr/local/bin/openclaw',
  'openclaw',
].filter((value): value is string => Boolean(value));

function envDurationMs(name: string, fallbackMs: number): number {
  const parsed = Number(process.env[name]);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallbackMs;
}

const RECENT_AGE_MS = 20 * 60 * 1000;
const IDLE_AGE_MS = 2 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MINUTES = 360;
const MAX_AGENT_COLUMNS = 8;
const MAX_MESSAGES_PER_AGENT = 40;
const MAX_LINES_PER_SESSION_SCAN = 4000;
const MAX_LINES_FOR_MODEL_SCAN = 120;
const MAX_TASK_SUMMARY_LENGTH = 88;
const MIRROR_COOLDOWN_MS = envDurationMs('MISSION_CONTROL_MIRROR_COOLDOWN_MS', 90 * 1000);
const MIRROR_DEDUPE_WINDOW_MS = envDurationMs('MISSION_CONTROL_MIRROR_DEDUPE_WINDOW_MS', 10 * 60 * 1000);
const MIRROR_SOURCE_LABEL = 'Mission Control mirror';
const WATCHDOG_STALLED_THRESHOLD_MS = envDurationMs('MISSION_CONTROL_STALLED_THRESHOLD_MS', 20 * 60 * 1000);
const WATCHDOG_SCAN_COOLDOWN_MS = envDurationMs('MISSION_CONTROL_WATCHDOG_SCAN_COOLDOWN_MS', 60 * 1000);
const WATCHDOG_RETRY_COOLDOWN_MS = envDurationMs('MISSION_CONTROL_WATCHDOG_RETRY_COOLDOWN_MS', 30 * 60 * 1000);
const RETRY_LABEL_MAX_LENGTH = 64;
const GATEWAY_CALL_TIMEOUT_MS = 60_000;

export type AgentStatus = 'active' | 'queued' | 'recent' | 'idle' | 'completed' | 'failed' | 'unknown';

export interface AgentThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp?: string | number;
}

export interface AgentColumnData {
  id: string;
  name: string;
  sessionShortId: string;
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
  sessionFile?: string;
  model?: string;
}

interface SubagentRunRecord {
  childSessionKey: string;
  runId?: string;
  requesterSessionKey?: string;
  requesterOrigin?: {
    channel?: string;
    to?: string;
    accountId?: string;
  };
  label?: string;
  task?: string;
  model?: string;
  runTimeoutSeconds?: number;
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

interface MirrorStateEntry {
  lastMirroredAt?: number;
  lastFingerprint?: string;
  lastFingerprintAt?: number;
}

interface MirrorState {
  bySession: Record<string, MirrorStateEntry>;
}

interface MirrorReplyResult {
  attempted: boolean;
  mirrored: boolean;
  skippedReason?: string;
  summaryMessage?: string;
  mainSessionId?: string;
  mainReply?: string;
}

interface RetryRequeueResult {
  dryRun: boolean;
  sessionKey: string;
  previousRunId?: string;
  summaryMessage: string;
  reply: string;
  requested: boolean;
  newRunId?: string;
  newSessionKey?: string;
  currentState?: string;
  requeuePayload?: Record<string, unknown>;
  rawResponse?: unknown;
}

interface WatchdogRunStateEntry {
  attempts: number;
  lastAttemptAt?: number;
  lastRunStatus?: string;
}

interface WatchdogState {
  lastScanAt?: number;
  runs: Record<string, WatchdogRunStateEntry>;
}

export interface WatchdogRetryItem {
  runId?: string;
  sessionKey: string;
  stalledForMs: number;
  dryRun: boolean;
  requested: boolean;
  skippedReason?: string;
  summaryMessage?: string;
  newRunId?: string;
  newSessionKey?: string;
  currentState?: string;
}

export interface WatchdogRunResult {
  checkedAt: string;
  thresholdMs: number;
  scannedRuns: number;
  stalledRuns: number;
  retries: WatchdogRetryItem[];
  skippedScan?: boolean;
  skippedReason?: string;
}

interface SessionsIndexEntry {
  key?: string;
  sessionId?: string;
  updatedAt?: number | string;
  ageMs?: number | string;
  sessionFile?: string;
  model?: string;
}

type SessionsIndexShape =
  | Record<string, SessionsIndexEntry>
  | {
      sessions?: SessionsIndexEntry[];
      items?: SessionsIndexEntry[];
    };

interface ExecFileError extends NodeJS.ErrnoException {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

function openclawEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
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
  };
}

function toStringOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return '';
}

function extractMissingEnvVars(text: string): string[] {
  const matches = text.matchAll(/Missing env var "([A-Za-z_][A-Za-z0-9_]*)"/g);
  const names: string[] = [];

  for (const match of matches) {
    const varName = match[1];
    if (varName && !names.includes(varName)) {
      names.push(varName);
    }
  }

  return names;
}

function missingEnvVarsFromError(error: unknown): string[] {
  const execError = error as ExecFileError;

  const combined = [
    toStringOutput(execError.stderr),
    toStringOutput(execError.stdout),
    typeof execError.message === 'string' ? execError.message : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (!combined.includes('MissingEnvVarError') && !combined.includes('Missing env var "')) {
    return [];
  }

  return extractMissingEnvVars(combined);
}

function placeholderEnvValue(name: string): string {
  const existing = process.env[name];
  if (typeof existing === 'string' && existing.trim()) {
    return existing;
  }

  return `openclaw-placeholder-${name.toLowerCase()}`;
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
        env: openclawEnv(),
      });
    } catch (error) {
      const execError = error as ExecFileError;
      lastError = error;

      if (execError.code === 'ENOENT') {
        continue;
      }

      const missingVars = missingEnvVarsFromError(execError);
      if (missingVars.length > 0) {
        const retryEnvOverrides = Object.fromEntries(
          missingVars.map((name) => [name, placeholderEnvValue(name)])
        );

        try {
          return await execFileAsync(bin, args, {
            timeout: options.timeout,
            maxBuffer: options.maxBuffer,
            env: openclawEnv(retryEnvOverrides),
          });
        } catch (retryError) {
          lastError = retryError;
          throw retryError;
        }
      }

      throw error;
    }
  }

  throw lastError ?? new Error('Unable to locate openclaw binary');
}

function parseJsonFromCommandOutput(stdout: string): unknown {
  const stripped = stripAnsi(stdout).trim();
  if (!stripped) {
    throw new Error('Expected JSON output but command returned empty stdout');
  }

  const candidates = [stripped];
  const firstObject = stripped.indexOf('{');
  const lastObject = stripped.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    if (firstObject > 0) candidates.push(stripped.slice(firstObject));
    candidates.push(stripped.slice(firstObject, lastObject + 1));
  }

  const firstArray = stripped.indexOf('[');
  const lastArray = stripped.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    if (firstArray > 0) candidates.push(stripped.slice(firstArray));
    candidates.push(stripped.slice(firstArray, lastArray + 1));
  }

  for (const candidate of Array.from(new Set(candidates))) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new Error('Unable to parse JSON from command output');
}

async function runGatewayCall(method: string, params: Record<string, unknown>, timeoutMs = GATEWAY_CALL_TIMEOUT_MS): Promise<unknown> {
  const { stdout } = await runOpenclaw(
    ['gateway', 'call', method, '--params', JSON.stringify(params), '--json', '--timeout', String(timeoutMs)],
    {
      timeout: Math.max(timeoutMs + 5_000, GATEWAY_CALL_TIMEOUT_MS),
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  return parseJsonFromCommandOutput(stdout);
}

function toIso(ms?: number): string | undefined {
  return typeof ms === 'number' ? new Date(ms).toISOString() : undefined;
}

function toTimestampMs(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function ensureStateDir(): void {
  if (!fs.existsSync(MISSION_CONTROL_STATE_DIR)) {
    fs.mkdirSync(MISSION_CONTROL_STATE_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  try {
    ensureStateDir();
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch (error) {
    console.warn(`Failed to persist Mission Control state file: ${filePath}`, error);
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function deriveLastActivityMs(sessionUpdatedAt: number | undefined, messages: AgentThreadMessage[]): number | undefined {
  const latestMessageTimestamp = toTimestampMs(messages[messages.length - 1]?.timestamp);

  if (typeof latestMessageTimestamp === 'number' && typeof sessionUpdatedAt === 'number') {
    return Math.max(sessionUpdatedAt, latestMessageTimestamp);
  }

  if (typeof latestMessageTimestamp === 'number') return latestMessageTimestamp;
  return sessionUpdatedAt;
}

function fallbackAgentNameFromKey(key: string): string {
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

function shortIdFromSessionKey(key: string): string {
  if (key.includes(':subagent:')) {
    const subagentId = key.split(':subagent:')[1] ?? key;
    return subagentId.slice(0, 8);
  }

  if (key.endsWith(':main')) {
    return 'main';
  }

  const parts = key.split(':').filter((part) => Boolean(part));
  const tail = parts[parts.length - 1] ?? key;
  return tail.slice(0, 8);
}

function toTitleCase(value: string): string {
  return value
    .split(' ')
    .filter((part) => Boolean(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeRunLabel(label?: string): string | undefined {
  if (!label || !label.trim()) return undefined;

  const trimmed = label.trim();
  if (trimmed.includes('-') || trimmed.includes('_')) {
    const spaced = trimmed.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spaced) return undefined;
    return toTitleCase(spaced);
  }

  return trimmed;
}

function summarizeTask(task?: string): string | undefined {
  if (!task || !task.trim()) return undefined;

  const firstLine = task
    .split('\n')
    .map((line) => line.trim())
    .find((line) => Boolean(line));

  if (!firstLine) return undefined;

  const plainText = firstLine
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/[`*_~#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plainText) return undefined;
  if (plainText.length <= MAX_TASK_SUMMARY_LENGTH) return plainText;

  return `${plainText.slice(0, MAX_TASK_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

function resolveAgentName(sessionKey: string, run?: SubagentRunRecord): string {
  const normalizedLabel = normalizeRunLabel(run?.label);
  if (normalizedLabel) return normalizedLabel;

  const taskSummary = summarizeTask(run?.task);
  if (taskSummary) return taskSummary;

  return fallbackAgentNameFromKey(sessionKey);
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

const sessionModelCache = new Map<string, string | undefined>();

function resolveSessionFilePath(sessionId?: string, sessionFile?: string): string | undefined {
  if (sessionFile) {
    return path.isAbsolute(sessionFile) ? sessionFile : path.join(SESSIONS_DIR, sessionFile);
  }

  if (!sessionId) return undefined;
  return path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

function parseSessionMessages(sessionId?: string, sessionFile?: string): AgentThreadMessage[] {
  const filePath = resolveSessionFilePath(sessionId, sessionFile);
  if (!filePath || !fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const messages: AgentThreadMessage[] = [];
  const fallbackIdBase = sessionId ?? path.basename(filePath, '.jsonl');

  let scanned = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (scanned >= MAX_LINES_PER_SESSION_SCAN || messages.length >= MAX_MESSAGES_PER_AGENT) {
      break;
    }

    const line = lines[index];
    if (!line) continue;

    scanned += 1;

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
        timestamp?: string | number;
      };
      timestamp?: string | number;
    };

    if (item.type !== 'message' || !item.message?.role) continue;

    const role = normalizeRole(item.message.role);
    if (role === 'tool') continue;

    const text = extractTextParts(item.message.content).trim();
    if (!text) continue;

    messages.push({
      id: item.id ?? `${fallbackIdBase}-${index}`,
      role,
      text: text.slice(0, 6000),
      timestamp: item.message.timestamp ?? item.timestamp,
    });
  }

  return messages.reverse();
}

function parseSessionModel(sessionId?: string, sessionFile?: string): string | undefined {
  const filePath = resolveSessionFilePath(sessionId, sessionFile);
  if (!filePath) return undefined;

  const cached = sessionModelCache.get(filePath);
  if (cached !== undefined || sessionModelCache.has(filePath)) {
    return cached;
  }

  if (!fs.existsSync(filePath)) {
    sessionModelCache.set(filePath, undefined);
    return undefined;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length && index < MAX_LINES_FOR_MODEL_SCAN; index += 1) {
    const line = lines[index];
    if (!line) continue;

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const item = parsed as {
      type?: string;
      provider?: string;
      modelId?: string;
      customType?: string;
      data?: {
        provider?: string;
        model?: string;
        modelId?: string;
      };
    };

    if (item.type === 'model_change' && item.modelId) {
      const provider = item.provider?.trim();
      const model = item.modelId.trim();
      const value = provider ? `${provider}/${model}` : model;
      sessionModelCache.set(filePath, value);
      return value;
    }

    if (item.type === 'custom' && item.customType === 'model-snapshot') {
      const snapshotModel = item.data?.modelId ?? item.data?.model;
      if (snapshotModel) {
        const provider = item.data?.provider?.trim();
        const model = snapshotModel.trim();
        const value = provider ? `${provider}/${model}` : model;
        sessionModelCache.set(filePath, value);
        return value;
      }
    }
  }

  sessionModelCache.set(filePath, undefined);
  return undefined;
}

function mapSessions(records: SessionRecord[]): SessionRecord[] {
  return records
    .filter((record) => Boolean(record.key))
    .map((record) => {
      const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : undefined;
      const ageMs =
        typeof record.ageMs === 'number'
          ? record.ageMs
          : typeof updatedAt === 'number'
            ? Date.now() - updatedAt
            : undefined;

      return {
        key: record.key,
        updatedAt,
        ageMs,
        sessionId: record.sessionId,
        sessionFile: record.sessionFile,
        model: record.model,
      };
    });
}

function parseSessionsCommandOutput(stdout: string): SessionRecord[] {
  const stripped = stripAnsi(stdout).trim();
  if (!stripped) {
    throw new Error('openclaw sessions returned empty output');
  }

  const parseCandidate = (value: string): unknown => JSON.parse(value);
  const candidates: string[] = [stripped];

  const firstObject = stripped.indexOf('{');
  const lastObject = stripped.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    if (firstObject > 0) candidates.push(stripped.slice(firstObject));
    candidates.push(stripped.slice(firstObject, lastObject + 1));
  }

  const firstArray = stripped.indexOf('[');
  const lastArray = stripped.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    if (firstArray > 0) candidates.push(stripped.slice(firstArray));
    candidates.push(stripped.slice(firstArray, lastArray + 1));
  }

  const uniqueCandidates = Array.from(new Set(candidates));

  for (const candidate of uniqueCandidates) {
    try {
      const parsed = parseCandidate(candidate) as SessionsCommandOutput | SessionRecord[];

      if (Array.isArray(parsed)) {
        return mapSessions(parsed);
      }

      if (Array.isArray(parsed.sessions)) {
        return mapSessions(parsed.sessions);
      }
    } catch {
      continue;
    }
  }

  throw new Error('Unable to parse JSON from openclaw sessions output');
}

async function loadSessions(): Promise<SessionRecord[]> {
  const { stdout } = await runOpenclaw(
    ['sessions', '--active', String(ACTIVE_WINDOW_MINUTES), '--json'],
    {
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  return parseSessionsCommandOutput(stdout);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function parseSessionsIndexRecords(parsed: SessionsIndexShape): SessionRecord[] {
  const records: SessionRecord[] = [];

  if (Array.isArray((parsed as { sessions?: unknown }).sessions)) {
    const sessions = (parsed as { sessions: SessionsIndexEntry[] }).sessions;
    records.push(
      ...sessions
        .map((entry) => {
          const key = typeof entry.key === 'string' ? entry.key : '';
          const updatedAt = toFiniteNumber(entry.updatedAt);
          const ageMs = toFiniteNumber(entry.ageMs);

          return {
            key,
            updatedAt,
            ageMs,
            sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
            sessionFile: typeof entry.sessionFile === 'string' ? entry.sessionFile : undefined,
            model: typeof entry.model === 'string' ? entry.model : undefined,
          } satisfies SessionRecord;
        })
        .filter((record) => Boolean(record.key))
    );

    return records;
  }

  if (Array.isArray((parsed as { items?: unknown }).items)) {
    const items = (parsed as { items: SessionsIndexEntry[] }).items;
    records.push(
      ...items
        .map((entry) => {
          const key = typeof entry.key === 'string' ? entry.key : '';
          const updatedAt = toFiniteNumber(entry.updatedAt);
          const ageMs = toFiniteNumber(entry.ageMs);

          return {
            key,
            updatedAt,
            ageMs,
            sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
            sessionFile: typeof entry.sessionFile === 'string' ? entry.sessionFile : undefined,
            model: typeof entry.model === 'string' ? entry.model : undefined,
          } satisfies SessionRecord;
        })
        .filter((record) => Boolean(record.key))
    );

    return records;
  }

  for (const [key, value] of Object.entries(parsed as Record<string, SessionsIndexEntry>)) {
    const updatedAt = toFiniteNumber(value?.updatedAt);
    const ageMs = toFiniteNumber(value?.ageMs);

    records.push({
      key,
      updatedAt,
      ageMs,
      sessionId: typeof value?.sessionId === 'string' ? value.sessionId : undefined,
      sessionFile: typeof value?.sessionFile === 'string' ? value.sessionFile : undefined,
      model: typeof value?.model === 'string' ? value.model : undefined,
    });
  }

  return records;
}

function loadSessionsFromIndex(activeMinutes = ACTIVE_WINDOW_MINUTES): SessionRecord[] {
  if (!fs.existsSync(SESSIONS_INDEX_FILE)) return [];

  const parsed = JSON.parse(fs.readFileSync(SESSIONS_INDEX_FILE, 'utf-8')) as SessionsIndexShape;
  const now = Date.now();
  const activeWindowMs = activeMinutes * 60 * 1000;

  return parseSessionsIndexRecords(parsed)
    .map((record) => {
      const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : undefined;
      const computedAgeMs =
        typeof record.ageMs === 'number'
          ? record.ageMs
          : typeof updatedAt === 'number'
            ? now - updatedAt
            : undefined;

      return {
        ...record,
        updatedAt,
        ageMs: computedAgeMs,
      } satisfies SessionRecord;
    })
    .filter((record) => record.key.startsWith('agent:'))
    .filter((record) => typeof record.ageMs !== 'number' || record.ageMs <= activeWindowMs)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function loadRuns(): SubagentRunRecord[] {
  if (!fs.existsSync(SUBAGENT_RUNS_FILE)) return [];

  const parsed = JSON.parse(fs.readFileSync(SUBAGENT_RUNS_FILE, 'utf-8')) as RunsJson;

  return Object.entries(parsed.runs ?? {}).map(([runId, run]) => ({
    ...run,
    runId: run.runId ?? runId,
  }));
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

function isFailedRun(run: SubagentRunRecord): boolean {
  return deriveRunStatus(run) === 'failed';
}

function isRunningRun(run: SubagentRunRecord): boolean {
  if (run.endedAt) return false;

  const candidates = runStatusCandidates(run);
  if (hasAnyToken(candidates, FAILED_STATUS_TOKENS)) return false;
  if (hasAnyToken(candidates, COMPLETED_STATUS_TOKENS)) return false;
  if (hasAnyToken(candidates, QUEUED_STATUS_TOKENS)) return false;

  if (hasAnyToken(candidates, RUNNING_STATUS_TOKENS)) return true;
  return Boolean(run.startedAt);
}

function runStableId(run: SubagentRunRecord): string {
  if (run.runId?.trim()) return run.runId.trim();
  return `${run.childSessionKey}:${run.startedAt ?? run.createdAt ?? 0}`;
}

function runStalledForMs(run: SubagentRunRecord, nowMs: number): number {
  const lastHeartbeatMs = Math.max(run.startedAt ?? 0, run.createdAt ?? 0, 0);
  if (!lastHeartbeatMs) return 0;
  return Math.max(nowMs - lastHeartbeatMs, 0);
}

function deriveMirrorSessionLabel(session: SessionRecord | undefined): string {
  if (!session?.key) return 'subagent';
  return shortIdFromSessionKey(session.key);
}

function deriveSessionKeyFromSessionId(sessions: SessionRecord[], sessionId: string): string | undefined {
  const target = sessions.find((session) => session.sessionId === sessionId);
  return target?.key;
}

function deriveSessionRecordFromSessionId(
  sessions: SessionRecord[],
  sessionId: string
): SessionRecord | undefined {
  return sessions.find((session) => session.sessionId === sessionId);
}

function deriveSessionKeyFromInput(input: { sessionId?: string; sessionKey?: string }, sessions: SessionRecord[]): string | undefined {
  if (input.sessionKey?.trim()) return input.sessionKey.trim();
  if (input.sessionId?.trim()) return deriveSessionKeyFromSessionId(sessions, input.sessionId.trim());
  return undefined;
}

function deriveSessionIdFromInput(input: { sessionId?: string; sessionKey?: string }, sessions: SessionRecord[]): string | undefined {
  if (input.sessionId?.trim()) return input.sessionId.trim();
  if (!input.sessionKey?.trim()) return undefined;

  return sessions.find((session) => session.key === input.sessionKey?.trim())?.sessionId;
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
    console.warn('Failed to load OpenClaw sessions from CLI. Falling back to sessions index.', error);

    try {
      sessions = loadSessionsFromIndex();
    } catch (fallbackError) {
      console.error('Failed to load OpenClaw sessions fallback index:', fallbackError);
      limitations.push('Could not load active OpenClaw sessions metadata.');
    }
  }

  let runs: SubagentRunRecord[] = [];
  try {
    runs = loadRuns();
  } catch (error) {
    console.error('Failed to load subagent runs:', error);
    limitations.push('Could not read subagent run metadata from ~/.openclaw/subagents/runs.json.');
  }

  const watchdog = await maybeRunStalledRunWatchdog({ sessions, runs });
  const watchdogRetryCount = watchdog.retries.filter((item) => item.requested).length;

  if (watchdogRetryCount > 0) {
    limitations.push(
      `Watchdog retried ${watchdogRetryCount} stalled run${watchdogRetryCount === 1 ? '' : 's'} and posted an update to Main Agent.`
    );
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
  const primarySessions = baseSessions.slice(0, MAX_AGENT_COLUMNS);
  const mainSession = baseSessions.find((session) => session.key === 'agent:main:main');

  if (mainSession && !primarySessions.some((session) => session.key === mainSession.key)) {
    primarySessions.unshift(mainSession);
  }

  for (const session of primarySessions) {
    const status = deriveStatus(session, runBySessionKey);
    const run = runBySessionKey.get(session.key);
    const messages = parseSessionMessages(session.sessionId, session.sessionFile);
    const model = session.model ?? parseSessionModel(session.sessionId, session.sessionFile);
    const lastActivityMs = deriveLastActivityMs(session.updatedAt, messages);

    columns.push({
      id: session.sessionId ?? session.key,
      name: resolveAgentName(session.key, run),
      sessionShortId: shortIdFromSessionKey(session.key),
      sessionId: session.sessionId,
      sessionKey: session.key,
      status,
      model,
      runtime: runtimeFromSessionKey(session.key),
      lastActivity: toIso(lastActivityMs),
      messages,
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
      name: resolveAgentName(run.childSessionKey, run),
      sessionShortId: shortIdFromSessionKey(run.childSessionKey),
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

function loadMirrorState(): MirrorState {
  const parsed = readJsonFile<MirrorState>(MIRROR_STATE_FILE, { bySession: {} });

  if (!parsed || typeof parsed !== 'object' || typeof parsed.bySession !== 'object' || !parsed.bySession) {
    return { bySession: {} };
  }

  return parsed;
}

function saveMirrorState(state: MirrorState): void {
  writeJsonFile(MIRROR_STATE_FILE, state);
}

function loadWatchdogState(): WatchdogState {
  const parsed = readJsonFile<WatchdogState>(WATCHDOG_STATE_FILE, { runs: {} });

  if (!parsed || typeof parsed !== 'object') {
    return { runs: {} };
  }

  const runs = typeof parsed.runs === 'object' && parsed.runs ? parsed.runs : {};

  return {
    lastScanAt: typeof parsed.lastScanAt === 'number' ? parsed.lastScanAt : undefined,
    runs,
  };
}

function saveWatchdogState(state: WatchdogState): void {
  writeJsonFile(WATCHDOG_STATE_FILE, state);
}

function buildMirrorSummaryMessage(input: {
  sessionLabel: string;
  actionLabel: string;
  sentMessage: string;
  reply: string;
}): string {
  const outgoing = truncateText(normalizeWhitespace(input.sentMessage), 180);
  const incoming = truncateText(normalizeWhitespace(input.reply), 260);

  return [
    `${MIRROR_SOURCE_LABEL}: ${input.sessionLabel} replied (${input.actionLabel}).`,
    `Reply summary: ${incoming || '[empty reply]'}`,
    `Sent message: ${outgoing || '[empty message]'}`,
  ].join('\n');
}

async function maybeMirrorSubagentReply(input: {
  targetSession?: SessionRecord;
  sessionId: string;
  actionLabel: string;
  sentMessage: string;
  reply: string;
}): Promise<MirrorReplyResult> {
  if (!input.targetSession?.key?.includes(':subagent:')) {
    return {
      attempted: false,
      mirrored: false,
      skippedReason: 'target-session-is-not-a-subagent',
    };
  }

  const mirrorSummary = buildMirrorSummaryMessage({
    sessionLabel: deriveMirrorSessionLabel(input.targetSession),
    actionLabel: input.actionLabel,
    sentMessage: input.sentMessage,
    reply: input.reply,
  });

  const mirrorState = loadMirrorState();
  const sessionKey = input.sessionId.trim();
  const stateEntry = mirrorState.bySession[sessionKey] ?? {};
  const now = Date.now();
  const fingerprint = normalizeWhitespace(
    `${input.actionLabel}|${input.sentMessage.slice(0, 220)}|${input.reply.slice(0, 260)}`
  );

  if (stateEntry.lastMirroredAt && now - stateEntry.lastMirroredAt < MIRROR_COOLDOWN_MS) {
    return {
      attempted: false,
      mirrored: false,
      skippedReason: `cooldown-${Math.ceil((MIRROR_COOLDOWN_MS - (now - stateEntry.lastMirroredAt)) / 1000)}s`,
    };
  }

  if (
    stateEntry.lastFingerprint &&
    stateEntry.lastFingerprint === fingerprint &&
    stateEntry.lastFingerprintAt &&
    now - stateEntry.lastFingerprintAt < MIRROR_DEDUPE_WINDOW_MS
  ) {
    return {
      attempted: false,
      mirrored: false,
      skippedReason: 'duplicate-within-dedupe-window',
    };
  }

  try {
    const mainResult = await sendMessageToMainSession(mirrorSummary, {
      thinking: 'minimal',
      timeoutSeconds: 45,
      execTimeoutMs: 60_000,
      acceptTimeoutAsQueued: true,
    });

    mirrorState.bySession[sessionKey] = {
      lastMirroredAt: now,
      lastFingerprint: fingerprint,
      lastFingerprintAt: now,
    };
    saveMirrorState(mirrorState);

    return {
      attempted: true,
      mirrored: true,
      summaryMessage: mirrorSummary,
      mainSessionId: mainResult.sessionId,
      mainReply: mainResult.reply,
    };
  } catch (error) {
    return {
      attempted: true,
      mirrored: false,
      skippedReason: error instanceof Error ? error.message : 'unknown mirror failure',
      summaryMessage: mirrorSummary,
    };
  }
}

function findLatestFailedRunBySessionKey(runs: SubagentRunRecord[], sessionKey: string): SubagentRunRecord | undefined {
  return runs
    .filter((run) => run.childSessionKey === sessionKey)
    .filter((run) => isFailedRun(run))
    .sort((a, b) => runRecencyMs(b) - runRecencyMs(a))[0];
}

function formatMinutes(ms: number): string {
  if (ms <= 0) return '0m';
  return `${Math.max(Math.round(ms / 60000), 1)}m`;
}

function safeRetryLabel(baseLabel?: string): string {
  const normalized = (baseLabel ?? 'subagent-retry')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  const withSuffix = normalized.endsWith('-retry') ? normalized : `${normalized || 'subagent'}-retry`;
  if (withSuffix.length <= RETRY_LABEL_MAX_LENGTH) return withSuffix;
  return withSuffix.slice(0, RETRY_LABEL_MAX_LENGTH).replace(/[-_]+$/g, '') || 'subagent-retry';
}

function buildRetrySummaryMessage(input: {
  run: SubagentRunRecord;
  reason: 'manual' | 'watchdog';
  stalledForMs?: number;
}): string {
  const taskPreview = input.run.task ? truncateText(normalizeWhitespace(input.run.task), 220) : '[task unavailable]';
  const contextLine =
    input.reason === 'watchdog'
      ? `Auto-retry triggered after stall (${formatMinutes(input.stalledForMs ?? 0)} > threshold ${formatMinutes(WATCHDOG_STALLED_THRESHOLD_MS)}).`
      : 'Manual retry requested from Mission Control.';

  return [
    'Mission Control retry request',
    contextLine,
    `Original session: ${input.run.childSessionKey}`,
    input.run.runId ? `Original run: ${input.run.runId}` : undefined,
    input.run.label ? `Label: ${input.run.label}` : undefined,
    `Task summary: ${taskPreview}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildRetryPayload(run: SubagentRunRecord): {
  payload: Record<string, unknown>;
  retrySessionKey: string;
  retryLabel: string;
} {
  const task = run.task?.trim();

  if (!task) {
    throw new Error('Retry requires task metadata, but this run has no task text.');
  }

  const retrySessionKey = `agent:main:subagent:${crypto.randomUUID()}`;
  const retryLabel = safeRetryLabel(run.label);

  const payload: Record<string, unknown> = {
    sessionKey: retrySessionKey,
    message: task,
    lane: 'subagent',
    deliver: false,
    label: retryLabel,
    spawnedBy: run.requesterSessionKey?.trim() || 'agent:main:main',
    idempotencyKey: crypto.randomUUID(),
  };

  if (Number.isFinite(run.runTimeoutSeconds) && (run.runTimeoutSeconds ?? 0) > 0) {
    payload.timeout = Math.floor(run.runTimeoutSeconds as number);
  }

  if (run.requesterOrigin?.channel?.trim()) {
    payload.channel = run.requesterOrigin.channel.trim();
  }

  return {
    payload,
    retrySessionKey,
    retryLabel,
  };
}

function extractStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const maybe = (value as Record<string, unknown>)[field];
  return typeof maybe === 'string' && maybe.trim() ? maybe.trim() : undefined;
}

async function maybePatchRetrySessionModel(sessionKey: string, model?: string): Promise<void> {
  if (!model?.trim()) return;

  try {
    await runGatewayCall('sessions.patch', {
      key: sessionKey,
      model: model.trim(),
    });
  } catch {
    // Non-fatal: retry can continue with default model.
  }
}

async function requeueRun(input: {
  run: SubagentRunRecord;
  reason: 'manual' | 'watchdog';
  dryRun?: boolean;
  stalledForMs?: number;
}): Promise<RetryRequeueResult> {
  const summaryMessage = buildRetrySummaryMessage({
    run: input.run,
    reason: input.reason,
    stalledForMs: input.stalledForMs,
  });
  const { payload, retrySessionKey, retryLabel } = buildRetryPayload(input.run);

  if (input.dryRun) {
    return {
      dryRun: true,
      sessionKey: input.run.childSessionKey,
      previousRunId: input.run.runId,
      summaryMessage,
      requested: false,
      reply: 'Dry run only: requeue payload prepared (no retry run spawned).',
      newSessionKey: retrySessionKey,
      currentState: 'dry-run',
      requeuePayload: payload,
    };
  }

  await maybePatchRetrySessionModel(retrySessionKey, input.run.model);
  const rawResponse = await runGatewayCall('agent', payload);
  const newRunId = extractStringField(rawResponse, 'runId');
  const status = extractStringField(rawResponse, 'status') ?? 'accepted';

  if (!newRunId) {
    throw new Error(`Retry spawn did not return a runId: ${JSON.stringify(rawResponse)}`);
  }

  const lowerStatus = status.toLowerCase();
  if (!['accepted', 'ok', 'queued', 'running'].includes(lowerStatus)) {
    throw new Error(`Retry spawn returned unexpected status "${status}" for run ${newRunId}`);
  }

  return {
    dryRun: false,
    sessionKey: input.run.childSessionKey,
    previousRunId: input.run.runId,
    summaryMessage,
    requested: true,
    reply: `Requeued successfully as run ${newRunId} (${retryLabel}, state: ${status}).`,
    newRunId,
    newSessionKey: retrySessionKey,
    currentState: status,
    requeuePayload: payload,
    rawResponse,
  };
}

function buildWatchdogStatusUpdate(retries: WatchdogRetryItem[]): string | undefined {
  if (retries.length === 0) return undefined;

  const lines: string[] = [];
  lines.push('Mission Control watchdog update');
  lines.push(`Stalled threshold: ${formatMinutes(WATCHDOG_STALLED_THRESHOLD_MS)}.`);

  for (const item of retries) {
    const runLabel = item.runId ? `run ${item.runId}` : `session ${item.sessionKey}`;

    if (item.requested) {
      lines.push(
        `- Retried ${runLabel} after ${formatMinutes(item.stalledForMs)} stall → ${item.newRunId ?? 'new run pending'} (${item.currentState ?? 'accepted'}).`
      );
      continue;
    }

    lines.push(
      `- Could not retry ${runLabel} after ${formatMinutes(item.stalledForMs)} stall: ${item.skippedReason ?? 'unknown reason'}.`
    );
  }

  return lines.join('\n');
}

interface InternalRunWatchdogOptions {
  dryRun?: boolean;
  force?: boolean;
  sessions?: SessionRecord[];
  runs?: SubagentRunRecord[];
}

async function maybeRunStalledRunWatchdog(input: {
  sessions: SessionRecord[];
  runs: SubagentRunRecord[];
}): Promise<WatchdogRunResult> {
  return runStalledRunWatchdog({
    sessions: input.sessions,
    runs: input.runs,
    dryRun: false,
    force: false,
  });
}

export async function runStalledRunWatchdog(options: InternalRunWatchdogOptions = {}): Promise<WatchdogRunResult> {
  const nowMs = Date.now();
  const checkedAt = new Date(nowMs).toISOString();

  const runs = options.runs ?? loadRuns();

  const watchdogState = loadWatchdogState();
  const force = Boolean(options.force);

  if (
    !force &&
    watchdogState.lastScanAt &&
    nowMs - watchdogState.lastScanAt < WATCHDOG_SCAN_COOLDOWN_MS
  ) {
    return {
      checkedAt,
      thresholdMs: WATCHDOG_STALLED_THRESHOLD_MS,
      scannedRuns: runs.length,
      stalledRuns: 0,
      retries: [],
      skippedScan: true,
      skippedReason: `scan-cooldown-${Math.ceil((WATCHDOG_SCAN_COOLDOWN_MS - (nowMs - watchdogState.lastScanAt)) / 1000)}s`,
    };
  }

  const retries: WatchdogRetryItem[] = [];
  const retryStatusUpdates: WatchdogRetryItem[] = [];
  const stalledCandidates = runs
    .filter((run) => Boolean(run.childSessionKey))
    .filter((run) => isRunningRun(run))
    .map((run) => ({ run, stalledForMs: runStalledForMs(run, nowMs) }))
    .filter((item) => item.stalledForMs >= WATCHDOG_STALLED_THRESHOLD_MS)
    .sort((a, b) => b.stalledForMs - a.stalledForMs);

  for (const candidate of stalledCandidates) {
    const run = candidate.run;
    const runId = runStableId(run);
    const runState = watchdogState.runs[runId] ?? { attempts: 0 };

    if (runState.attempts >= 1) {
      retries.push({
        runId: run.runId,
        sessionKey: run.childSessionKey,
        stalledForMs: candidate.stalledForMs,
        dryRun: Boolean(options.dryRun),
        requested: false,
        skippedReason: 'already-retried-once',
      });
      continue;
    }

    if (
      runState.lastAttemptAt &&
      nowMs - runState.lastAttemptAt < WATCHDOG_RETRY_COOLDOWN_MS
    ) {
      retries.push({
        runId: run.runId,
        sessionKey: run.childSessionKey,
        stalledForMs: candidate.stalledForMs,
        dryRun: Boolean(options.dryRun),
        requested: false,
        skippedReason: `retry-cooldown-${Math.ceil((WATCHDOG_RETRY_COOLDOWN_MS - (nowMs - runState.lastAttemptAt)) / 1000)}s`,
      });
      continue;
    }

    try {
      const retryResult = await requeueRun({
        run,
        reason: 'watchdog',
        dryRun: Boolean(options.dryRun),
        stalledForMs: candidate.stalledForMs,
      });

      if (!options.dryRun) {
        watchdogState.runs[runId] = {
          attempts: 1,
          lastAttemptAt: nowMs,
          lastRunStatus: retryResult.requested ? 'requeued' : 'dry-run',
        };
      }

      const retryItem: WatchdogRetryItem = {
        runId: run.runId,
        sessionKey: run.childSessionKey,
        stalledForMs: candidate.stalledForMs,
        dryRun: Boolean(options.dryRun),
        requested: retryResult.requested,
        skippedReason: retryResult.requested ? undefined : 'dry-run',
        summaryMessage: retryResult.summaryMessage,
        newRunId: retryResult.newRunId,
        newSessionKey: retryResult.newSessionKey,
        currentState: retryResult.currentState,
      };

      retries.push(retryItem);
      retryStatusUpdates.push(retryItem);
    } catch (error) {
      watchdogState.runs[runId] = {
        attempts: 1,
        lastAttemptAt: nowMs,
        lastRunStatus: 'requeue-failed',
      };

      const retryItem: WatchdogRetryItem = {
        runId: run.runId,
        sessionKey: run.childSessionKey,
        stalledForMs: candidate.stalledForMs,
        dryRun: Boolean(options.dryRun),
        requested: false,
        skippedReason: error instanceof Error ? error.message : 'requeue-failed',
      };

      retries.push(retryItem);
      retryStatusUpdates.push(retryItem);
    }
  }

  const watchdogStatusUpdate = buildWatchdogStatusUpdate(retryStatusUpdates);
  if (watchdogStatusUpdate && !options.dryRun) {
    try {
      await sendMessageToMainSession(watchdogStatusUpdate, {
        thinking: 'minimal',
        timeoutSeconds: 45,
        execTimeoutMs: 60_000,
        acceptTimeoutAsQueued: true,
      });
    } catch (error) {
      console.warn('Mission Control watchdog could not post status update to main session:', error);
    }
  }

  watchdogState.lastScanAt = nowMs;
  if (!options.dryRun) {
    saveWatchdogState(watchdogState);
  }

  return {
    checkedAt,
    thresholdMs: WATCHDOG_STALLED_THRESHOLD_MS,
    scannedRuns: runs.length,
    stalledRuns: stalledCandidates.length,
    retries,
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function formatExecErrorDetails(error: unknown): string {
  const execError = error as ExecFileError;
  const stderr = toStringOutput(execError.stderr).trim();
  const stdout = toStringOutput(execError.stdout).trim();

  const parts: string[] = [];

  if (stderr) {
    parts.push(`stderr: ${stripAnsi(stderr).slice(0, 800)}`);
  }

  if (stdout) {
    parts.push(`stdout: ${stripAnsi(stdout).slice(0, 500)}`);
  }

  if (execError.killed) {
    parts.push('process was terminated before completion');
  }

  if (execError.signal) {
    parts.push(`signal: ${execError.signal}`);
  }

  return parts.join(' | ');
}

const DEFAULT_AGENT_SEND_TIMEOUT_SECONDS = 180;
const DEFAULT_AGENT_SEND_EXEC_TIMEOUT_MS = 200_000;
const DEFAULT_AGENT_SEND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const AGENT_SEND_MAX_MESSAGE_CHARS = 4000;
const AGENT_SEND_MAX_REPLY_CHARS = 8000;

type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface SendMessageOptions {
  thinking?: AgentThinkingLevel;
  timeoutSeconds?: number;
  execTimeoutMs?: number;
  maxBufferBytes?: number;
  acceptTimeoutAsQueued?: boolean;
}

function isExecTimeoutError(error: unknown): boolean {
  const execError = error as ExecFileError;

  if (execError?.code === 'ETIMEDOUT') return true;
  if (execError?.killed) return true;

  const message = typeof execError?.message === 'string' ? execError.message : '';
  return /timed out|terminated before completion/i.test(message);
}

function buildAgentSendArgs(sessionId: string, message: string, options: SendMessageOptions): string[] {
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_AGENT_SEND_TIMEOUT_SECONDS;
  const args = [
    'agent',
    '--session-id',
    sessionId,
    '--message',
    message,
    '--timeout',
    String(timeoutSeconds),
  ];

  if (options.thinking) {
    args.push('--thinking', options.thinking);
  }

  return args;
}

export async function sendMessageToAgentSession(
  sessionId: string,
  message: string,
  options: SendMessageOptions = {}
): Promise<{ reply: string }> {
  const trimmedSessionId = sessionId.trim();
  const sanitizedMessage = message.replace(/\u0000/g, '').trim();

  if (!trimmedSessionId) {
    throw new Error('Missing sessionId');
  }

  if (!sanitizedMessage) {
    throw new Error('Message cannot be empty');
  }

  if (sanitizedMessage.length > AGENT_SEND_MAX_MESSAGE_CHARS) {
    throw new Error(`Message is too long (max ${AGENT_SEND_MAX_MESSAGE_CHARS} characters)`);
  }

  const commandArgs = buildAgentSendArgs(trimmedSessionId, sanitizedMessage, options);

  try {
    const { stdout } = await runOpenclaw(commandArgs, {
      timeout: options.execTimeoutMs ?? DEFAULT_AGENT_SEND_EXEC_TIMEOUT_MS,
      maxBuffer: options.maxBufferBytes ?? DEFAULT_AGENT_SEND_MAX_BUFFER_BYTES,
    });

    return {
      reply: stripAnsi(stdout).trim().slice(0, AGENT_SEND_MAX_REPLY_CHARS),
    };
  } catch (error) {
    if (options.acceptTimeoutAsQueued && isExecTimeoutError(error)) {
      return {
        reply: 'Mission Control accepted your action request and it is still processing in the background.',
      };
    }

    const details = formatExecErrorDetails(error);
    const baseMessage = error instanceof Error ? error.message : 'Unknown openclaw agent send failure';

    throw new Error(details ? `${baseMessage} (${details})` : baseMessage);
  }
}

async function loadSessionsForMessaging(): Promise<SessionRecord[]> {
  try {
    return await loadSessions();
  } catch {
    return loadSessionsFromIndex();
  }
}

function resolveMainSessionRecord(sessions: SessionRecord[]): SessionRecord | undefined {
  const mainCandidates = sessions
    .filter((session) => session.key?.endsWith(':main'))
    .filter((session) => !session.key.includes(':cron:'))
    .filter((session) => !session.key.includes(':run:'))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return mainCandidates.find((session) => Boolean(session.sessionId));
}

export async function sendMessageToMainSession(
  message: string,
  options: SendMessageOptions = {}
): Promise<{ sessionId: string; reply: string }> {
  const sessions = await loadSessionsForMessaging();
  const mainSession = resolveMainSessionRecord(sessions);

  if (!mainSession?.sessionId) {
    throw new Error('Could not locate an active Main Agent session for Mission Control messaging.');
  }

  const result = await sendMessageToAgentSession(mainSession.sessionId, message, options);

  return {
    sessionId: mainSession.sessionId,
    reply: result.reply,
  };
}

export interface SendMessageWithMirrorResult {
  reply: string;
  mirror: MirrorReplyResult;
}

export async function sendMessageToAgentSessionWithMirror(input: {
  sessionId: string;
  message: string;
  actionLabel?: string;
  options?: SendMessageOptions;
}): Promise<SendMessageWithMirrorResult> {
  const sessionId = input.sessionId.trim();
  const result = await sendMessageToAgentSession(sessionId, input.message, input.options);

  let sessions: SessionRecord[] = [];
  try {
    sessions = await loadSessionsForMessaging();
  } catch (error) {
    return {
      reply: result.reply,
      mirror: {
        attempted: false,
        mirrored: false,
        skippedReason: error instanceof Error ? error.message : 'failed-to-load-sessions-for-mirror',
      },
    };
  }

  const targetSession = deriveSessionRecordFromSessionId(sessions, sessionId);
  const mirror = await maybeMirrorSubagentReply({
    targetSession,
    sessionId,
    actionLabel: input.actionLabel ?? 'message',
    sentMessage: input.message,
    reply: result.reply,
  });

  return {
    reply: result.reply,
    mirror,
  };
}
