'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { KanbanBoard } from '@/components/kanban-board';
import { ProjectDropdown } from '@/components/project-dropdown';
import { MetricsStrip } from '@/components/metrics-strip';
import { transformToKanbanLanes, extractProjectNames } from '@/lib/project-board-lanes';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DashboardData } from '@/lib/vault-parser';

interface ProjectBoardContentProps {
  data: DashboardData;
}

export function ProjectBoardContent({ data }: ProjectBoardContentProps) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Extract all tasks from all projects
  const allTasks = useMemo(() => {
    return data.allTasks;
  }, [data.allTasks]);

  // Extract unique project names
  const projectNames = useMemo(() => {
    return extractProjectNames(allTasks);
  }, [allTasks]);

  // Transform tasks into kanban lanes
  const kanbanData = useMemo(() => {
    const lanes = transformToKanbanLanes(allTasks, selectedProject);
    return {
      lanes,
      totalTasks: lanes.reduce((sum, lane) => sum + lane.count, 0),
      lastUpdated: data.lastUpdated,
      selectedProject,
      availableProjects: projectNames,
    };
  }, [allTasks, selectedProject, data.lastUpdated, projectNames]);

  const handleProjectChange = (value: string) => {
    setSelectedProject(value === 'all' ? null : value);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Force a page refresh
    window.location.reload();
  };

  // Format last updated timestamp
  const formatLastUpdated = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with dropdown and refresh */}
      <div className="flex items-center justify-between gap-4 p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold">Project Board</h1>
            <p className="text-xs text-muted-foreground">
              Last updated: {formatLastUpdated(data.lastUpdated)}
            </p>
          </div>
          <ProjectDropdown
            selectedProject={selectedProject}
            projectNames={projectNames}
            onProjectChange={handleProjectChange}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Metrics strip */}
      <div className="border-b bg-muted/30 px-4">
        <MetricsStrip lanes={kanbanData.lanes} totalTasks={kanbanData.totalTasks} />
      </div>

      {/* Kanban board */}
      <div className="flex-1 p-4 overflow-hidden">
        {kanbanData.totalTasks === 0 ? (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground">
                No tasks found.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {projectNames.length === 0
                  ? 'Check your vault configuration.'
                  : 'Try selecting a different project or check for tasks in your Project Board files.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <KanbanBoard data={kanbanData} />
        )}
      </div>
    </div>
  );
}
