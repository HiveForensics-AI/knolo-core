import {
  knoloMastraTools,
  loadKnoloMastraConfigFile,
} from '../../packages/mastra/dist/index.js';

const configPath = process.env.KNOLO_MCP_CONFIG;
if (!configPath) {
  console.error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
  process.exit(1);
}

const config = await loadKnoloMastraConfigFile(configPath);
const tools = await knoloMastraTools(config);
const names = Object.keys(tools).sort();
for (const name of [
  'knolo_get',
  'knolo_search',
  'knolo_status',
  'knolo_verify',
]) {
  if (!names.includes(name)) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

let search;
try {
  search = await tools.knolo_search.execute({
    query: 'enterprise refunds',
    limit: 4,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'search failed');
  process.exit(1);
}

const excerpt = search.hits?.[0]?.excerpt ?? '';
const receiptId = search.hits?.[0]?.receiptId ?? '';
console.log(
  JSON.stringify({
    modelCalled: false,
    tools: names,
    excerpt,
    receiptId,
  })
);
if (!excerpt.includes('Annual enterprise refunds')) process.exit(1);
if (!receiptId.startsWith('qr_')) process.exit(1);
