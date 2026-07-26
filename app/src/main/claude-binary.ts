import * as path from 'path';

// The agent SDK ships its `claude` CLI as a platform-specific sibling package
// and resolves it relative to its own module path. Inside a packaged app that
// resolution runs through app.asar — a file, not a directory — so spawning it
// fails with ENOTDIR. Electron redirects file *reads* into app.asar.unpacked,
// but not the executable handed to child_process.spawn, so the binary being
// unpacked is not enough: the SDK has to be pointed at the unpacked copy.
export function unpackedClaudeBinaryPath(resourcesPath: string, platform: string, arch: string): string {
  const pkg = `claude-agent-sdk-${platform}-${arch}`;
  const binary = platform === 'win32' ? 'claude.exe' : 'claude';
  return path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', pkg, binary);
}
