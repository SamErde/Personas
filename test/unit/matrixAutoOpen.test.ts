import { expect, it } from 'vitest';
import { opensMatrixWithSidebar } from '../../src/panel/matrixAutoOpen';

it('opens the Extension Matrix with the sidebar unless the user turned that off', () => {
  expect(opensMatrixWithSidebar(undefined, undefined)).toBe(true);
  expect(opensMatrixWithSidebar({ defaultValue: true }, { defaultValue: true })).toBe(true);
  expect(opensMatrixWithSidebar({ globalValue: false }, undefined)).toBe(false);
});

it('honors the setting under its old name when the new one is not set', () => {
  expect(opensMatrixWithSidebar({ defaultValue: true }, { globalValue: false })).toBe(false);
});

it('prefers the new name over the old one', () => {
  expect(opensMatrixWithSidebar({ globalValue: true }, { globalValue: false })).toBe(true);
});

it('lets a workspace value override the user value', () => {
  expect(opensMatrixWithSidebar({ globalValue: true, workspaceValue: false }, undefined)).toBe(false);
  expect(opensMatrixWithSidebar({ workspaceValue: false, workspaceFolderValue: true }, undefined)).toBe(true);
});
