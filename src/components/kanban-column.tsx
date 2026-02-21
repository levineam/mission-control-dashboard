'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { KanbanCard } from './kanban-card';
import { getLaneColorClasses } from '@/lib/project-board-lanes';
import type { KanbanLane } from '@/lib/project-board-lanes';

interface KanbanColumnProps {
  lane: KanbanLane;
}

export function KanbanColumn({ lane }: KanbanColumnProps) {
  const { config, tasks, count } = lane;
  const Icon = config.icon;
  const colorClasses = getLaneColorClasses(config.color);

  return (
    <div className="flex flex-col h-full min-w-[280px] max-w-[320px] flex-shrink-0">
      <Card className={`flex-1 flex flex-col ${colorClasses.border} border-t-2`}>
        {/* Column header */}
        <CardHeader className="py-3 px-4 space-y-0 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${colorClasses.text}`} />
              <CardTitle className="text-sm font-semibold">{config.title}</CardTitle>
            </div>
            <span
              className={`
                text-xs font-medium px-2 py-0.5 rounded-full
                ${colorClasses.badge}
              `}
            >
              {count}
            </span>
          </div>
        </CardHeader>

        {/* Column content */}
        <CardContent className="flex-1 p-2 pt-0 overflow-hidden">
          <ScrollArea className="h-full max-h-[calc(100vh-320px)]">
            <div className="space-y-2 pr-2">
              {tasks.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No tasks
                </div>
              ) : (
                tasks.map((task) => <KanbanCard key={task.id} task={task} />)
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
