import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** Home's layout and title bars come from package.json, so these tests read the manifest itself. */
const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const homeViews = ['personas.vscodeProfiles', 'personas.powerShellProfiles', 'personas.gitConfiguration'];
type MenuItem = { command: string; when: string; group?: string };
const titleItems: MenuItem[] = manifest.contributes.menus['view/title'];
const itemsFor = (view: string) => titleItems.filter((item) => item.when.split('||').some((part) => part.trim() === `view == ${view}`));

it('splits Home 5 / 3 / 2 the first time a workspace shows it', () => {
  const sizes = Object.fromEntries(
    manifest.contributes.views.personas.map((view: { id: string; initialSize?: number }) => [view.id, view.initialSize]),
  );
  expect(sizes).toEqual({
    'personas.vscodeProfiles': 5,
    'personas.powerShellProfiles': 3,
    'personas.gitConfiguration': 2,
  });
});

it('shows Open Personas Settings as a gear at the end of every Home title bar', () => {
  const command = manifest.contributes.commands.find((c: { command: string }) => c.command === 'personas.openSettings');
  expect(command.icon).toBe('$(settings-gear)');
  for (const view of homeViews) {
    const items = itemsFor(view);
    expect(items.map((item) => item.command)).toContain('personas.openSettings');
    const order = (item: MenuItem) => Number(item.group!.split('@')[1]);
    const settings = items.find((item) => item.command === 'personas.openSettings')!;
    expect(settings.group).toBe('navigation@9');
    expect(Math.max(...items.map(order))).toBe(order(settings));
  }
});

it('puts every Home title action in the title bar itself, so no "..." menu appears', () => {
  for (const view of homeViews) {
    for (const item of itemsFor(view)) expect(item.group).toMatch(/^navigation(@\d+)?$/);
  }
});

it('keeps the existing title actions in their order', () => {
  const group = (command: string) => titleItems.find((item) => item.command === command)?.group;
  expect(group('personas.powerShellProfiles.refresh')).toBe('navigation@1');
  expect(group('personas.powerShellProfiles.help')).toBe('navigation@2');
  expect(group('personas.gitConfiguration.showEffective')).toBe('navigation@1');
  expect(group('personas.gitConfiguration.refresh')).toBe('navigation@2');
});
