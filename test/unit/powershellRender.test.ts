// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { renderPowerShell } from '../../src/webview/powershell';
import type { PowerShellInventory } from '../../src/powershell/profiles';
const inventory: PowerShellInventory = {
  editions:[{edition:'PowerShell 7',userDirectory:'/user',installations:[]}],
  rows:[{id:'row',edition:'PowerShell 7',scope:'Current User',host:'Console',path:'/user/profile.ps1',state:'existing',readOnly:false}],
};
beforeEach(()=>{document.body.innerHTML='<div id="powershell"></div><button id="outside">Outside</button>';});
it('keeps an open row menu and its focused action across automatic refresh',()=>{
  renderPowerShell(inventory,()=>{});
  document.querySelector('details')!.open=true;
  const copy=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Copy Path')!;
  copy.focus();
  renderPowerShell(inventory,()=>{});
  expect(document.querySelector('details')!.open).toBe(true);
  expect(document.activeElement?.textContent).toBe('Copy Path');
});
it('keeps Refresh focused but never steals focus from outside the section',()=>{
  renderPowerShell(inventory,()=>{});
  document.querySelector('button')!.focus();
  renderPowerShell(inventory,()=>{});
  expect(document.activeElement?.textContent).toBe('Refresh');
  document.getElementById('outside')!.focus();
  renderPowerShell(inventory,()=>{});
  expect(document.activeElement?.id).toBe('outside');
});
