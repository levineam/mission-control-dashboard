'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Target,
  Bot,
  Folder,
  RefreshCw,
  Clock,
  Lock,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  BarChart3,
  ArrowLeftRight,
  Unlock,
  PanelsLeftRight,
  Send,
  Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { ThemeToggle } from '@/components/theme-toggle';
import type { DashboardData, Portfolio, Task, Project } from '@/lib/vault-parser';
import type { AgentColumnData, AgentStatus } from '@/lib/openclaw-agents';

interface DashboardProps {
  data: DashboardData;
}

interface AgentsSnapshotResponse {
  agents: AgentColumnData[];
  lastUpdated: string;
  limitations: string[];
}

interface SendResult {
  ok: boolean;
  error?: string;
  reply?: string;
}

function formatLastActivity(ts?: string): string {
  if (!ts) return 'Unknown';

  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusBadge(status: AgentStatus): { label: string; className: string } {
  if (status === 'active') {
    return {
      label: 'Active',
      className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    };
  }

  if (status === 'queued') {
    return {
      label: 'Queued',
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }

  if (status === 'failed') {
    return {
      label: 'Failed',
      className: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    };
  }

  if (status === 'recent') {
    return {
      label: 'Recent',
      className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    };
  }

  if (status === 'idle') {
    return {
      label: 'Idle',
      className: 'bg-muted text-muted-foreground border-border',
    };
  }

  if (status === 'completed') {
    return {
      label: 'Completed',
      className: 'bg-muted text-muted-foreground border-border',
    };
  }

  return {
    label: 'Unknown',
    className: 'bg-muted text-muted-foreground border-border',
  };
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="agent-markdown w-full min-w-0 text-sm leading-relaxed text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function TaskItem({ task, showSource = false }: { task: Task; showSource?: boolean }) {
  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        task.needsAndrew
          ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/50'
          : 'bg-card border-border hover:border-primary/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
            task.priority === 'high'
              ? 'bg-red-500'
              : task.priority === 'medium'
                ? 'bg-amber-500'
                : 'bg-muted-foreground'
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-relaxed">{task.text}</p>
          {(showSource || task.linkedProject) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {task.linkedProject && (
                <Badge variant="outline" className="text-xs">
                  <Folder className="w-3 h-3 mr-1" />
                  {task.linkedProject.replace(' - Project Board', '')}
                </Badge>
              )}
              {showSource && <Badge variant="secondary" className="text-xs">{task.source}</Badge>}
            </div>
          )}
        </div>
        {task.needsAndrew && (
          <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-400 flex-shrink-0">Needs You</Badge>
        )}
      </div>
    </div>
  );
}

function PortfolioCard({ portfolio, onSelect }: { portfolio: Portfolio; onSelect: () => void }) {
  const completedTasks = portfolio.projects.reduce((acc, p) => acc + p.tasks.filter((t) => t.completed).length, 0);
  const totalTasks = portfolio.projects.reduce((acc, p) => acc + p.tasks.length, 0);
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  return (
    <Card className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 active:scale-[0.98]" onClick={onSelect}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                portfolio.health === 'green'
                  ? 'bg-green-500'
                  : portfolio.health === 'yellow'
                    ? 'bg-yellow-500'
                    : portfolio.health === 'red'
                      ? 'bg-red-500'
                      : 'bg-green-500'
              }`}
            />
            <CardTitle className="text-lg">{portfolio.name}</CardTitle>
          </div>
          {portfolio.blockedCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {portfolio.blockedCount} blocked
            </Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2 text-xs">{portfolio.vision}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{portfolio.activeProjectCount} active projects</span>
            <span>
              {completedTasks}/{totalTasks} tasks
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          {portfolio.programs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {portfolio.programs.slice(0, 3).map((program) => (
                <Badge key={program.id} variant="outline" className="text-xs">
                  <div
                    className={`w-2 h-2 rounded-full mr-1 ${
                      program.status === 'active'
                        ? 'bg-green-500'
                        : program.status === 'blocked'
                          ? 'bg-yellow-500'
                          : program.status === 'completed'
                            ? 'bg-blue-500'
                            : 'bg-green-500'
                    }`}
                  />
                  {program.name.split(' - ')[0]}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {projects.map((project) => {
        const openTasks = project.tasks.filter((t) => !t.completed);
        const isExpanded = expandedProject === project.id;

        return (
          <Card key={project.id} className="overflow-hidden">
            <div
              className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedProject(isExpanded ? null : project.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      project.status === 'active'
                        ? 'bg-green-500'
                        : project.status === 'blocked'
                          ? 'bg-yellow-500'
                          : project.status === 'completed'
                            ? 'bg-blue-500'
                            : project.status === 'paused'
                              ? 'bg-gray-500'
                              : 'bg-green-500'
                    }`}
                  />
                  <h4 className="font-medium text-sm">{project.name}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {openTasks.length} tasks
                  </Badge>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
              {project.owner && <p className="text-xs text-muted-foreground mt-1">Owner: {project.owner}</p>}
            </div>

            {isExpanded && openTasks.length > 0 && (
              <div className="border-t bg-muted/30 p-4 space-y-2">
                {openTasks.slice(0, 5).map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {openTasks.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">+{openTasks.length - 5} more tasks</p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function PortfolioDetail({ portfolio, onBack }: { portfolio: Portfolio; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="p-2">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                portfolio.health === 'green'
                  ? 'bg-green-500'
                  : portfolio.health === 'yellow'
                    ? 'bg-yellow-500'
                    : portfolio.health === 'red'
                      ? 'bg-red-500'
                      : 'bg-green-500'
              }`}
            />
            {portfolio.name}
          </h2>
          <p className="text-sm text-muted-foreground">{portfolio.vision}</p>
        </div>
      </div>

      <Separator />

      {portfolio.programs.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground">Programs</h3>
          <div className="grid gap-2">
            {portfolio.programs.map((program) => (
              <Card key={program.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        program.status === 'active'
                          ? 'bg-green-500'
                          : program.status === 'blocked'
                            ? 'bg-yellow-500'
                            : program.status === 'completed'
                              ? 'bg-blue-500'
                              : 'bg-green-500'
                      }`}
                    />
                    <span className="font-medium text-sm">{program.name}</span>
                  </div>
                  {program.target && (
                    <Badge variant="outline" className="text-xs">
                      Target: {program.target}
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground">Projects</h3>
        <ProjectList projects={portfolio.projects} />
      </div>
    </div>
  );
}

function UnblockJarvisSection({ jarvisStatus }: { jarvisStatus: DashboardData['jarvisStatus'] }) {
  const highPriorityItems = jarvisStatus.needsAndrew.filter((t) => t.priority === 'high');
  const otherItems = jarvisStatus.needsAndrew.filter((t) => t.priority !== 'high');

  return (
    <div className="space-y-4">
      {jarvisStatus.nextBestAction && (
        <Card className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border-amber-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-base">Next Best Action</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <TaskItem task={jarvisStatus.nextBestAction} showSource />
          </CardContent>
        </Card>
      )}

      {highPriorityItems.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-red-400" />
              <CardTitle className="text-base text-red-400">High Priority</CardTitle>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{highPriorityItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {highPriorityItems.map((task) => (
              <TaskItem key={task.id} task={task} showSource />
            ))}
          </CardContent>
        </Card>
      )}

      {otherItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-base">Waiting on You</CardTitle>
              <Badge variant="secondary">{otherItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherItems.slice(0, 8).map((task) => (
              <TaskItem key={task.id} task={task} showSource />
            ))}
            {otherItems.length > 8 && (
              <p className="text-xs text-muted-foreground text-center pt-2">+{otherItems.length - 8} more items</p>
            )}
          </CardContent>
        </Card>
      )}

      {jarvisStatus.alternates.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-base text-muted-foreground">Alternates</CardTitle>
            </div>
            <CardDescription>Other things you could work on</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {jarvisStatus.alternates.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function JarvisProgressSection({ jarvisStatus }: { jarvisStatus: DashboardData['jarvisStatus'] }) {
  if (jarvisStatus.inProgress.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">Jarvis In Progress</CardTitle>
          <Badge variant="secondary">{jarvisStatus.inProgress.length}</Badge>
        </div>
        <CardDescription>What I&apos;m working on (no action needed)</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2 pr-4">
            {jarvisStatus.inProgress.map((task) => (
              <div key={task.id} className="p-2 rounded bg-muted/50 text-sm">
                {task.text}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AgentColumn({
  agent,
  onSend,
}: {
  agent: AgentColumnData;
  onSend: (sessionId: string, message: string) => Promise<SendResult>;
}) {
  const [composer, setComposer] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendState, setSendState] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const badge = statusBadge(agent.status);

  async function handleSend() {
    if (!agent.sessionId || !composer.trim() || isSending) return;

    setIsSending(true);
    setSendState(null);

    const result = await onSend(agent.sessionId, composer.trim());

    if (result.ok) {
      setComposer('');
      setSendState({
        kind: 'success',
        message: result.reply ? `Sent. Reply: ${result.reply.slice(0, 180)}` : 'Sent successfully.',
      });
    } else {
      setSendState({ kind: 'error', message: result.error ?? 'Failed to send message.' });
    }

    setIsSending(false);
  }

  return (
    <Card className="w-full min-w-0 overflow-hidden h-[560px] flex flex-col md:min-w-[420px] md:flex-1">
      <CardHeader className="pb-3 space-y-3 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{agent.name}</CardTitle>
            <CardDescription className="truncate text-xs">{agent.sessionKey}</CardDescription>
          </div>
          <Badge className={`${badge.className} overflow-visible whitespace-nowrap px-2.5 py-1 leading-tight min-h-6 min-w-max shrink-0`}>
            {badge.label}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {agent.model && <Badge variant="outline" className="text-[10px]">{agent.model}</Badge>}
          {agent.runtime && <Badge variant="outline" className="text-[10px]">{agent.runtime}</Badge>}
          <Badge variant="secondary" className="text-[10px]">
            Last: {formatLastActivity(agent.lastActivity)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex min-h-0 min-w-0 flex-col gap-3 pt-0">
        <ScrollArea className="flex-1 min-h-0 min-w-0 rounded-lg border bg-muted/20">
          <div className="space-y-3 p-3 pr-4 min-w-0">
            {agent.messages.length === 0 && (
              <p className="text-xs text-muted-foreground">No transcript messages captured yet for this session.</p>
            )}

            {agent.messages.map((message) => (
              <div
                key={message.id}
                className={`w-full min-w-0 overflow-x-auto rounded-md border p-2.5 ${
                  message.role === 'assistant'
                    ? 'bg-card border-border'
                    : message.role === 'user'
                      ? 'bg-primary/10 border-primary/20'
                      : 'bg-muted border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {message.role}
                  </Badge>
                  {message.timestamp && (
                    <span className="text-[10px] text-muted-foreground">{formatLastActivity(message.timestamp)}</span>
                  )}
                </div>
                <MarkdownMessage text={message.text} />
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="space-y-2">
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={agent.canSend ? 'Send a message to this agent session…' : 'Messaging unavailable for this session'}
            disabled={!agent.canSend || isSending}
            className="w-full min-h-[72px] resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {agent.canSend ? 'Safe action only: sends a message to this session.' : 'Queued session without a message target yet.'}
            </p>
            <Button size="sm" onClick={handleSend} disabled={!agent.canSend || !composer.trim() || isSending}>
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="ml-1">Send</span>
            </Button>
          </div>

          {sendState && (
            <p
              className={`text-xs ${
                sendState.kind === 'success'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {sendState.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentsTab() {
  const [snapshot, setSnapshot] = useState<AgentsSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAgents(isSilentRefresh = false) {
    try {
      if (isSilentRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const response = await fetch('/api/agents', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AgentsSnapshotResponse;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadAgents();

    const interval = window.setInterval(() => {
      void loadAgents(true);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, []);

  async function sendToSession(sessionId: string, message: string): Promise<SendResult> {
    try {
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; reply?: string };
      if (!response.ok || !data.ok) {
        return {
          ok: false,
          error: data.error ?? `HTTP ${response.status}`,
        };
      }

      void loadAgents(true);

      return {
        ok: true,
        reply: data.reply,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown send failure',
      };
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PanelsLeftRight className="w-5 h-5" />
            Agents
          </CardTitle>
          <CardDescription>Loading active sessions…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agents</CardTitle>
          <CardDescription className="text-red-400">Could not load agents data: {error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void loadAgents()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const agents = snapshot?.agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Active Agents</h3>
          <p className="text-xs text-muted-foreground">
            Updated {snapshot?.lastUpdated ? formatLastActivity(snapshot.lastUpdated) : 'just now'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadAgents(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </div>

      {(snapshot?.limitations ?? []).length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="pt-4 space-y-1">
            {(snapshot?.limitations ?? []).map((item) => (
              <p key={item} className="text-xs text-amber-200">
                {item}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {agents.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No active agent or subagent sessions are currently available.
          </CardContent>
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-stretch md:overflow-x-auto md:overflow-y-hidden md:pb-3">
          {agents.map((agent) => (
            <AgentColumn key={agent.id} agent={agent} onSend={sendToSession} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Dashboard({ data }: DashboardProps) {
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [activeTab, setActiveTab] = useState('unblock');

  const needsAndrewCount = data.jarvisStatus.needsAndrew.length;

  const openTaskCount = useMemo(() => data.allTasks.filter((task) => !task.completed).length, [data.allTasks]);
  const projectCount = useMemo(
    () => data.portfolios.reduce((acc, portfolio) => acc + portfolio.projects.length, 0),
    [data.portfolios]
  );

  return (
    <div className="pb-20 md:pb-6">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Mission Control
              </h1>
              <p className="text-xs text-muted-foreground">Updated {new Date(data.lastUpdated).toLocaleTimeString()}</p>
            </div>
            <div className="flex items-center gap-2">
              {needsAndrewCount > 0 && (
                <Badge className="bg-amber-500 text-amber-950">{needsAndrewCount} need you</Badge>
              )}
              <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 py-4">
        {selectedPortfolio ? (
          <PortfolioDetail portfolio={selectedPortfolio} onBack={() => setSelectedPortfolio(null)} />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="w-full grid grid-cols-4 h-12">
              <TabsTrigger value="unblock" className="text-xs data-[state=active]:bg-amber-500/20">
                <div className="flex items-center gap-1">
                  <Unlock className="w-4 h-4" />
                  <span>Unblock</span>
                </div>
                {needsAndrewCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-amber-950 text-[10px]">
                    {needsAndrewCount}
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger value="portfolios" className="text-xs">
                <div className="flex items-center gap-1">
                  <BarChart3 className="w-4 h-4" />
                  <span>Portfolios</span>
                </div>
              </TabsTrigger>

              <TabsTrigger value="agents" className="text-xs">
                <div className="flex items-center gap-1">
                  <PanelsLeftRight className="w-4 h-4" />
                  <span>Agents</span>
                </div>
              </TabsTrigger>

              <TabsTrigger value="jarvis" className="text-xs">
                <div className="flex items-center gap-1">
                  <Bot className="w-4 h-4" />
                  <span>Jarvis</span>
                </div>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="unblock" className="space-y-4 mt-0">
              <UnblockJarvisSection jarvisStatus={data.jarvisStatus} />
            </TabsContent>

            <TabsContent value="portfolios" className="space-y-4 mt-0">
              <div className="grid gap-4">
                {data.portfolios.map((portfolio) => (
                  <PortfolioCard key={portfolio.id} portfolio={portfolio} onSelect={() => setSelectedPortfolio(portfolio)} />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="agents" className="space-y-4 mt-0">
              <AgentsTab />
            </TabsContent>

            <TabsContent value="jarvis" className="space-y-4 mt-0">
              <JarvisProgressSection jarvisStatus={data.jarvisStatus} />

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-muted-foreground" />
                    <CardTitle className="text-base">System Status</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-2xl font-bold">{data.portfolios.length}</div>
                      <div className="text-xs text-muted-foreground">Portfolios</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-2xl font-bold">{projectCount}</div>
                      <div className="text-xs text-muted-foreground">Projects</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-2xl font-bold">{openTaskCount}</div>
                      <div className="text-xs text-muted-foreground">Open Tasks</div>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-500/10">
                      <div className="text-2xl font-bold text-amber-500">{needsAndrewCount}</div>
                      <div className="text-xs text-muted-foreground">Need Andrew</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t safe-area-inset-bottom md:hidden">
        <div className="flex justify-around py-2">
          <Button
            variant={activeTab === 'unblock' ? 'secondary' : 'ghost'}
            className="flex-col h-14 flex-1 rounded-none"
            onClick={() => {
              setSelectedPortfolio(null);
              setActiveTab('unblock');
            }}
          >
            <Unlock className="w-5 h-5" />
            <span className="text-[10px]">Unblock</span>
          </Button>

          <Button
            variant={activeTab === 'portfolios' ? 'secondary' : 'ghost'}
            className="flex-col h-14 flex-1 rounded-none"
            onClick={() => {
              setSelectedPortfolio(null);
              setActiveTab('portfolios');
            }}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px]">Portfolios</span>
          </Button>

          <Button
            variant={activeTab === 'agents' ? 'secondary' : 'ghost'}
            className="flex-col h-14 flex-1 rounded-none"
            onClick={() => {
              setSelectedPortfolio(null);
              setActiveTab('agents');
            }}
          >
            <PanelsLeftRight className="w-5 h-5" />
            <span className="text-[10px]">Agents</span>
          </Button>

          <Button
            variant={activeTab === 'jarvis' ? 'secondary' : 'ghost'}
            className="flex-col h-14 flex-1 rounded-none"
            onClick={() => {
              setSelectedPortfolio(null);
              setActiveTab('jarvis');
            }}
          >
            <Bot className="w-5 h-5" />
            <span className="text-[10px]">Jarvis</span>
          </Button>
        </div>
      </nav>
    </div>
  );
}
