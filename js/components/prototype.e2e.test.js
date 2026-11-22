const http = require('http');
const { app } = require('../../server');
const { runHeadlessTool } = require('../headless-runtime');
const { generateOpenUISystemPrompt, parseOpenUILang } = require('./adapters/openui');
const {
  PROTOTYPE_OPENUI_EXPRESSIONS,
  PROTOTYPE_STUDY_SITES_FIXTURE,
  createPrototypeController,
} = require('./prototype');

function requestHttp(baseUrl, requestPath, options = {}) {
  const url = new URL(requestPath, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: res.headers,
            text: data,
            json: () => JSON.parse(data || '{}'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function stripTimestamps(geojson) {
  const cloned = JSON.parse(JSON.stringify(geojson));
  if (cloned?.toolMetadata) {
    delete cloned.toolMetadata.timestamp;
  }
  if (Array.isArray(cloned?.toolHistory)) {
    cloned.toolHistory.forEach((entry) => {
      delete entry.timestamp;
    });
  }
  return cloned;
}

describe('OpenUI adapter and dual-layout BufferTool -> ExportTool prototype (#163, #164)', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  test('GET /agent-ui-demo and GET /api/agent-ui/catalog expose the v0 component catalog and OpenUI prompt', async () => {
    const htmlRes = await requestHttp(baseUrl, '/agent-ui-demo');
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.text).toContain('Opinionated GIS Components for Agent-Generated Interfaces');
    expect(htmlRes.text).toContain('/public/js/agent-ui-demo-client.js');

    const catalogRes = await requestHttp(baseUrl, '/api/agent-ui/catalog');
    expect(catalogRes.status).toBe(200);
    const catalog = catalogRes.json();
    expect(catalog.ok).toBe(true);
    expect(catalog.contractVersion).toBe('swb.ui.v0');
    expect(catalog.components.map((c) => c.name)).toEqual([
      'LayerInput',
      'SpatialSelection',
      'ToolParameters',
      'SpatialResult',
      'ExecutionReceipt',
    ]);
    expect(catalog.systemPrompt).toContain('BufferTool');
    expect(catalog.systemPrompt).toContain('CompactCard');
    expect(catalog.systemPrompt).toContain('ReviewWorkspace');
  });

  test('parseOpenUILang handles complete CompactCard and ReviewWorkspace expressions and detects partial streams', () => {
    const compact = parseOpenUILang(PROTOTYPE_OPENUI_EXPRESSIONS.compact);
    expect(compact.streamComplete).toBe(true);
    expect(compact.layout).toBe('compact');
    expect(compact.components).toHaveLength(5);
    expect(compact.components[2]).toEqual(
      expect.objectContaining({
        type: 'ToolParameters',
        toolKey: 'BufferTool',
        draftParams: {
          'Input Layer': 'study-sites',
          Distance: 500,
          Units: 'meters',
        },
      })
    );

    const workspace = parseOpenUILang(PROTOTYPE_OPENUI_EXPRESSIONS.workspace);
    expect(workspace.streamComplete).toBe(true);
    expect(workspace.layout).toBe('workspace');
    expect(workspace.components).toHaveLength(5);

    const partial = parseOpenUILang(PROTOTYPE_OPENUI_EXPRESSIONS.streamingPartial);
    expect(partial.streamComplete).toBe(false);
    expect(partial.components).toHaveLength(2);
    expect(partial.components.every((c) => c.streamComplete === false)).toBe(true);

    const prompt = generateOpenUISystemPrompt();
    expect(prompt).toContain('swb.ui.v0');
  });

  test('end-to-end equivalence: generated UI against POST /api/run produces identical geometry to direct headless execution and supports dual-layout rerun + export', async () => {
    const container = document.createElement('div');
    const downloadedArtifacts = [];

    const httpRunner = async (payload) => {
      const response = await requestHttp(baseUrl, '/api/run', {
        method: 'POST',
        body: payload,
      });
      return response.json();
    };

    const controller = createPrototypeController({
      container,
      initialLayout: 'compact',
      enableLeafletMap: false,
      runner: httpRunner,
      onDownload: (artifact) => downloadedArtifacts.push(artifact),
    });

    // 1. Verify incomplete streamed UI cannot execute tools
    controller.setOpenUIExpression(PROTOTYPE_OPENUI_EXPRESSIONS.streamingPartial);
    const execButtonWhileStreaming = container.querySelector('.swb-execute-btn');
    expect(execButtonWhileStreaming.disabled).toBe(true);
    const blockedAttempt = await controller.runBuffer();
    expect(blockedAttempt.ok).toBe(false);
    expect(blockedAttempt.reason).toBe('stream-incomplete');

    // 2. Complete stream in Layout A (CompactCard)
    controller.setLayout('compact');
    expect(container.querySelector('.swb-layout-compact')).not.toBeNull();
    const execButtonReady = container.querySelector('.swb-execute-btn');
    expect(execButtonReady.disabled).toBe(false);

    // 3. User enters Distance 650 (exceeds hosted 500 maxBufferDistance guardrail) -> surfaces runtime error in receipt
    const distanceInput = container.querySelector('input[data-param-name="Distance"]');
    expect(distanceInput.value).toBe('500');
    distanceInput.value = '650';
    distanceInput.dispatchEvent(new Event('change'));
    const guardrailFailure = await controller.runBuffer();
    expect(guardrailFailure.ok).toBe(false);
    expect(guardrailFailure.receipt.lifecycle).toBe('failed');
    expect(guardrailFailure.receipt.result.statusMessage).toContain('exceeds the maximum absolute value of 500');
    expect(container.querySelector('[data-component-type="ExecutionReceipt"]').dataset.lifecycle).toBe('failed');

    // 4. User edits Distance to 250 meters via DOM input and executes BufferTool against POST /api/run
    const distanceInputAfterError = container.querySelector('input[data-param-name="Distance"]');
    distanceInputAfterError.value = '250';
    distanceInputAfterError.dispatchEvent(new Event('change'));

    expect(controller.session.getState().drafts.BufferTool.Distance).toBe(250);

    const uiBufferResult = await controller.runBuffer();
    expect(uiBufferResult.ok).toBe(true);
    expect(uiBufferResult.executedParams).toEqual({
      'Input Layer': 'study-sites',
      Distance: 250,
      Units: 'meters',
      targetScope: 'selection',
    });

    // 5. Compare output geometry with direct headless execution on identical input & parameters
    const directHeadlessResult = await runHeadlessTool({
      tool: 'BufferTool',
      params: {
        'Input Layer': 'study-sites',
        Distance: 250,
        Units: 'meters',
        targetScope: 'selection',
      },
      state: {
        layers: [PROTOTYPE_STUDY_SITES_FIXTURE],
        selection: {
          activeLayerId: 'study-sites',
          selectedLayerIds: ['study-sites'],
          selectedFeaturesByLayerId: {
            'study-sites': ['study-sites-1', 'study-sites-2'],
          },
          targetScope: 'selection',
        },
      },
    });

    const uiOutputLayer = uiBufferResult.state.layers.find((l) => l.id === 'result-1');
    const directOutputLayer = directHeadlessResult.state.layers.find((l) => l.id === 'result-1');
    expect(stripTimestamps(uiOutputLayer.geojson)).toEqual(stripTimestamps(directOutputLayer.geojson));

    // 6. Switch to Layout B (Expanded Review Workspace) without losing state, layer IDs, or receipt
    controller.setLayout('workspace');
    expect(container.querySelector('.swb-layout-workspace')).not.toBeNull();
    expect(container.querySelector('input[data-param-name="Distance"]').value).toBe('250');
    expect(container.querySelector('[data-component-type="ExecutionReceipt"]').textContent).toContain(
      'Selected features (2 of 3 on study-sites)'
    );

    // 7. Chain into ExportTool and trigger artifact download event
    const exportResult = await controller.runExport('result-1');
    expect(exportResult.ok).toBe(true);

    const downloadBtn = container.querySelector('.swb-artifact-btn');
    expect(downloadBtn).not.toBeNull();
    downloadBtn.click();

    expect(downloadedArtifacts).toHaveLength(1);
    expect(downloadedArtifacts[0].filename).toBe('result-1.geojson');
    const downloadedGeoJSON = JSON.parse(downloadedArtifacts[0].data);
    expect(downloadedGeoJSON.features).toHaveLength(2);
    expect(downloadedGeoJSON.toolHistory.map((h) => h.name)).toEqual(['Buffer', 'Export']);
  });
});
