import type { GitConfigEntry, GitConfigSnapshot } from './configService';

/**
 * The text of the Effective Git Configuration document: every value Git lists, grouped by key.
 * Nothing is marked as overridden, because Git's output does not say which keys hold one value
 * and which hold several; the header gives the rule instead.
 */
export function renderEffectiveConfiguration(snapshot: GitConfigSnapshot): string {
  const groups = new Map<string, GitConfigEntry[]>();
  for (const entry of snapshot.entries) {
    const group = groups.get(entry.key);
    if (group) group.push(entry);
    else groups.set(entry.key, [entry]);
  }
  const lines = [
    '# Effective Git configuration',
    snapshot.repository
      ? `# Repository: ${snapshot.repository.root}`
      : '# Repository: none open. Showing system and global configuration only.',
    '# Values are listed in the order Git reads them. For a single-valued key, the last value wins.',
    '',
  ];
  for (const [key, entries] of groups) {
    lines.push(key);
    for (const entry of entries) {
      for (const line of entry.value.split('\n')) lines.push(`    ${line}`);
      lines.push(`        ${entry.scope}  ${entry.file ?? entry.origin}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
