'use client';

import { KanbanColumn } from './kanban-column';
import type { KanbanBoardData } from '@/lib/project-board-lanes';

interface KanbanBoardProps {
  data: KanbanBoardData;
}

export function KanbanBoard({ data }: KanbanBoardProps) {
  const { lanes, totalTasks } = data;

  return (
    <div className="flex-1 overflow-x-auto pb-4">
      <div className="flex gap-4 h-full min-h-[400px]">
        {lanes.map((lane) => (
          <KanbanColumn key={lane.id} lane={lane} />
        ))}
      </div>

      {/* Empty state */}
      {totalTasks === 0 && (
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          <p>No tasks found. Select a different project or check your vault configuration.</p>
        </div>
      )}
    </div>
  );
}
