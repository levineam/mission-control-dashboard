import type { Task, Project } from './vault-parser';
import { Target, User, Loader, Inbox, CheckCircle, AlertTriangle } from 'lucide-react';

/** Lane identifier matching Project Board sections/statuses */
export type LaneId =
  | 'next-best-action'
  | 'needs-andrew'
  | 'in-progress'
  | 'backlog'
  | 'done';

/** Lane configuration for rendering */
export interface LaneConfig {
  id: LaneId;
  title: string;
  color: string;
  icon: typeof Target;
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
  availableProjects: string[];
}

/** Default lane configuration */
export const DEFAULT_LANES: LaneConfig[] = [
  { id: 'next-best-action', title: 'Next Best Action', color: 'amber', icon: Target },
  { id: 'needs-andrew', title: 'Needs Andrew', color: 'red', icon: User },
  { id: 'in-progress', title: 'In Progress', color: 'blue', icon: Loader },
  { id: 'backlog', title: 'Backlog', color: 'gray', icon: Inbox },
  { id: 'done', title: 'Done', color: 'emerald', icon: CheckCircle },
];

/**
 * Determine which lane a task belongs to based on its properties
 */
function determineTaskLane(task: Task): LaneId {
  // Needs Andrew tasks (highest priority)
  if (task.needsAndrew) {
    return 'needs-andrew';
  }

  // Completed tasks
  if (task.completed) {
    return 'done';
  }

  // High priority incomplete tasks → In Progress
  if (task.priority === 'high') {
    return 'in-progress';
  }

  // Default to backlog for incomplete tasks without specific markers
  return 'backlog';
}

/**
 * Extract project name from task source
 */
function getProjectBadge(task: Task): string {
  return task.source || 'Unknown Project';
}

/**
 * Transform a flat list of tasks into kanban lanes
 */
export function transformToKanbanLanes(
  tasks: Task[],
  selectedProject: string | null
): KanbanLane[] {
  // Filter by project if selected
  const filteredTasks = selectedProject
    ? tasks.filter((t) => t.source === selectedProject)
    : tasks;

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
      // High priority first
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;

      // Then by lastUpdated (newest first)
      return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
    });
  });

  // Build lane objects
  return DEFAULT_LANES.map((config) => {
    const tasks = tasksByLane.get(config.id) || [];
    return {
      id: config.id,
      config,
      tasks,
      count: tasks.length,
    };
  });
}

/**
 * Extract unique project names from tasks
 */
export function extractProjectNames(tasks: Task[]): string[] {
  const names = new Set<string>();
  tasks.forEach((task) => {
    if (task.source) {
      names.add(task.source);
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
