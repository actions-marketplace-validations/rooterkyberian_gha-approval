// These protections cannot be removed through the configurable path lists.
export const protectedGlobs = [
  '.github/copilot-instructions.md',
  '.github/instructions/**',
  '.github/agents/**',
  '.github/skills/**',
  '.github/prompts/**',
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/GEMINI.md',
];

// Deliberately small glob syntax: *, **, ?, and **/ (zero or more directories).
// Matching is case insensitive to protect instruction files consistently.
export function compileGlob(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.startsWith('/') ||
      pattern.includes('\\') || pattern.split('/').includes('..') || /[\[\]{}!]/.test(pattern)) {
    throw new Error(`Invalid glob: ${pattern}. Use relative paths with *, **, or ?.`);
  }
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { source += '(?:.*/)?'; i++; }
      else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`, 'i');
}

export function evaluatePolicy(pr, files, {
  maxChangedLines = 1000, lineCountExclude = [], allowlist = [], denylist = [],
} = {}) {
  if (!Number.isSafeInteger(maxChangedLines) || maxChangedLines < 0) {
    throw new Error('maxChangedLines must be a nonnegative safe integer; 0 disables the limit.');
  }
  const exclude = lineCountExclude.map(compileGlob);
  const allow = allowlist.map(compileGlob);
  const deny = [...protectedGlobs, ...denylist].map(compileGlob);
  const reasons = [];
  if (pr.state !== 'open') reasons.push('Pull request is not open.');
  if (pr.draft !== false) reasons.push('Pull request is draft or draft status is unknown.');
  if (maxChangedLines > 0) {
    // Aggregate counts preserve existing behavior unless file exclusions are used.
    const countedFiles = exclude.length ? files.filter(file => {
      const paths = [file.filename, file.previous_filename].filter(Boolean);
      // Renaming source into an excluded file must not bypass the size gate.
      return !paths.length || !paths.every(path => exclude.some(pattern => pattern.test(path)));
    }) : [pr];
    if (countedFiles.some(file => !Number.isSafeInteger(file.additions) || file.additions < 0 ||
        !Number.isSafeInteger(file.deletions) || file.deletions < 0)) {
      reasons.push('Changed line counts are unavailable.');
    } else {
      const changedLines = countedFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0);
      if (!Number.isSafeInteger(changedLines)) reasons.push('Changed line counts exceed the supported range.');
      else if (changedLines >= maxChangedLines) reasons.push(`Changed lines (${changedLines}) must be less than ${maxChangedLines}.`);
    }
  }
  if (!Number.isSafeInteger(pr.changed_files) || files.length !== pr.changed_files || files.length === 0) {
    reasons.push('Complete nonempty changed file list is required.');
  }
  for (const file of files) {
    if (typeof file.filename !== 'string' || !file.filename ||
        (file.status === 'renamed' && !file.previous_filename)) {
      reasons.push('A changed file has incomplete path metadata.');
      continue;
    }
    // Both ends of a rename must pass; deleting or renaming instructions is blocked.
    for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
      if (deny.some(pattern => pattern.test(path))) reasons.push(`Blocked path: ${path}`);
      if (allow.length && !allow.some(pattern => pattern.test(path))) reasons.push(`Path is outside allowlist: ${path}`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
