import fs from 'fs';
import path from 'path';

const VAULT_PATH = '/Users/andrew/Documents/Vault v3';

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

export interface DashboardData {
  portfolios: Portfolio[];
  jarvisStatus: JarvisStatus;
  allTasks: Task[];
  lastUpdated: string;
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
  // Default to active for variations like "active", "on track", "in progress"
  return 'active';
}

function parseHealth(text: string): 'green' | 'yellow' | 'red' {
  if (text.toLowerCase().includes('blocked') || text.toLowerCase().includes('red')) {
    return 'red';
  }
  if (text.toLowerCase().includes('attention') || text.toLowerCase().includes('early stage') || text.toLowerCase().includes('yellow')) {
    return 'yellow';
  }
  // Default to green for variations like "on track", "active", "green"
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

function extractTasks(content: string, source: string, sourcePath: string): Task[] {
  const tasks: Task[] = [];
  const taskRegex = /^- \[([ x])\] (.+)$/gm;
  let match;
  let index = 0;

  // Get file modification time for lastUpdated
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
    
    // Check for "needs andrew" indicators
    const needsAndrew = 
      text.toLowerCase().includes('needs andrew') ||
      text.toLowerCase().includes('(admin)') ||
      text.toLowerCase().includes('andrew only') ||
      text.toLowerCase().includes('waiting on andrew');
    
    // Check for priority indicators
    let priority: 'high' | 'medium' | 'low' | undefined;
    if (text.toLowerCase().includes('high priority') || text.toLowerCase().includes('(top priority)') || text.toLowerCase().includes('critical')) {
      priority = 'high';
    } else if (text.includes('📅') || text.includes('deadline') || text.toLowerCase().includes('medium priority')) {
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
    });
  }
  
  return tasks;
}

function parsePortfolio(filePath: string): Portfolio | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, '.md');
    const name = fileName.replace(' - Portfolio', '');
    
    // Skip template
    if (name === 'Templates') return null;
    
    // Extract vision
    const visionMatch = content.match(/## Vision\s*\n\n([^\n]+)/);
    const vision = visionMatch ? visionMatch[1] : '';
    
    // Extract health from status table
    const healthMatch = content.match(/Health\s*\|\s*([^\|]+)/);
    const health = healthMatch ? parseHealth(healthMatch[1]) : 'green';
    
    // Extract last review
    const reviewMatch = content.match(/Last Review\s*\|\s*(\d{4}-\d{2}-\d{2})/);
    const lastReview = reviewMatch ? reviewMatch[1] : undefined;
    
    // Extract active project count
    const projectCountMatch = content.match(/Active Projects\s*\|\s*(\d+)/);
    const activeProjectCount = projectCountMatch ? parseInt(projectCountMatch[1]) : 0;
    
    // Extract programs from table
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
    const name = fileName.replace(' - Project Board', '');
    
    // Skip template
    if (name === 'Templates') return null;
    
    // Extract status
    const statusMatch = content.match(/\*\*Status:\*\*\s*([^\n]+)/);
    const status = statusMatch ? parseStatus(statusMatch[1]) : 'active';
    
    // Extract owner
    const ownerMatch = content.match(/\*\*Owner:\*\*\s*([^\n]+)/);
    const owner = ownerMatch ? ownerMatch[1].trim() : 'Unassigned';
    
    // Extract program
    const programMatch = content.match(/\*\*Program:\*\*\s*\[\[([^\]]+)\]\]/);
    const program = programMatch ? programMatch[1] : undefined;
    
    // Extract portfolio
    const portfolioMatch = content.match(/\*\*Portfolio:\*\*\s*\[\[([^\]]+)\]\]/);
    const portfolio = portfolioMatch ? portfolioMatch[1].replace(' - Portfolio', '') : undefined;
    
    // Extract tasks
    const tasks = extractTasks(content, name, filePath);
    
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

function parseTasksMd(): JarvisStatus {
  const tasksPath = path.join(VAULT_PATH, 'Tasks.md');
  const needsAndrew: Task[] = [];
  const inProgress: Task[] = [];
  const alternates: Task[] = [];
  let nextBestAction: Task | undefined;
  
  try {
    const content = fs.readFileSync(tasksPath, 'utf-8');
    
    // Extract JARVIS-STATUS section
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
        });
      });
    }
    
    // Also extract from Active section
    const activeMatch = content.match(/## Active[\s\S]*?(?=## Waiting|## Next|$)/);
    if (activeMatch) {
      const activeTasks = extractTasks(activeMatch[0], 'Active Tasks', tasksPath);
      activeTasks.forEach(task => {
        if (!task.completed && task.needsAndrew && !needsAndrew.find(t => t.text === task.text)) {
          needsAndrew.push(task);
        }
      });
    }
    
  } catch (error) {
    console.error('Error parsing Tasks.md:', error);
  }
  
  return { needsAndrew, inProgress, nextBestAction, alternates };
}

export async function getDashboardData(): Promise<DashboardData> {
  const notesPath = path.join(VAULT_PATH, 'Notes');
  
  // Find and parse portfolios
  const portfolioFiles = fs.readdirSync(notesPath)
    .filter(f => f.includes('Portfolio') && f.endsWith('.md') && !f.includes('Templates'));
  
  const portfolios: Portfolio[] = [];
  for (const file of portfolioFiles) {
    const portfolio = parsePortfolio(path.join(notesPath, file));
    if (portfolio) portfolios.push(portfolio);
  }
  
  // Find and parse projects
  const projectFiles = fs.readdirSync(notesPath)
    .filter(f => f.includes('Project Board') && f.endsWith('.md') && !f.includes('Templates'));
  
  const allProjects: Project[] = [];
  for (const file of projectFiles) {
    const project = parseProject(path.join(notesPath, file));
    if (project) allProjects.push(project);
  }
  
  // Associate projects with portfolios
  portfolios.forEach(portfolio => {
    const portfolioProjects = allProjects.filter(p => p.portfolio === portfolio.name);
    portfolio.projects = portfolioProjects;
    portfolio.activeProjectCount = portfolioProjects.filter(p => p.status === 'active').length;
    portfolio.blockedCount = portfolioProjects.filter(p => p.status === 'blocked').length;
  });
  
  // Collect all tasks
  const allTasks: Task[] = [];
  allProjects.forEach(project => {
    allTasks.push(...project.tasks);
  });
  
  // Parse JARVIS status
  const jarvisStatus = parseTasksMd();
  
  return {
    portfolios,
    jarvisStatus,
    allTasks,
    lastUpdated: new Date().toISOString()
  };
}
