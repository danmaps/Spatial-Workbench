/** @jest-environment node */

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { CallToolResultSchema, ListToolsResultSchema } = require('@modelcontextprotocol/sdk/types.js');

jest.setTimeout(20000);

describe('Spatial Workbench MCP server', () => {
  let client;
  let transport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: ['scripts/mcp-server.js'],
      cwd: path.join(__dirname),
      env: {
        ...process.env,
      },
      stderr: 'pipe',
    });

    if (transport.stderr) {
      transport.stderr.on('data', () => {});
    }

    client = new Client({
      name: 'spatial-workbench-mcp-test-client',
      version: '1.0.0',
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (transport) {
      await transport.close();
    }
  });

  test('advertises the thin MCP adapter tools', async () => {
    const result = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    );

    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_tools',
      'get_runtime_info',
      'inspect_state',
      'run_tool',
    ]));
  });

  test('reports runtime limits and summarizes caller-owned state without creating a session', async () => {
    const runtimeResult = await client.request(
      { method: 'tools/call', params: { name: 'get_runtime_info', arguments: {} } },
      CallToolResultSchema
    );

    expect(runtimeResult.structuredContent).toEqual(expect.objectContaining({
      ok: true,
      sessionModel: 'request-scoped',
      headless: expect.objectContaining({ supportedToolKeys: expect.arrayContaining(['BufferTool']) }),
    }));

    const state = {
      layers: [{
        id: 'source-layer',
        name: 'Source Layer',
        geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] },
      }],
      selection: { featureIds: ['source-layer:0'] },
    };
    const inspectionResult = await client.request(
      { method: 'tools/call', params: { name: 'inspect_state', arguments: { state } } },
      CallToolResultSchema
    );

    expect(inspectionResult.structuredContent).toEqual(expect.objectContaining({
      state,
      summary: expect.objectContaining({
        layerCount: 1,
        layers: [expect.objectContaining({ id: 'source-layer', featureCount: 1 })],
        selection: { featureIds: ['source-layer:0'], featureCount: 1 },
      }),
    }));
  });

  test('discovers headless tools and runs the canonical chain through MCP', async () => {
    const discoveryResult = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'list_tools',
          arguments: {},
        },
      },
      CallToolResultSchema
    );

    const discovery = discoveryResult.structuredContent;
    expect(discovery.ok).toBe(true);
    expect(discovery.supportedTools.some((tool) => tool.key === 'RandomPointsTool')).toBe(true);
    expect(discovery.supportedTools.some((tool) => tool.key === 'BufferTool')).toBe(true);
    expect(discovery.supportedTools.some((tool) => tool.key === 'ExportTool')).toBe(true);

    let state = {
      bbox: [-118.5, 33.5, -118.2, 33.8],
    };

    const randomPointsResult = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'run_tool',
          arguments: {
            tool: 'RandomPointsTool',
            params: {
              'Points Count': 5,
              'Inside Polygon': false,
            },
            state,
          },
        },
      },
      CallToolResultSchema
    );

    const randomPoints = randomPointsResult.structuredContent;
    expect(randomPoints.ok).toBe(true);
    expect(randomPoints.execution.outputLayerIds).toHaveLength(1);
    state = randomPoints.state;
    const randomPointsLayerId = randomPoints.state.added[0].id;

    const bufferResult = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'run_tool',
          arguments: {
            tool: 'BufferTool',
            params: {
              'Input Layer': randomPointsLayerId,
              Distance: 0.5,
              Units: 'kilometers',
            },
            state,
          },
        },
      },
      CallToolResultSchema
    );

    const buffer = bufferResult.structuredContent;
    expect(buffer.ok).toBe(true);
    expect(buffer.execution.inputLayerIds).toEqual([randomPointsLayerId]);
    state = buffer.state;
    const bufferedLayerId = buffer.state.added[0].id;

    const exportResult = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'run_tool',
          arguments: {
            tool: 'ExportTool',
            params: {
              Layer: bufferedLayerId,
              Format: 'GeoJSON',
            },
            state,
          },
        },
      },
      CallToolResultSchema
    );

    const exportPayload = exportResult.structuredContent;
    expect(exportPayload.ok).toBe(true);
    expect(exportPayload.execution.inputLayerIds).toEqual([bufferedLayerId]);
    expect(exportPayload.output.download.data).toContain('"FeatureCollection"');
  });
});
