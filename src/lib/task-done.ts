import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = '/Users/andrew/Documents/Vault v3';
const TASKS_PATH = path.join(VAULT_PATH, 'Tasks.md');

const CHECKBOX_LINE_REGEX = /^(\s*-\s*\[)([ xX])(\]\s+)(.+)$/;
const STATUS_BULLET_REGEX = /^\s*-\s+(?!\[)(.+)$/;

interface CheckboxMatch {
  index: number;
  checked: boolean;
}

export interface MarkTaskDoneInput {
  text: string;
  sourcePath?: string;
}

export interface MarkTaskDoneResult {
  sourcePath: string;
  updated: boolean;
  alreadyDone: boolean;
  updatedCheckbox: boolean;
  removedFromStatus: number;
}

function normalizeForMatch(value: string): string {
  return value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^(high priority:?|🔴\s*high priority\s*[—-]?)\s*/i, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[.;]+$/, '')
    .trim()
    .toLowerCase();
}

function isMatch(candidate: string, target: string): boolean {
  if (!candidate || !target) return false;
  if (candidate === target) return true;

  if (target.length >= 28 && candidate.includes(target)) return true;
  if (candidate.length >= 28 && target.includes(candidate)) return true;

  return false;
}

function findCheckboxLine(lines: string[], targetNormalized: string): CheckboxMatch | null {
  let fuzzyUnchecked: CheckboxMatch | null = null;
  let fuzzyChecked: CheckboxMatch | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(CHECKBOX_LINE_REGEX);
    if (!match) continue;

    const lineText = normalizeForMatch(match[4]);
    const checked = match[2].toLowerCase() === 'x';

    if (lineText === targetNormalized) {
      return { index, checked };
    }

    if (isMatch(lineText, targetNormalized)) {
      if (checked && !fuzzyChecked) {
        fuzzyChecked = { index, checked: true };
      }

      if (!checked && !fuzzyUnchecked) {
        fuzzyUnchecked = { index, checked: false };
      }
    }
  }

  return fuzzyUnchecked ?? fuzzyChecked;
}

function removeFromJarvisStatus(lines: string[], targetNormalized: string): { lines: string[]; removed: number } {
  const startIndex = lines.findIndex((line) => line.includes('<!-- JARVIS-STATUS:START -->'));
  if (startIndex === -1) {
    return { lines, removed: 0 };
  }

  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.includes('<!-- JARVIS-STATUS:END -->'));
  if (endIndex === -1) {
    return { lines, removed: 0 };
  }

  const kept: string[] = [...lines.slice(0, startIndex + 1)];
  let removed = 0;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const line = lines[index];
    const bullet = line.match(STATUS_BULLET_REGEX);

    if (!bullet) {
      kept.push(line);
      continue;
    }

    const normalizedBullet = normalizeForMatch(bullet[1]);
    if (!isMatch(normalizedBullet, targetNormalized)) {
      kept.push(line);
      continue;
    }

    removed += 1;

    while (index + 1 < endIndex && /^\s{2,}\S/.test(lines[index + 1])) {
      index += 1;
    }
  }

  kept.push(...lines.slice(endIndex));

  return { lines: kept, removed };
}

function resolveSourcePath(rawPath?: string): string {
  const candidate = rawPath && rawPath.trim().length > 0 ? rawPath.trim() : TASKS_PATH;
  const resolved = path.resolve(candidate);
  const vaultRoot = path.resolve(VAULT_PATH);

  if (!(resolved === vaultRoot || resolved.startsWith(`${vaultRoot}${path.sep}`))) {
    throw new Error('Task source path is outside the vault.');
  }

  if (!resolved.endsWith('.md')) {
    throw new Error('Task source path must be a markdown file.');
  }

  return resolved;
}

export async function markTaskDone(input: MarkTaskDoneInput): Promise<MarkTaskDoneResult> {
  const sourcePath = resolveSourcePath(input.sourcePath);
  const normalizedTarget = normalizeForMatch(input.text);

  if (!normalizedTarget) {
    throw new Error('Task text is required.');
  }

  const content = await fs.readFile(sourcePath, 'utf-8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = content.endsWith('\n');
  const originalLines = content.split(/\r?\n/);

  if (hadTrailingNewline && originalLines[originalLines.length - 1] === '') {
    originalLines.pop();
  }

  const lines = [...originalLines];
  const checkboxMatch = findCheckboxLine(lines, normalizedTarget);

  let updatedCheckbox = false;
  let alreadyDone = false;

  if (checkboxMatch) {
    if (checkboxMatch.checked) {
      alreadyDone = true;
    } else {
      const line = lines[checkboxMatch.index];
      const parsed = line.match(CHECKBOX_LINE_REGEX);
      if (parsed) {
        lines[checkboxMatch.index] = `${parsed[1]}x${parsed[3]}${parsed[4]}`;
        updatedCheckbox = true;
      }
    }
  }

  let removedFromStatus = 0;
  if (sourcePath === TASKS_PATH) {
    const statusResult = removeFromJarvisStatus(lines, normalizedTarget);
    removedFromStatus = statusResult.removed;

    if (removedFromStatus > 0) {
      lines.splice(0, lines.length, ...statusResult.lines);
    }
  }

  const updated = updatedCheckbox || removedFromStatus > 0;

  if (!updated && !alreadyDone) {
    return {
      sourcePath,
      updated: false,
      alreadyDone: false,
      updatedCheckbox: false,
      removedFromStatus: 0,
    };
  }

  if (updated) {
    let nextContent = lines.join(eol);
    if (hadTrailingNewline) {
      nextContent = `${nextContent}${eol}`;
    }

    await fs.writeFile(sourcePath, nextContent, 'utf-8');
  }

  return {
    sourcePath,
    updated,
    alreadyDone,
    updatedCheckbox,
    removedFromStatus,
  };
}
