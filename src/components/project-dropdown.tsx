'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FolderOpen, ChevronDown } from 'lucide-react';

interface ProjectDropdownProps {
  selectedProject: string | null;
  projectNames: string[];
  onProjectChange: (value: string) => void;
}

export function ProjectDropdown({
  selectedProject,
  projectNames,
  onProjectChange,
}: ProjectDropdownProps) {
  const currentValue = selectedProject || 'all';

  return (
    <div className="flex items-center gap-2">
      <FolderOpen className="h-4 w-4 text-muted-foreground" />
      <Select value={currentValue} onValueChange={onProjectChange}>
        <SelectTrigger className="w-[200px] sm:w-[260px]">
          <SelectValue placeholder="Select a project" />
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
  );
}
