import type { Task, BoardSection } from './vault-parser';
import { ListTodo, UserRound, CheckCircle } from 'lucide-react';

/** AI-first lane identifiers: Queue → Needs You → Done */
export type LaneId = 'queue' | 'needs-you' | 'done';

/** Lane configuration for rendering */
export interface LaneConfig {
  id: LaneId;
  title: string;
  color: string;
  icon: typeof ListTodo;
  description: string;
}

/** Task extended with kanban-specific fields */
export interface KanbanTask extends Task {
  laneId: LaneId;
  lastUpdated: string;
  projectBadge: string;
}

/** Lane with tasks for rendering */
export interface KanbanLane {
  id: LaneId;
  config: LaneConfig;
  tasks: KanbanTask[];
  count: number;
}

/** Full kanban board data */
export interface KanbanBoardData {
  lanes: KanbanLane[];
  totalTasks: number;
  lastUpdated: string;
  selectedProject: string | null;
  selectedScope: string | null;
  availableProjects: string[];
  availableScopes: string[];
}

/** 3-lane AI-first configuration */
export const DEFAULT_LANES: LaneConfig[] = [
  {
    id: 'queue',
    title: 'Queue',
    color: 'blue',
    icon: ListTodo,
    description: 'Work waiting to be done',
  },
  {
    id: 'needs-you',
    title: 'Needs You',
    color: 'amber',
    icon: UserRound,
    description: 'Blocked — needs Andrew\'s input or decision',
  },
  {
    id: 'done',
    title: 'Done',
    color: 'emerald',
    icon: CheckCircle,
    description: 'Completed tasks',
  },
];

/**
 * Determine which lane a task belongs to.
 * Uses the section-aware boardSection from parsing, with fallbacks.
 */
function determineTaskLane(task: Task): LaneId {
  // If section-aware parsing already classified it, use that
  if (task.boardSection === 'needs-you') return 'needs-you';
  if (task.boardSection === 'done') return 'done';
  if (task.boardSection === 'queue') return 'queue';

  // Fallback for tasks with unknown section
  if (task.completed) return 'done';
  if (task.needsAndrew) return 'needs-you';
  return 'queue';
}

/**
 * Extract project name from task source
 */
function getProjectBadge(task: Task): string {
  return task.source || 'Unknown Project';
}

/**
 * Transform a flat list of tasks into the 3-lane kanban.
 * Supports filtering by scope (portfolio) and project.
 */
export function transformToKanbanLanes(
  tasks: Task[],
  selectedProject: string | null,
  selectedScope: string | null
): KanbanLane[] {
  // Filter by scope (portfolio) first
  let filteredTasks = selectedScope
    ? tasks.filter((t) => t.portfolio === selectedScope)
    : tasks;

  // Then filter by project
  filteredTasks = selectedProject
    ? filteredTasks.filter((t) => t.source === selectedProject)
    : filteredTasks;

  // Group tasks by lane
  const tasksByLane = new Map<LaneId, KanbanTask[]>();
  DEFAULT_LANES.forEach((lane) => {
    tasksByLane.set(lane.id, []);
  });

  filteredTasks.forEach((task) => {
    const laneId = determineTaskLane(task);
    const kanbanTask: KanbanTask = {
      ...task,
      laneId,
      lastUpdated: task.lastUpdated || new Date().toISOString(),
      projectBadge: getProjectBadge(task),
    };
    tasksByLane.get(laneId)?.push(kanbanTask);
  });

  // Sort tasks within lanes: high priority first, then by lastUpdated
  tasksByLane.forEach((laneTasks) => {
    laneTasks.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
    });
  });

  return DEFAULT_LANES.map((config) => {
    const laneTasks = tasksByLane.get(config.id) || [];
    return {
      id: config.id,
      config,
      tasks: laneTasks,
      count: laneTasks.length,
    };
  });
}

/**
 * Extract unique project names from tasks, optionally filtered by scope.
 */
export function extractProjectNames(tasks: Task[], scope?: string | null): string[] {
  const names = new Set<string>();
  const filteredTasks = scope ? tasks.filter((t) => t.portfolio === scope) : tasks;
  filteredTasks.forEach((task) => {
    if (task.source) {
      names.add(task.source);
    }
  });
  return Array.from(names).sort();
}

/**
 * Extract unique portfolio (scope) names from tasks.
 */
export function extractScopeNames(tasks: Task[]): string[] {
  const names = new Set<string>();
  tasks.forEach((task) => {
    if (task.portfolio) {
      names.add(task.portfolio);
    }
  });
  return Array.from(names).sort();
}

/**
 * Get color classes for a lane
 */
export function getLaneColorClasses(color: string): {
  bg: string;
  border: string;
  text: string;
  badge: string;
} {
  const colorMap: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    amber: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    },
    red: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      text: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-500/20 text-red-700 dark:text-red-300',
    },
    blue: {
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30',
      text: 'text-blue-600 dark:text-blue-400',
      badge: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
    },
    gray: {
      bg: 'bg-gray-500/10',
      border: 'border-gray-500/30',
      text: 'text-gray-600 dark:text-gray-400',
      badge: 'bg-gray-500/20 text-gray-700 dark:text-gray-300',
    },
    emerald: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      text: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    },
  };

  return colorMap[color] || colorMap.gray;
}
