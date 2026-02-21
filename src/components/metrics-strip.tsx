'use client';

import { Card } from '@/components/ui/card';
import { getLaneColorClasses, DEFAULT_LANES } from '@/lib/project-board-lanes';
import type { KanbanLane } from '@/lib/project-board-lanes';

interface MetricsStripProps {
  lanes: KanbanLane[];
  totalTasks: number;
}

export function MetricsStrip({ lanes, totalTasks }: MetricsStripProps) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 overflow-x-auto">
      {lanes.map((lane) => {
        const colorClasses = getLaneColorClasses(lane.config.color);
        const Icon = lane.config.icon;

        return (
          <div
            key={lane.id}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-md text-sm
              ${colorClasses.bg} ${colorClasses.border} border
            `}
          >
            <Icon className={`h-3.5 w-3.5 ${colorClasses.text}`} />
            <span className="font-medium">{lane.count}</span>
            <span className="text-muted-foreground hidden sm:inline">{lane.config.title}</span>
          </div>
        );
      })}

      {/* Total */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-primary/10 border border-primary/20 ml-auto">
        <span className="font-medium">{totalTasks}</span>
        <span className="text-muted-foreground">Total</span>
      </div>
    </div>
  );
}
