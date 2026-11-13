import { expect, it } from 'vitest';
import { registryExportPersonal } from '../../src/powershell/registry';
const key='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
function exported(value:string):Buffer {return Buffer.from('\uFEFFWindows Registry Editor Version 5.00\r\n['+key+']\r\n"Personal"='+value+'\r\n','utf16le');}
it('decodes Unicode Documents paths without using the console code page',()=>{
  expect(registryExportPersonal(exported('"D:\\\\文档\\\\José"'),key,{})).toBe('D:\\文档\\José');
});
it('decodes REG_EXPAND_SZ Unicode hex and expands the environment',()=>{
  const encoded=Buffer.from('%OneDrive%\\文档\0','utf16le').toString('hex').match(/../g)!.join(',');
  expect(registryExportPersonal(exported('hex(2):'+encoded),key,{OneDrive:'D:\\李'})).toBe('D:\\李\\文档');
});
it('refuses legacy exports, malformed UTF-16 and unresolved variables',()=>{
  expect(registryExportPersonal(Buffer.from('REGEDIT4\r\n"Personal"="D:\\\\Jose"'),key,{})).toBeUndefined();
  expect(registryExportPersonal(Buffer.from([0xff,0xfe,0x00]),key,{})).toBeUndefined();
  const encoded=Buffer.from('%Missing%\\Documents\0','utf16le').toString('hex').match(/../g)!.join(',');
  expect(registryExportPersonal(exported('hex(2):'+encoded),key,{})).toBeUndefined();
});
