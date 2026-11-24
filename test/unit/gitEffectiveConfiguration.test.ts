import { expect, it } from 'vitest';
import type { GitConfigSnapshot } from '../../src/git/configService';
import { renderEffectiveConfiguration } from '../../src/git/effectiveConfiguration';

const snapshot: GitConfigSnapshot = {
  kind: 'ok',
  repository: { name: 'repo', root: '/code/repo', gitDir: '/code/repo/.git' },
  identity: [],
  files: [],
  entries: [
    { key: 'user.name', value: 'Base', scope: 'global', origin: 'file:/home/me/.gitconfig', file: '/home/me/.gitconfig' },
    { key: 'remote.origin.fetch', value: '+refs/heads/*:refs/remotes/origin/*', scope: 'local', origin: 'file:.git/config', file: '/code/repo/.git/config' },
    { key: 'user.name', value: 'Local', scope: 'local', origin: 'file:.git/config', file: '/code/repo/.git/config' },
    { key: 'alias.note', value: 'first\nsecond', scope: 'command', origin: 'command line:' },
    { key: 'core.implicit', value: undefined, scope: 'local', origin: 'file:.git/config', file: '/code/repo/.git/config' },
    { key: 'core.explicit', value: '', scope: 'local', origin: 'file:.git/config', file: '/code/repo/.git/config' },
  ],
};

it('groups every value by key in Git\'s own order, each with its scope and source', () => {
  expect(renderEffectiveConfiguration(snapshot)).toBe(
    [
      '# Effective Git configuration',
      '# Repository: /code/repo',
      '# Values are listed in the order Git reads them. For a single-valued key, the last value wins.',
      '',
      'user.name',
      '    Base',
      '        global  /home/me/.gitconfig',
      '    Local',
      '        local  /code/repo/.git/config',
      '',
      'remote.origin.fetch',
      '    +refs/heads/*:refs/remotes/origin/*',
      '        local  /code/repo/.git/config',
      '',
      'alias.note',
      '    first',
      '    second',
      '        command  command line:',
      '',
      // Git reads the first as true and the second as false, so they must not look alike.
      'core.implicit',
      '    (no value: Git reads this as true)',
      '        local  /code/repo/.git/config',
      '',
      'core.explicit',
      '    (empty)',
      '        local  /code/repo/.git/config',
      '',
    ].join('\n'),
  );
});

it('states when there is no repository, so only system and global values are shown', () => {
  const { repository: _repository, ...withoutRepository } = snapshot;
  const text = renderEffectiveConfiguration({ ...withoutRepository, entries: snapshot.entries.slice(0, 1) });
  expect(text.split('\n')[1]).toBe('# Repository: none open. Showing system and global configuration only.');
});
