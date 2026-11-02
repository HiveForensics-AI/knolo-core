import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCodeMcpServer } from './server.js';
import {
  codeImageBuild,
  codeImageExpand,
  codeImageQuery,
  codeImageStatus,
  codeImageStructure,
  type CodeToolFailure,
  type CodeToolResult,
} from './tools.js';
import type { CodeKind } from './scan.js';

const USAGE = `knolo-code <command>

Commands:
  build [--root dir]
  status [--root dir]
  query [--root dir] [--top-k 5] [--path file] [--type kind] <text>
  structure [--root dir] <path-or-symbol>
  expand [--root dir] [--start n] [--end n] <chunk-id>
  mcp

The mcp command speaks JSON-RPC on stdout. Other commands print one JSON object.`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.error(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  const [command, ...rest] = argv;
  if (command === 'mcp') {
    serveStdio(() => createCodeMcpServer());
    console.error('knolo-code: serving stdio');
    return 0;
  }
  const parsed = parseArgs(rest);
  try {
    const result = await run(command ?? '', parsed);
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch {
    const failed: CodeToolFailure = {
      ok: false,
      error: 'CODE_IMAGE_FAILED',
      message: 'The code image request failed.',
    };
    console.log(JSON.stringify(failed));
    return 1;
  }
}

async function run(
  command: string,
  parsed: ParsedArgs
): Promise<CodeToolResult | CodeToolFailure> {
  if (command === 'build') return codeImageBuild(parsed.root);
  if (command === 'status') return codeImageStatus(parsed.root);
  if (command === 'query') {
    const query = parsed.positionals.join(' ');
    if (!query) {
      return {
        ok: false,
        error: 'CODE_QUERY',
        message: 'query requires text.',
      };
    }
    return codeImageQuery({
      root: parsed.root,
      query,
      ...(parsed.topK === undefined ? {} : { topK: parsed.topK }),
      ...(parsed.path === undefined ? {} : { path: parsed.path }),
      ...(parsed.type === undefined ? {} : { type: parsed.type }),
    });
  }
  if (command === 'structure') {
    const target = parsed.positionals[0];
    if (!target) {
      return {
        ok: false,
        error: 'CODE_QUERY',
        message: 'structure requires a path or symbol.',
      };
    }
    return codeImageStructure(target, parsed.root);
  }
  if (command === 'expand') {
    const chunkId = parsed.positionals[0];
    if (!chunkId) {
      return {
        ok: false,
        error: 'CODE_QUERY',
        message: 'expand requires a chunk id.',
      };
    }
    return codeImageExpand({
      root: parsed.root,
      chunkId,
      ...(parsed.start === undefined ? {} : { start: parsed.start }),
      ...(parsed.end === undefined ? {} : { end: parsed.end }),
    });
  }
  return {
    ok: false,
    error: 'CODE_QUERY',
    message: `Unknown command ${command}.`,
  };
}

type ParsedArgs = {
  root?: string;
  path?: string;
  type?: CodeKind;
  topK?: number;
  start?: number;
  end?: number;
  positionals: string[];
};

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const next = argv[index + 1];
    if (token === '--root' && next) {
      parsed.root = next;
      index += 1;
    } else if (token === '--path' && next) {
      parsed.path = next;
      index += 1;
    } else if (token === '--type' && next) {
      parsed.type = next as CodeKind;
      index += 1;
    } else if (token === '--top-k' && next) {
      parsed.topK = Number(next);
      index += 1;
    } else if (token === '--start' && next) {
      parsed.start = Number(next);
      index += 1;
    } else if (token === '--end' && next) {
      parsed.end = Number(next);
      index += 1;
    } else {
      parsed.positionals.push(token);
    }
  }
  return parsed;
}
