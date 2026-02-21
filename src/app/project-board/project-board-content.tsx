'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ProjectList, PortfolioDetail } from '@/components/dashboard';
import { ArrowLeft, ChevronDown, Folder } from 'lucide-react';
import type { DashboardData, Portfolio, Project } from '@/lib/vault-parser';

export function ProjectBoardContent({ data }: { data: DashboardData }) {
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);

  const allProjects = useMemo(() => {
    return data.portfolios.flatMap((p) => p.projects);
  }, [data.portfolios]);

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const project of allProjects) {
      names.add(project.name);
    }
    return Array.from(names).sort();
  }, [allProjects]);

  const filteredProjects = useMemo(() => {
    if (selectedProject === 'all') return allProjects;
    return allProjects.filter((p) => p.name === selectedProject);
  }, [allProjects, selectedProject]);

  const openTaskCount = filteredProjects.reduce(
    (acc, p) => acc + p.tasks.filter((t) => !t.completed).length,
    0
  );
  const totalTaskCount = filteredProjects.reduce((acc, p) => acc + p.tasks.length, 0);

  if (selectedPortfolio) {
    return (
      <div className="p-4">
        <PortfolioDetail portfolio={selectedPortfolio} onBack={() => setSelectedPortfolio(null)} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Project Board</h2>
          <p className="text-xs text-muted-foreground">
            {filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'} &middot;{' '}
            {openTaskCount} open task{openTaskCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="relative">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Projects</option>
            {projectNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="grid gap-4">
        {data.portfolios.map((portfolio) => {
          const portfolioProjects =
            selectedProject === 'all'
              ? portfolio.projects
              : portfolio.projects.filter((p) => p.name === selectedProject);

          if (portfolioProjects.length === 0) return null;

          const completedTasks = portfolioProjects.reduce(
            (acc, p) => acc + p.tasks.filter((t) => t.completed).length,
            0
          );
          const total = portfolioProjects.reduce((acc, p) => acc + p.tasks.length, 0);
          const progress = total > 0 ? (completedTasks / total) * 100 : 0;

          return (
            <Card
              key={portfolio.id}
              className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 active:scale-[0.98]"
              onClick={() => setSelectedPortfolio(portfolio)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        portfolio.health === 'green'
                          ? 'bg-green-500'
                          : portfolio.health === 'yellow'
                            ? 'bg-yellow-500'
                            : portfolio.health === 'red'
                              ? 'bg-red-500'
                              : 'bg-green-500'
                      }`}
                    />
                    <CardTitle className="text-lg">{portfolio.name}</CardTitle>
                  </div>
                  {portfolio.blockedCount > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {portfolio.blockedCount} blocked
                    </Badge>
                  )}
                </div>
                <CardDescription className="line-clamp-2 text-xs">{portfolio.vision}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{portfolioProjects.length} projects</span>
                    <span>
                      {completedTasks}/{total} tasks
                    </span>
                  </div>
                  <Progress value={progress} className="h-1.5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredProjects.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground text-center">
            No projects found. Check your vault path configuration.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
