import fs from 'fs';
import path from 'path';

const VAULT_PATH = '/Users/andrew/Documents/Vault v3';

/** Which board section a task was found in */
export type BoardSection = 'needs-you' | 'queue' | 'done' | 'unknown';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  priority?: 'high' | 'medium' | 'low';
  needsAndrew: boolean;
  source: string;
  sourcePath: string;
  dueDate?: string;
  linkedProject?: string;
  instructions?: string[];
  lastUpdated?: string;
  /** Which board section this task was parsed from */
  boardSection: BoardSection;
  /** Portfolio this task's project belongs to */
  portfolio?: string;
  /** Program this task's project belongs to */
  program?: string;
}

export interface Project {
  id: string;
  name: string;
  status: 'active' | 'blocked' | 'completed' | 'paused';
  owner: string;
  program?: string;
  portfolio?: string;
  tasks: Task[];
  path: string;
}

export interface Program {
  id: string;
  name: string;
  status: 'active' | 'blocked' | 'completed';
  projects: string[];
  portfolio: string;
  target?: string;
}

export interface Portfolio {
  id: string;
  name: string;
  vision: string;
  health: 'green' | 'yellow' | 'red';
  programs: Program[];
  projects: Project[];
  activeProjectCount: number;
  blockedCount: number;
  lastReview?: string;
}

export interface JarvisStatus {
  needsAndrew: Task[];
  inProgress: Task[];
  nextBestAction?: Task;
  alternates: Task[];
}

/** Diagnostics for debugging empty/unexpected states */
export interface ParseDiagnostics {
  /** Number of portfolio files found */
  portfolioFilesFound: number;
  /** Number of project board files found */
  projectBoardFilesFound: number;
  /** Number of tasks extracted total */
  totalTasksExtracted: number;
  /** Number of tasks from Tasks.md */
  tasksFromTasksMd: number;
  /** Project names that yielded zero tasks */
  emptyProjects: string[];
  /** Any parsing errors encountered */
  errors: string[];
  /** Available portfolios for filtering */
  availablePortfolios: string[];
  /** Available projects grouped by portfolio */
  projectsByPortfolio: Record<string, string[]>;
}

export interface DashboardData {
  portfolios: Portfolio[];
  jarvisStatus: JarvisStatus;
  allTasks: Task[];
  lastUpdated: string;
  diagnostics: ParseDiagnostics;
}

function parseStatus(text: string): 'active' | 'blocked' | 'completed' | 'paused' {
  if (text.toLowerCase().includes('completed')) {
    return 'completed';
  }
  if (text.toLowerCase().includes('paused')) {
    return 'paused';
  }
  if (text.toLowerCase().includes('blocked') || text.toLowerCase().includes('attention')) {
    return 'blocked';
  }
  return 'active';
}

function parseHealth(text: string): 'green' | 'yellow' | 'red' {
  if (text.toLowerCase().includes('blocked') || text.toLowerCase().includes('red')) {
    return 'red';
  }
  if (text.toLowerCase().includes('attention') || text.toLowerCase().includes('early stage') || text.toLowerCase().includes('yellow')) {
    return 'yellow';
  }
  return 'green';
}

interface WikiLinkRef {
  target: string;
  display: string;
}

const linkedNoteInstructionsCache = new Map<string, string[]>();

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWikiLinks(text: string): WikiLinkRef[] {
  const links: WikiLinkRef[] = [];
  const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    const target = match[1]?.trim();
    if (!target) continue;

    links.push({
      target,
      display: (match[2] ?? target).trim(),
    });
  }

  return links;
}

function dedupeStrings(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const cleaned = cleanInlineMarkdown(value).replace(/[.;]+$/, '').trim();
    if (!cleaned) return;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    deduped.push(cleaned);
  });

  return deduped;
}

function shouldExtractInstructionsFromLinkedNote(noteName: string): boolean {
  const normalized = noteName.trim().toLowerCase();

  if (!normalized) return false;

  return ![
    ' - project board',
    ' - project brief',
    ' - portfolio',
    ' - program',
  ].some((suffix) => normalized.endsWith(suffix));
}

function extractInstructionsFromLinkedNote(noteName: string): string[] {
  const cacheKey = noteName.toLowerCase();
  const cached = linkedNoteInstructionsCache.get(cacheKey);
  if (cached) return cached;

  const notePath = path.join(VAULT_PATH, 'Notes', `${noteName}.md`);
  if (!fs.existsSync(notePath)) {
    linkedNoteInstructionsCache.set(cacheKey, []);
    return [];
  }

  try {
    const noteContent = fs.readFileSync(notePath, 'utf-8');

    const checkboxSteps = Array.from(noteContent.matchAll(/^\s*- \[ \] (.+)$/gm)).map((match) => match[1]);
    const numberedSteps = Array.from(noteContent.matchAll(/^\s*\d+\.\s+(.+)$/gm)).map((match) => match[1]);

    let extracted = checkboxSteps;
    if (extracted.length === 0) {
      extracted = numberedSteps;
    }

    if (extracted.length === 0) {
      const bulletSteps = Array.from(noteContent.matchAll(/^\s*-\s+(.+)$/gm))
        .map((match) => match[1])
        .filter((line) => !line.startsWith('---') && !line.startsWith('>') && !line.includes('|'));
      extracted = bulletSteps;
    }

    const instructions = dedupeStrings(extracted).slice(0, 18);
    linkedNoteInstructionsCache.set(cacheKey, instructions);
    return instructions;
  } catch (error) {
    console.error(`Error extracting instructions from note ${noteName}:`, error);
    linkedNoteInstructionsCache.set(cacheKey, []);
    return [];
  }
}

function deriveTaskInstructions(rawLine: string, includeFallback = true): string[] {
  const links = extractWikiLinks(rawLine);
  const actionableLinks = links.filter((link) => shouldExtractInstructionsFromLinkedNote(link.target));
  const cleanedLine = cleanInlineMarkdown(rawLine).replace(/^(HIGH PRIORITY:?)\s*/i, '');
  const inlineInstructions: string[] = [];

  const colonIndex = cleanedLine.indexOf(':');
  if (colonIndex > 0 && colonIndex < cleanedLine.length - 1) {
    const trailingDetails = cleanedLine.slice(colonIndex + 1).trim();
    if (trailingDetails.length > 3) {
      inlineInstructions.push(trailingDetails);
    }
  }

  const linkedInstructions = actionableLinks.flatMap((link) => extractInstructionsFromLinkedNote(link.target));

  if (linkedInstructions.length === 0 && actionableLinks.length > 0) {
    inlineInstructions.push(...actionableLinks.map((link) => `Open ${link.display} and complete the listed steps.`));
  }

  const combined = dedupeStrings([...inlineInstructions, ...linkedInstructions]);
  if (combined.length > 0) return combined;

  return includeFallback ? [cleanedLine] : [];
}

interface StatusListItem {
  line: string;
  detailLines: string[];
}

function parseStatusListItems(statusContent: string, sectionHeadingRegex: RegExp): StatusListItem[] {
  const lines = statusContent.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => sectionHeadingRegex.test(line.trim()));
  if (sectionIndex === -1) return [];

  const items: StatusListItem[] = [];
  let currentItem: StatusListItem | null = null;

  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (/^###\s+/.test(rawLine.trim())) break;

    const topLevelMatch = rawLine.match(/^\s*-\s+(.+)$/);
    if (topLevelMatch && !rawLine.startsWith('  ')) {
      const line = topLevelMatch[1].trim();
      if (!line || line === '_TBD_') {
        currentItem = null;
        continue;
      }

      currentItem = { line, detailLines: [] };
      items.push(currentItem);
      continue;
    }

    if (!currentItem) continue;

    const nestedBulletMatch = rawLine.match(/^\s{2,}(?:-|\d+\.)\s+(.+)$/);
    if (nestedBulletMatch) {
      currentItem.detailLines.push(nestedBulletMatch[1].trim());
      continue;
    }

    const indentedTextMatch = rawLine.match(/^\s{2,}(.+)$/);
    if (indentedTextMatch) {
      currentItem.detailLines.push(indentedTextMatch[1].trim());
    }
  }

  return items;
}

function buildStatusTaskInstructions(rawLine: string, detailLines: string[]): string[] {
  const cleanedDetailLines = detailLines.map((line) => cleanInlineMarkdown(line)).filter(Boolean);
  const derivedInstructions = deriveTaskInstructions(rawLine, cleanedDetailLines.length === 0);
  const instructions = dedupeStrings([...cleanedDetailLines, ...derivedInstructions]);

  if (instructions.length > 0) return instructions;

  return [cleanInlineMarkdown(rawLine)];
}

/**
 * Classify a section heading into a board section.
 * Uses keyword matching against common patterns found across project boards.
 */
function classifySectionHeading(heading: string): BoardSection {
  const lower = heading.toLowerCase().replace(/[#*_📦✅🔧🚀]/g, '').trim();

  // "Needs Andrew" / "Needs You" → needs-you
  if (/needs\s*(andrew|you|input|decision)/i.test(lower)) {
    return 'needs-you';
  }

  // "Done" / "Completed" / "Shipped" → done
  if (/\b(done|completed|shipped|finished)\b/i.test(lower)) {
    return 'done';
  }

  // Everything else with tasks is queue: Backlog, In Progress, Active, Tasks,
  // Autonomous Now, This Week, Next Actions, Roadmap, Waiting, etc.
  return 'queue';
}

/**
 * Section-aware task extraction from a project board file.
 * Tracks which heading section each task belongs to and maps it to a BoardSection.
 */
function extractTasksSectionAware(
  content: string,
  source: string,
  sourcePath: string,
  projectPortfolio?: string,
  projectProgram?: string,
): Task[] {
  const tasks: Task[] = [];
  const lines = content.split(/\r?\n/);
  let currentSection: BoardSection = 'unknown';
  let index = 0;

  // Get file modification time for lastUpdated
  let lastUpdated: string;
  try {
    const stats = fs.statSync(sourcePath);
    lastUpdated = stats.mtime.toISOString();
  } catch {
    lastUpdated = new Date().toISOString();
  }

  for (const line of lines) {
    // Detect section headings (## or ###)
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      currentSection = classifySectionHeading(headingMatch[1]);
      continue;
    }

    // Match task checkboxes
    const taskMatch = line.match(/^- \[([ x])\] (.+)$/);
    if (!taskMatch) continue;

    const completed = taskMatch[1] === 'x';
    const text = taskMatch[2];

    // Override section if task is completed but wasn't in a "done" section
    const effectiveSection = completed ? 'done' : currentSection;

    // Check for "needs andrew" indicators in task text
    const needsAndrew =
      effectiveSection === 'needs-you' ||
      text.toLowerCase().includes('needs andrew') ||
      text.toLowerCase().includes('(admin)') ||
      text.toLowerCase().includes('andrew only') ||
      text.toLowerCase().includes('waiting on andrew');

    // Check for priority indicators
    let priority: 'high' | 'medium' | 'low' | undefined;
    if (text.toLowerCase().includes('high priority') || text.toLowerCase().includes('(top priority)') || text.toLowerCase().includes('critical') || text.includes('[P1]')) {
      priority = 'high';
    } else if (text.includes('📅') || text.includes('deadline') || text.toLowerCase().includes('medium priority') || text.includes('[P2]')) {
      priority = 'medium';
    }

    // Extract due date if present
    const dueDateMatch = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    const dueDate = dueDateMatch ? dueDateMatch[1] : undefined;

    // Extract linked project
    const firstLink = extractWikiLinks(text)[0];
    const linkedProject = firstLink?.target;

    tasks.push({
      id: `${sourcePath}-${index++}`,
      text: cleanInlineMarkdown(text),
      completed,
      priority,
      needsAndrew,
      source,
      sourcePath,
      dueDate,
      linkedProject,
      instructions: deriveTaskInstructions(text),
      lastUpdated,
      boardSection: effectiveSection,
      portfolio: projectPortfolio,
      program: projectProgram,
    });
  }

  return tasks;
}

/**
 * Legacy extractTasks kept for non-project-board files.
 */
function extractTasks(content: string, source: string, sourcePath: string): Task[] {
  const tasks: Task[] = [];
  const taskRegex = /^- \[([ x])\] (.+)$/gm;
  let match;
  let index = 0;

  let lastUpdated: string;
  try {
    const stats = fs.statSync(sourcePath);
    lastUpdated = stats.mtime.toISOString();
  } catch {
    lastUpdated = new Date().toISOString();
  }

  while ((match = taskRegex.exec(content)) !== null) {
    const completed = match[1] === 'x';
    const text = match[2];

    const needsAndrew =
      text.toLowerCase().includes('needs andrew') ||
      text.toLowerCase().includes('(admin)') ||
      text.toLowerCase().includes('andrew only') ||
      text.toLowerCase().includes('waiting on andrew');

    let priority: 'high' | 'medium' | 'low' | undefined;
    if (text.toLowerCase().includes('high priority') || text.toLowerCase().includes('(top priority)') || text.toLowerCase().includes('critical') || text.includes('[P1]')) {
      priority = 'high';
    } else if (text.includes('📅') || text.includes('deadline') || text.toLowerCase().includes('medium priority') || text.includes('[P2]')) {
      priority = 'medium';
    }

    const dueDateMatch = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    const dueDate = dueDateMatch ? dueDateMatch[1] : undefined;

    const firstLink = extractWikiLinks(text)[0];
    const linkedProject = firstLink?.target;

    tasks.push({
      id: `${sourcePath}-${index++}`,
      text: cleanInlineMarkdown(text),
      completed,
      priority,
      needsAndrew,
      source,
      sourcePath,
      dueDate,
      linkedProject,
      instructions: deriveTaskInstructions(text),
      lastUpdated,
      boardSection: completed ? 'done' : 'queue',
    });
  }

  return tasks;
}

function parsePortfolio(filePath: string): Portfolio | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, '.md');
    const name = fileName.replace(' - Portfolio', '');

    if (name === 'Templates') return null;

    const visionMatch = content.match(/## Vision\s*\n\n([^\n]+)/);
    const vision = visionMatch ? visionMatch[1] : '';

    const healthMatch = content.match(/Health\s*\|\s*([^\|]+)/);
    const health = healthMatch ? parseHealth(healthMatch[1]) : 'green';

    const reviewMatch = content.match(/Last Review\s*\|\s*(\d{4}-\d{2}-\d{2})/);
    const lastReview = reviewMatch ? reviewMatch[1] : undefined;

    const projectCountMatch = content.match(/Active Projects\s*\|\s*(\d+)/);
    const activeProjectCount = projectCountMatch ? parseInt(projectCountMatch[1]) : 0;

    const programs: Program[] = [];
    const programTableMatch = content.match(/## Programs[\s\S]*?\|[\s\S]*?\|[\s\S]*?\n([\s\S]*?)(?=\n##|---|\n\n\n)/);
    if (programTableMatch) {
      const rows = programTableMatch[1].split('\n').filter(row => row.includes('[['));
      rows.forEach((row, idx) => {
        const cols = row.split('|').map(c => c.trim());
        if (cols.length >= 2) {
          const programName = cols[1]?.replace(/\[\[|\]\]/g, '') || '';
          const status = parseStatus(cols[2] || '');
          programs.push({
            id: `${name}-program-${idx}`,
            name: programName,
            status: status as 'active' | 'blocked' | 'completed',
            projects: [],
            portfolio: name,
            target: cols[4]?.trim()
          });
        }
      });
    }

    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      vision,
      health,
      programs,
      projects: [],
      activeProjectCount,
      blockedCount: 0,
      lastReview
    };
  } catch (error) {
    console.error(`Error parsing portfolio ${filePath}:`, error);
    return null;
  }
}

function parseProject(filePath: string): Project | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, '.md');
    const name = fileName.replace(' - Project Board', '').replace(' — Project Board', '');

    if (name === 'Templates') return null;

    // Extract status from body
    const statusMatch = content.match(/\*\*Status:\*\*\s*([^\n]+)/);
    const status = statusMatch ? parseStatus(statusMatch[1]) : 'active';

    // Extract owner
    const ownerMatch = content.match(/\*\*Owner:\*\*\s*([^\n]+)/);
    const owner = ownerMatch ? ownerMatch[1].trim() : 'Unassigned';

    // Extract program from body OR frontmatter
    let program: string | undefined;
    const programMatch = content.match(/\*\*Program:\*\*\s*\[\[([^\]]+)\]\]/);
    if (programMatch) {
      program = programMatch[1];
    } else {
      const fmProgramMatch = content.match(/^program:\s*"?([^"\n]+)"?\s*$/m);
      if (fmProgramMatch && fmProgramMatch[1].trim()) {
        program = fmProgramMatch[1].trim().replace(/\[\[|\]\]/g, '');
      }
    }

    // Extract portfolio from body OR frontmatter
    let portfolio: string | undefined;
    const portfolioMatch = content.match(/\*\*Portfolio:\*\*\s*\[\[([^\]]+)\]\]/);
    if (portfolioMatch) {
      portfolio = portfolioMatch[1].replace(' - Portfolio', '');
    } else {
      const fmPortfolioMatch = content.match(/^portfolio:\s*"?([^"\n]+)"?\s*$/m);
      if (fmPortfolioMatch && fmPortfolioMatch[1].trim()) {
        portfolio = fmPortfolioMatch[1].trim().replace(/\[\[|\]\]/g, '').replace(' - Portfolio', '');
      }
    }

    // Use section-aware task extraction
    const tasks = extractTasksSectionAware(content, name, filePath, portfolio, program);

    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      status: status as 'active' | 'blocked' | 'completed' | 'paused',
      owner,
      program,
      portfolio,
      tasks,
      path: filePath
    };
  } catch (error) {
    console.error(`Error parsing project ${filePath}:`, error);
    return null;
  }
}

function parseTasksMd(): { jarvisStatus: JarvisStatus; tasks: Task[] } {
  const tasksPath = path.join(VAULT_PATH, 'Tasks.md');
  const needsAndrew: Task[] = [];
  const inProgress: Task[] = [];
  const alternates: Task[] = [];
  let nextBestAction: Task | undefined;
  const collectedTasks: Task[] = [];

  try {
    const content = fs.readFileSync(tasksPath, 'utf-8');

    let lastUpdated: string;
    try {
      const stats = fs.statSync(tasksPath);
      lastUpdated = stats.mtime.toISOString();
    } catch {
      lastUpdated = new Date().toISOString();
    }

    // Extract JARVIS-STATUS section (legacy, may not exist)
    const jarvisSection = content.match(/<!-- JARVIS-STATUS:START -->([\s\S]*?)<!-- JARVIS-STATUS:END -->/);

    if (jarvisSection) {
      const statusContent = jarvisSection[1];

      const nextItems = parseStatusListItems(statusContent, /^###\s+Next best action/i);
      if (nextItems.length > 0) {
        const nextItem = nextItems[0];
        const firstLink = extractWikiLinks(nextItem.line)[0];

        nextBestAction = {
          id: 'next-best-action',
          text: cleanInlineMarkdown(nextItem.line).replace(/^(HIGH PRIORITY:?)\s*/i, ''),
          completed: false,
          priority: 'high',
          needsAndrew: true,
          source: 'JARVIS Status',
          sourcePath: tasksPath,
          linkedProject: firstLink?.target,
          instructions: buildStatusTaskInstructions(nextItem.line, nextItem.detailLines),
          boardSection: 'needs-you',
        };
      }

      const alternateItems = parseStatusListItems(statusContent, /^###\s+Alternates/i);
      alternateItems.forEach((item, idx) => {
        const firstLink = extractWikiLinks(item.line)[0];
        alternates.push({
          id: `alternate-${idx}`,
          text: cleanInlineMarkdown(item.line),
          completed: false,
          needsAndrew: true,
          source: 'JARVIS Status - Alternates',
          sourcePath: tasksPath,
          linkedProject: firstLink?.target,
          instructions: buildStatusTaskInstructions(item.line, item.detailLines),
          boardSection: 'queue',
        });
      });

      const needsAndrewItems = parseStatusListItems(statusContent, /^###\s+Needs Andrew/i);
      needsAndrewItems.forEach((item, idx) => {
        const normalizedText = cleanInlineMarkdown(item.line);
        const isHighPriority = normalizedText.toLowerCase().includes('high priority');
        const firstLink = extractWikiLinks(item.line)[0];

        needsAndrew.push({
          id: `needs-andrew-${idx}`,
          text: normalizedText.replace(/^(HIGH PRIORITY:?)\s*/i, ''),
          completed: false,
          priority: isHighPriority ? 'high' : undefined,
          needsAndrew: true,
          source: 'JARVIS Status',
          sourcePath: tasksPath,
          linkedProject: firstLink?.target,
          instructions: buildStatusTaskInstructions(item.line, item.detailLines),
          boardSection: 'needs-you',
        });
      });

      const inProgressItems = parseStatusListItems(statusContent, /^###\s+In progress \(Jarvis\)/i);
      inProgressItems.forEach((item, idx) => {
        const firstLink = extractWikiLinks(item.line)[0];

        inProgress.push({
          id: `in-progress-${idx}`,
          text: cleanInlineMarkdown(item.line),
          completed: false,
          needsAndrew: false,
          source: 'JARVIS In Progress',
          sourcePath: tasksPath,
          linkedProject: firstLink?.target,
          boardSection: 'queue',
        });
      });
    }

    // Also extract from "In Progress (Jarvis)" section and "Active" section
    const inProgressSection = content.match(/## In Progress \(Jarvis\)([\s\S]*?)(?=\n## |$)/);
    if (inProgressSection) {
      const sectionTasks = extractTasks(inProgressSection[1], 'Tasks.md — In Progress', tasksPath);
      sectionTasks.forEach((t) => {
        t.boardSection = t.completed ? 'done' : 'queue';
        collectedTasks.push(t);
      });
    }

    const activeMatch = content.match(/## Active([\s\S]*?)(?=\n## |$)/);
    if (activeMatch) {
      const activeTasks = extractTasks(activeMatch[1], 'Tasks.md — Active', tasksPath);
      activeTasks.forEach(task => {
        task.boardSection = task.completed ? 'done' : (task.needsAndrew ? 'needs-you' : 'queue');
        if (!task.completed && task.needsAndrew && !needsAndrew.find(t => t.text === task.text)) {
          needsAndrew.push(task);
        }
        collectedTasks.push(task);
      });
    }

  } catch (error) {
    console.error('Error parsing Tasks.md:', error);
  }

  // Include jarvisStatus tasks in collectedTasks for unified feed
  if (nextBestAction) collectedTasks.push(nextBestAction);
  collectedTasks.push(...needsAndrew);
  collectedTasks.push(...inProgress);
  collectedTasks.push(...alternates);

  return {
    jarvisStatus: { needsAndrew, inProgress, nextBestAction, alternates },
    tasks: collectedTasks,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const notesPath = path.join(VAULT_PATH, 'Notes');
  const diagnostics: ParseDiagnostics = {
    portfolioFilesFound: 0,
    projectBoardFilesFound: 0,
    totalTasksExtracted: 0,
    tasksFromTasksMd: 0,
    emptyProjects: [],
    errors: [],
    availablePortfolios: [],
    projectsByPortfolio: {},
  };

  // Find and parse portfolios
  let portfolioFiles: string[] = [];
  try {
    portfolioFiles = fs.readdirSync(notesPath)
      .filter(f => f.includes('Portfolio') && f.endsWith('.md') && !f.includes('Templates'));
  } catch (err) {
    diagnostics.errors.push(`Failed to read notes directory: ${err}`);
  }
  diagnostics.portfolioFilesFound = portfolioFiles.length;

  const portfolios: Portfolio[] = [];
  for (const file of portfolioFiles) {
    const portfolio = parsePortfolio(path.join(notesPath, file));
    if (portfolio) {
      portfolios.push(portfolio);
      diagnostics.availablePortfolios.push(portfolio.name);
    }
  }

  // Find and parse projects
  let projectFiles: string[] = [];
  try {
    projectFiles = fs.readdirSync(notesPath)
      .filter(f => (f.includes('Project Board') || f.includes('Project Board')) && f.endsWith('.md') && !f.includes('Templates'));
  } catch (err) {
    diagnostics.errors.push(`Failed to read project board files: ${err}`);
  }
  diagnostics.projectBoardFilesFound = projectFiles.length;

  const allProjects: Project[] = [];
  for (const file of projectFiles) {
    const project = parseProject(path.join(notesPath, file));
    if (project) {
      allProjects.push(project);
      if (project.tasks.length === 0) {
        diagnostics.emptyProjects.push(project.name);
      }
      // Build portfolio → projects index
      const pKey = project.portfolio || '(No Portfolio)';
      if (!diagnostics.projectsByPortfolio[pKey]) {
        diagnostics.projectsByPortfolio[pKey] = [];
      }
      diagnostics.projectsByPortfolio[pKey].push(project.name);
    }
  }

  // Associate projects with portfolios
  portfolios.forEach(portfolio => {
    const portfolioProjects = allProjects.filter(p => p.portfolio === portfolio.name);
    portfolio.projects = portfolioProjects;
    portfolio.activeProjectCount = portfolioProjects.filter(p => p.status === 'active').length;
    portfolio.blockedCount = portfolioProjects.filter(p => p.status === 'blocked').length;
  });

  // Collect all tasks from projects
  const allTasks: Task[] = [];
  allProjects.forEach(project => {
    allTasks.push(...project.tasks);
  });

  // Parse Tasks.md and merge those tasks too
  const { jarvisStatus, tasks: tasksMdTasks } = parseTasksMd();
  diagnostics.tasksFromTasksMd = tasksMdTasks.length;

  // Add Tasks.md tasks to allTasks (dedupe by text)
  const existingTexts = new Set(allTasks.map(t => t.text.toLowerCase()));
  tasksMdTasks.forEach(t => {
    if (!existingTexts.has(t.text.toLowerCase())) {
      allTasks.push(t);
      existingTexts.add(t.text.toLowerCase());
    }
  });

  diagnostics.totalTasksExtracted = allTasks.length;

  return {
    portfolios,
    jarvisStatus,
    allTasks,
    lastUpdated: new Date().toISOString(),
    diagnostics,
  };
}
