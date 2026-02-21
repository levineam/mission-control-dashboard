'use client';

import { AgentsTab } from '@/components/dashboard';

export function AgentsContent() {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Agents</h2>
        <p className="text-xs text-muted-foreground">
          Active agent and subagent sessions
        </p>
      </div>
      <AgentsTab />
    </div>
  );
}
