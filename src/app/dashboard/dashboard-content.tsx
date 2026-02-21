'use client';

import { MainAgentPanel, UnblockJarvisSection } from '@/components/dashboard';
import type { DashboardData } from '@/lib/vault-parser';

export function DashboardContent({ data }: { data: DashboardData }) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Updated {new Date(data.lastUpdated).toLocaleTimeString()}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <MainAgentPanel />
        <UnblockJarvisSection
          jarvisStatus={data.jarvisStatus}
        />
      </div>
    </div>
  );
}
