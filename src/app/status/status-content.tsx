'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JarvisProgressSection } from '@/components/dashboard';
import { Bot } from 'lucide-react';
import type { DashboardData } from '@/lib/vault-parser';

export function StatusContent({ data }: { data: DashboardData }) {
  const openTaskCount = useMemo(
    () => data.allTasks.filter((t) => !t.completed).length,
    [data.allTasks]
  );
  const projectCount = useMemo(
    () => data.portfolios.reduce((acc, p) => acc + p.projects.length, 0),
    [data.portfolios]
  );
  const needsAndrewCount = data.jarvisStatus.needsAndrew.length;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Status</h2>
        <p className="text-xs text-muted-foreground">
          Updated {new Date(data.lastUpdated).toLocaleTimeString()}
        </p>
      </div>

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
    </div>
  );
}
