'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import type { KanbanTask } from '@/lib/project-board-lanes';

interface KanbanCardProps {
  task: KanbanTask;
}

export function KanbanCard({ task }: KanbanCardProps) {
  const isHighPriority = task.priority === 'high';
  const isNeedsAndrew = task.needsAndrew;

  // Format last updated timestamp
  const formatLastUpdated = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
    if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
    return date.toLocaleDateString();
  };

  // Truncate text for display
  const truncateText = (text: string, maxLength: number = 80) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
  };

  return (
    <Card
      className={`
        group relative p-3 cursor-default transition-all duration-200
        hover:shadow-md hover:border-primary/30
        ${isHighPriority ? 'border-amber-500/40 bg-amber-500/5' : ''}
        ${isNeedsAndrew ? 'border-red-500/40' : ''}
      `}
    >
      {/* Header row: priority indicator + project badge */}
      <div className="flex items-center gap-2 mb-2">
        {isHighPriority && (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
        )}
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0.5 font-medium truncate max-w-[120px]"
        >
          {task.projectBadge}
        </Badge>
        {task.completed && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
          >
            Done
          </Badge>
        )}
      </div>

      {/* Task text */}
      <p className="text-sm leading-snug text-foreground mb-2">
        {truncateText(task.text)}
      </p>

      {/* Footer: timestamp + indicators */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{formatLastUpdated(task.lastUpdated)}</span>
        </div>

        {/* Expand indicator on hover */}
        {task.instructions && task.instructions.length > 0 && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-primary">
            <span>Details</span>
            <ArrowRight className="h-2.5 w-2.5" />
          </div>
        )}
      </div>

      {/* Due date if present */}
      {task.dueDate && (
        <div className="mt-2 text-[10px] text-orange-600 dark:text-orange-400">
          📅 {new Date(task.dueDate).toLocaleDateString()}
        </div>
      )}
    </Card>
  );
}
