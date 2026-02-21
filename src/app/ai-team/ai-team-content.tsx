'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentsSnapshot, statusBadge, formatLastActivity } from '@/components/dashboard';
import type { AgentColumnData } from '@/lib/openclaw-agents';
import { Crown, Search, Paintbrush, BarChart3, Code, Bot } from 'lucide-react';

const ROLE_MAP: Record<string, { role: string; icon: typeof Crown; description: string }> = {
  'agent:main:main': {
    role: 'Chief of Staff',
    icon: Crown,
    description: 'Coordination & planning',
  },
};

const ROLE_DEFAULTS = [
  { role: 'Researcher', icon: Search, description: 'Information gathering' },
  { role: 'Creative', icon: Paintbrush, description: 'Writing & content creation' },
  { role: 'Analyst', icon: BarChart3, description: 'Analysis & insights' },
  { role: 'Developer', icon: Code, description: 'Technical execution' },
];

function assignRole(agent: AgentColumnData, index: number) {
  const mapped = ROLE_MAP[agent.sessionKey];
  if (mapped) return mapped;

  const roleIndex = index < ROLE_DEFAULTS.length ? index : index % ROLE_DEFAULTS.length;
  return ROLE_DEFAULTS[roleIndex];
}

export function AITeamContent() {
  const { snapshot, loading, error } = useAgentsSnapshot();
  const agents = snapshot?.agents ?? [];

  const mainAgent = useMemo(
    () => agents.find((a) => a.sessionKey === 'agent:main:main'),
    [agents]
  );

  const subagents = useMemo(
    () => agents.filter((a) => a.sessionKey !== 'agent:main:main'),
    [agents]
  );

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold">AI Team</h2>
        <p className="text-sm text-muted-foreground">Loading team members...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold">AI Team</h2>
        <Card className="border-red-500/30">
          <CardContent className="pt-4">
            <p className="text-sm text-red-400">Could not load AI team: {error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allAgents = [
    ...(mainAgent ? [{ agent: mainAgent, ...assignRole(mainAgent, 0) }] : []),
    ...subagents.map((agent, i) => ({ agent, ...assignRole(agent, i) })),
  ];

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold">AI Team</h2>
        <p className="text-xs text-muted-foreground">
          {agents.length} active team member{agents.length === 1 ? '' : 's'}
        </p>
      </div>

      {allAgents.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No active AI team members. Start a session to see your team here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {allAgents.map(({ agent, role, icon: Icon, description }) => {
            const badge = statusBadge(agent.status);
            const isChief = agent.sessionKey === 'agent:main:main';

            return (
              <Card
                key={agent.id}
                className={isChief ? 'border-primary/40 bg-primary/5 md:col-span-2' : ''}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                          isChief
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{role}</CardTitle>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    <Badge className={`${badge.className} shrink-0`}>{badge.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {agent.model && (
                      <Badge variant="outline" className="text-[10px]">
                        {agent.model}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      Last: {formatLastActivity(agent.lastActivity)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      <Bot className="w-3 h-3 mr-0.5" />
                      {agent.name}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
