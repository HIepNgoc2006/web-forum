import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Match a whole line so authoring indent on the marker does not stack
// onto the already-indented partial contents.
const INCLUDE_RE = /^[ \t]*<!--\s*@include\s+([^\s]+?)\s*-->[ \t]*\r?\n?/gm;

/**
 * Build-time / dev-time HTML partial expander for index.html.
 * Expands comments of the form: <!-- @include index-partials/name.html -->
 * Paths resolve relative to the frontend package root (dirname of index.html).
 * No runtime browser code; no external dependencies.
 */
export function htmlPartialsPlugin(): Plugin {
  const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
  const partialsDir = path.join(frontendRoot, 'index-partials');

  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const indexDir = ctx.filename
          ? path.dirname(ctx.filename)
          : frontendRoot;
        return expandIncludes(html, indexDir, new Set());
      },
    },
    configureServer(server) {
      server.watcher.add(partialsDir);
      const reloadIfPartial = (file: string) => {
        const normalized = path.normalize(file);
        if (
          normalized === path.normalize(partialsDir) ||
          normalized.startsWith(path.normalize(partialsDir + path.sep))
        ) {
          server.ws.send({ type: 'full-reload', path: '*' });
        }
      };
      server.watcher.on('change', reloadIfPartial);
      server.watcher.on('add', reloadIfPartial);
      server.watcher.on('unlink', reloadIfPartial);
    },
  };
}

function expandIncludes(
  html: string,
  indexDir: string,
  stack: Set<string>,
): string {
  return html.replace(INCLUDE_RE, (_match, relPath: string) => {
    const cleaned = String(relPath || '').trim().replace(/\\/g, '/');
    if (!cleaned || cleaned.includes('..') || path.isAbsolute(cleaned)) {
      throw new Error(
        `Invalid HTML partial include path: ${JSON.stringify(relPath)}`,
      );
    }

    const resolved = path.resolve(indexDir, cleaned);
    const relativeToRoot = path.relative(path.resolve(indexDir), resolved);
    if (
      relativeToRoot.startsWith('..') ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new Error(
        `HTML partial include escapes frontend root: ${cleaned}`,
      );
    }

    if (stack.has(resolved)) {
      throw new Error(
        `Circular HTML partial include detected: ${cleaned}`,
      );
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(
        `Missing HTML partial: ${cleaned} (resolved: ${resolved})`,
      );
    }

    const content = fs.readFileSync(resolved, 'utf8');
    const nextStack = new Set(stack);
    nextStack.add(resolved);
    // Nested includes resolve relative to the same index.html directory.
    return expandIncludes(content, indexDir, nextStack);
  });
}
