// The cleaner is a standalone, single-threaded CLI. Filesystem calls consuming at()
// are synchronous. On POSIX their single-component names resolve from the kernel cwd.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import koffi from 'koffi';

function posixDirectoryOpener() {
  const fchdir = koffi.load(null).func('int fchdir(int fd)');
  return (location) => {
    const fd = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    return {
      stat: () => fs.fstatSync(fd, { bigint: true }),
      at(name) {
        assert.equal(fchdir(fd), 0, 'cannot enter held directory');
        return name;
      },
      [Symbol.dispose]: () => fs.closeSync(fd),
    };
  };
}

function windowsDirectoryOpener() {
  const kernel = koffi.load('kernel32.dll');
  const open = kernel.func('intptr_t __stdcall CreateFileW(str16, uint32_t, uint32_t, void *, uint32_t, uint32_t, intptr_t)');
  const attributes = kernel.func('int __stdcall GetFileInformationByHandleEx(intptr_t, int, _Out_ void *, uint32_t)');
  const close = kernel.func('int __stdcall CloseHandle(intptr_t)');
  const lastError = kernel.func('uint32_t __stdcall GetLastError()');
  return (location) => {
    // FILE_READ_ATTRIBUTES, FILE_SHARE_READ, OPEN_EXISTING, BACKUP_SEMANTICS | OPEN_REPARSE_POINT.
    // Keep each ancestor open without write/delete sharing while operating on its children.
    const handle = open(path.toNamespacedPath(location), 0x80, 1, null, 3, 0x02200000, 0);
    assert.notEqual(handle, -1, `cannot pin ${location} (Win32 ${lastError()})`);
    return {
      stat() {
        const tag = Buffer.alloc(8); // FILE_ATTRIBUTE_TAG_INFO
        assert.ok(attributes(handle, 9, tag, tag.length), `cannot inspect ${location} (Win32 ${lastError()})`);
        assert.equal(tag.readUInt32LE() & 0x400, 0, `refusing reparse point: ${location}`);
        return fs.lstatSync(location, { bigint: true });
      },
      at: (name) => path.join(location, name),
      [Symbol.dispose]: () => close(handle),
    };
  };
}

const pin = process.platform === 'win32' ? windowsDirectoryOpener() : posixDirectoryOpener();

export function assertIdentity(expected, actual) {
  assert.equal(actual.dev, expected.dev, 'directory changed during cleanup');
  assert.equal(actual.ino, expected.ino, 'directory changed during cleanup');
}

export function openDirectory(location, expected) {
  assert.ok(expected.isDirectory(), `expected an ordinary directory at ${location}`);
  const held = pin(location);
  try {
    assertIdentity(expected, held.stat());
    return held;
  } catch (error) {
    held[Symbol.dispose]();
    throw error;
  }
}
