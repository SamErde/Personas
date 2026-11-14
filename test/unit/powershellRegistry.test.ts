import { expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { registryExportPersonal, readRegistryDocuments } from '../../src/powershell/registry';
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

it.each([
  ['D:\\Documents\\','D:\\Documents'],
  ['C:\\','c:\\'],
  ['\\\\server\\share\\','\\\\server\\share'],
])('accepts equivalent exported directory spellings: %s and %s',async(configured,effective)=>{
  let count=0;
  const result=await readRegistryDocuments('reg.exe',async(_exe,args)=>{
    const value=count++===0?configured:effective;
    const quoted='"'+value.replaceAll('\\','\\\\')+'"';
    const bytes=Buffer.from('\uFEFFWindows Registry Editor Version 5.00\r\n['+args[1]+']\r\n"Personal"='+quoted+'\r\n','utf16le');
    await fs.writeFile(args[2]!,bytes,{flag:'wx'});
    return '';
  },{});
  expect(result).toBe(effective);
});
