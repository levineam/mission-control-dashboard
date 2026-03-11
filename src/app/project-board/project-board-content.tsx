'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { KanbanBoard } from '@/components/kanban-board';
import { ScopeProjectFilter } from '@/components/scope-project-filter';
import { MetricsStrip } from '@/components/metrics-strip';
import { transformToKanbanLanes } from '@/lib/project-board-lanes';
import { RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DashboardData } from '@/lib/vault-parser';

interface ProjectBoardContentProps {
  data: DashboardData;
}

export function ProjectBoardContent({ data }: ProjectBoardContentProps) {
  const router = useRouter();
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const diagnostics = data.diagnostics;

  // Extract all tasks
  const allTasks = useMemo(() => data.allTasks, [data.allTasks]);

  // Extract scope (portfolio) names from indexed diagnostics so empty scopes remain selectable.
  const scopeNames = useMemo(() => {
    const names = new Set<string>(diagnostics.availablePortfolios);
    Object.keys(diagnostics.projectsByPortfolio).forEach((name) => {
      if (name && name !== '(No Portfolio)') names.add(name);
    });
    return Array.from(names).sort();
  }, [diagnostics]);

  // Extract project names (filtered by scope) from indexed diagnostics so empty projects remain selectable.
  const projectNames = useMemo(() => {
    if (selectedScope) {
      return [...new Set(diagnostics.projectsByPortfolio[selectedScope] ?? [])].sort();
    }
    return [...new Set(Object.values(diagnostics.projectsByPortfolio).flat().filter(Boolean))].sort();
  }, [diagnostics, selectedScope]);

  // Transform tasks into kanban lanes with both filters
  const kanbanData = useMemo(() => {
    const lanes = transformToKanbanLanes(allTasks, selectedProject, selectedScope);
    return {
      lanes,
      totalTasks: lanes.reduce((sum, lane) => sum + lane.count, 0),
      lastUpdated: data.lastUpdated,
      selectedProject,
      selectedScope,
      availableProjects: projectNames,
      availableScopes: scopeNames,
    };
  }, [allTasks, selectedProject, selectedScope, data.lastUpdated, projectNames, scopeNames]);

  const handleScopeChange = (value: string) => {
    const newScope = value === 'all' ? null : value;
    setSelectedScope(newScope);
    // Reset project selection when scope changes
    setSelectedProject(null);
  };

  const handleProjectChange = (value: string) => {
    setSelectedProject(value === 'all' ? null : value);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

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
      {/* Header */}
      <div className="flex items-center justify-between gap-4 p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">Project Board</h1>
            <p className="text-xs text-muted-foreground">
              Last updated: {formatLastUpdated(data.lastUpdated)}
            </p>
          </div>
          <ScopeProjectFilter
            selectedScope={selectedScope}
            selectedProject={selectedProject}
            scopeNames={scopeNames}
            projectNames={projectNames}
            onScopeChange={handleScopeChange}
            onProjectChange={handleProjectChange}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="gap-1 text-muted-foreground"
            title="Show parsing diagnostics"
          >
            <Info className="h-4 w-4" />
          </Button>
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
      </div>

      {/* Diagnostics panel (collapsible) */}
      {showDiagnostics && diagnostics && (
        <div className="border-b bg-muted/50 px-4 py-3">
          <div className="text-xs space-y-1">
            <div className="font-medium text-muted-foreground mb-2">Parsing Diagnostics</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-muted-foreground">Portfolios: </span>
                <span className="font-medium">{diagnostics.portfolioFilesFound}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Project Boards: </span>
                <span className="font-medium">{diagnostics.projectBoardFilesFound}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Tasks: </span>
                <span className="font-medium">{diagnostics.totalTasksExtracted}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Tasks.md Tasks: </span>
                <span className="font-medium">{diagnostics.tasksFromTasksMd}</span>
              </div>
            </div>
            {diagnostics.emptyProjects.length > 0 && (
              <div className="mt-2">
                <span className="text-muted-foreground">Projects with 0 tasks: </span>
                <span className="text-amber-600 dark:text-amber-400">
                  {diagnostics.emptyProjects.join(', ')}
                </span>
              </div>
            )}
            {diagnostics.errors.length > 0 && (
              <div className="mt-2 text-red-600 dark:text-red-400">
                {diagnostics.errors.map((err, i) => (
                  <div key={i}>⚠ {err}</div>
                ))}
              </div>
            )}
            {selectedScope && (
              <div className="mt-2">
                <span className="text-muted-foreground">Projects in scope: </span>
                <span className="font-medium">
                  {diagnostics.projectsByPortfolio[selectedScope]?.join(', ') || 'none'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metrics strip */}
      <div className="border-b bg-muted/30 px-4">
        <MetricsStrip lanes={kanbanData.lanes} totalTasks={kanbanData.totalTasks} />
      </div>

      {/* Kanban board */}
      <div className="flex-1 p-4 overflow-hidden">
        {kanbanData.totalTasks === 0 ? (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center py-12 max-w-md">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-4" />
              <p className="font-medium text-foreground mb-2">
                No tasks found
                {selectedScope ? ` for "${selectedScope}"` : ''}
                {selectedProject ? ` → "${selectedProject}"` : ''}
              </p>
              <div className="text-sm text-muted-foreground space-y-2">
                {selectedScope || selectedProject ? (
                  <>
                    <p>Try widening your filter or selecting a different scope.</p>
                    <p className="text-xs mt-3">
                      {diagnostics && (
                        <>
                          Parsed {diagnostics.projectBoardFilesFound} project boards
                          with {diagnostics.totalTasksExtracted} total tasks across all scopes.
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      No tasks were found in any project board files.
                      This could mean:
                    </p>
                    <ul className="text-left list-disc list-inside mt-2 space-y-1">
                      <li>No <code>*Project Board*.md</code> files exist in the vault</li>
                      <li>Project boards don&apos;t contain checkbox tasks (<code>- [ ]</code>)</li>
                      <li>The vault path may be incorrect</li>
                    </ul>
                    {diagnostics && (
                      <p className="text-xs mt-3">
                        Found {diagnostics.portfolioFilesFound} portfolios,{' '}
                        {diagnostics.projectBoardFilesFound} project boards.
                        {diagnostics.errors.length > 0 && (
                          <> Errors: {diagnostics.errors.join('; ')}</>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <KanbanBoard data={kanbanData} />
        )}
      </div>
    </div>
  );
}
