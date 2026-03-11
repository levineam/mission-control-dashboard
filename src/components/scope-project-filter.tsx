'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Layers, FolderOpen } from 'lucide-react';

interface ScopeProjectFilterProps {
  selectedScope: string | null;
  selectedProject: string | null;
  scopeNames: string[];
  projectNames: string[];
  onScopeChange: (value: string) => void;
  onProjectChange: (value: string) => void;
}

export function ScopeProjectFilter({
  selectedScope,
  selectedProject,
  scopeNames,
  projectNames,
  onScopeChange,
  onProjectChange,
}: ScopeProjectFilterProps) {
  const currentScope = selectedScope || 'all';
  const currentProject = selectedProject || 'all';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Scope (Portfolio) filter */}
      <div className="flex items-center gap-1.5">
        <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <Select value={currentScope} onValueChange={onScopeChange}>
          <SelectTrigger className="w-[180px] sm:w-[220px] h-9">
            <SelectValue placeholder="All Scopes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="font-medium">All Scopes</span>
            </SelectItem>
            {scopeNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project filter (shows projects for selected scope) */}
      <div className="flex items-center gap-1.5">
        <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <Select value={currentProject} onValueChange={onProjectChange}>
          <SelectTrigger className="w-[180px] sm:w-[240px] h-9">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="font-medium">All Projects</span>
            </SelectItem>
            {projectNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
