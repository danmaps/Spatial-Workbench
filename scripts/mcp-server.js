#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod/v4');
const { createHeadlessApiRuntimeManager, requestJson } = require('../js/headless-api-client');

const runtimeManager = createHeadlessApiRuntimeManager();

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

async function getDiscoveryPayload() {
  const runtime = await runtimeManager.getRuntime();
  const response = await requestJson(runtime.baseUrl, '/api/run');
  const payload = {
    apiUrl: runtime.baseUrl,
    status: response.status,
    ...response.data,
  };

  if (!response.ok) {
    const error = new Error(payload.error || `Discovery request failed with HTTP ${response.status}.`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function runToolPayload(args) {
  const runtime = await runtimeManager.getRuntime();
  const response = await requestJson(runtime.baseUrl, '/api/run', {
    method: 'POST',
    body: {
      tool: args.tool,
      params: args.params || {},
      state: args.state || {},
    },
  });

  return {
    apiUrl: runtime.baseUrl,
    statusCode: response.status,
    ...(response.data || {}),
  };
}

function createTextResult(payload, options = {}) {
  return {
    content: [
      {
        type: 'text',
        text: formatJson(payload),
      },
    ],
    structuredContent: payload,
    ...(options.isError ? { isError: true } : {}),
  };
}

const server = new McpServer(
  {
    name: 'spatial-workbench',
    version: '1.0.0',
  },
  {
    capabilities: {
      logging: {},
    },
  }
);

server.registerTool(
  'list_tools',
  {
    title: 'List Headless Tools',
    description: 'Wrap GET /api/run and return the currently discoverable Spatial Workbench headless tools.',
    outputSchema: {
      apiUrl: z.string().optional(),
      status: z.number().optional(),
      ok: z.boolean(),
      method: z.string().optional(),
      supportedTools: z.array(z.object({}).passthrough()).optional(),
      notes: z.array(z.string()).optional(),
      requestShape: z.any().optional(),
      error: z.string().optional(),
    },
  },
  async () => {
    try {
      const payload = await getDiscoveryPayload();
      return createTextResult(payload);
    } catch (error) {
      const payload = error.payload || {
        ok: false,
        error: error.message || 'Failed to discover headless tools.',
      };
      return createTextResult(payload, { isError: true });
    }
  }
);

server.registerTool(
  'run_tool',
  {
    title: 'Run Headless Tool',
    description: 'Wrap POST /api/run and execute one supported Spatial Workbench headless tool against request-scoped state.',
    inputSchema: {
      tool: z.string().describe('Workbench tool key such as RandomPointsTool or BufferTool.'),
      params: z.record(z.string(), z.any()).default({}).describe('Tool params passed through to the headless API.'),
      state: z.any().default({}).describe('Opaque serializable Workbench state passed through unchanged between calls.'),
    },
    outputSchema: {
      apiUrl: z.string().optional(),
      statusCode: z.number().optional(),
      ok: z.boolean(),
      tool: z.string().optional(),
      status: z.any().optional(),
      validation: z.any().optional(),
      output: z.any().nullable().optional(),
      state: z.any().nullable().optional(),
      execution: z.any().optional(),
      error: z.string().optional(),
      details: z.any().optional(),
    },
  },
  async (args) => {
    try {
      const payload = await runToolPayload(args);
      const isError = payload.statusCode >= 400 || payload.ok === false;
      return createTextResult(payload, { isError });
    } catch (error) {
      return createTextResult(
        {
          ok: false,
          error: error.message || 'Failed to reach the headless API.',
        },
        { isError: true }
      );
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Spatial Workbench MCP server running on stdio');
}

async function shutdown(code = 0) {
  try {
    await runtimeManager.close();
  } catch (error) {
    console.error('Error closing headless API runtime:', error);
    code = 1;
  }
  process.exit(code);
}

process.on('SIGINT', () => {
  shutdown(0);
});

process.on('SIGTERM', () => {
  shutdown(0);
});

main().catch(async (error) => {
  console.error('Spatial Workbench MCP server error:', error);
  await shutdown(1);
});
