const {
  CONTRACT_VERSION,
  COMPONENT_TYPES,
  LIFECYCLE_STATES,
  createComponentEvent,
  createComponentRegistry,
  createExecutionReceiptModel,
  createLayerInputModel,
  createSpatialResultModel,
  createSpatialSelectionModel,
  createToolParametersModel,
  resolveComposition,
  validateComponentEvent,
} = require('./contracts');
const { createComponentSession } = require('./session');

const STUDY_SITES_LAYER = {
  id: 'study-sites',
  name: 'Study Sites',
  geometryType: 'Point',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { __id: 'site-1', name: 'Site Alpha', category: 'priority' },
        geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
      },
      {
        type: 'Feature',
        properties: { __id: 'site-2', name: 'Site Beta', category: 'priority' },
        geometry: { type: 'Point', coordinates: [-118.25, 34.06] },
      },
      {
        type: 'Feature',
        properties: { __id: 'site-3', name: 'Site Gamma', category: 'secondary' },
        geometry: { type: 'Point', coordinates: [-118.23, 34.04] },
      },
    ],
  },
};

describe('swb.ui.v0 headless GIS component contracts', () => {
  test('LayerInput validates geometry compatibility and selection scope', () => {
    const state = {
      stateRevision: 2,
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedLayerIds: ['study-sites'],
        selectedFeaturesByLayerId: { 'study-sites': ['site-1', 'site-2'] },
        targetScope: 'selection',
      },
    };

    const bufferLayerInput = createLayerInputModel(
      {
        componentId: 'layer-input-1',
        toolKey: 'BufferTool',
        parameterName: 'Input Layer',
        targetScope: 'selection',
      },
      state
    );

    expect(bufferLayerInput.contractVersion).toBe(CONTRACT_VERSION);
    expect(bufferLayerInput.stateRevision).toBe(2);
    expect(bufferLayerInput.lifecycle).toBe('draft');
    expect(bufferLayerInput.validation.ok).toBe(true);
    expect(bufferLayerInput.result).toEqual({
      layerId: 'study-sites',
      displayName: 'Study Sites',
      geometryType: 'Point',
      featureCount: 3,
      compatible: true,
      targetScope: 'selection',
      selectedFeatureCount: 2,
    });

    const incompatibleClipInput = createLayerInputModel(
      {
        componentId: 'clip-input-1',
        toolKey: 'ClipTool',
        parameterName: 'Input Layer',
      },
      state
    );

    expect(incompatibleClipInput.lifecycle).toBe('invalid');
    expect(incompatibleClipInput.validation.ok).toBe(false);
    expect(incompatibleClipInput.validation.errors[0]).toContain(
      'Input Layer only accepts Polygon, MultiPolygon geometry; received Point.'
    );
  });

  test('SpatialSelection enforces empty selection blocking when mode is selected_features', () => {
    const emptySelectionState = {
      stateRevision: 1,
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedFeaturesByLayerId: {},
      },
    };

    const blocked = createSpatialSelectionModel(
      {
        componentId: 'selection-1',
        layerId: 'study-sites',
        mode: 'selected_features',
        emptySelectionPolicy: 'block',
      },
      emptySelectionState
    );

    expect(blocked.lifecycle).toBe('invalid');
    expect(blocked.result.valid).toBe(false);
    expect(blocked.result.effectiveFeatureCount).toBe(0);
    expect(blocked.validation.errors).toEqual([
      'Select at least one feature or switch scope to Whole Layer.',
    ]);

    const populated = createSpatialSelectionModel(
      {
        componentId: 'selection-1',
        layerId: 'study-sites',
        mode: 'selected_features',
        selectedFeatureIds: ['site-1', 'site-3'],
      },
      emptySelectionState
    );

    expect(populated.lifecycle).toBe('draft');
    expect(populated.result.valid).toBe(true);
    expect(populated.result.effectiveFeatureCount).toBe(2);
    expect(populated.items.filter((item) => item.selected).map((item) => item.id)).toEqual([
      'site-1',
      'site-3',
    ]);
  });

  test('ToolParameters reuses runtime schema validation and blocks execution while streaming or invalid', () => {
    const state = {
      stateRevision: 3,
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedFeaturesByLayerId: { 'study-sites': ['site-1'] },
        targetScope: 'selection',
      },
    };

    const validDraft = createToolParametersModel(
      {
        componentId: 'buffer-params',
        toolKey: 'BufferTool',
        draftParams: {
          'Input Layer': 'study-sites',
          Distance: 500,
          Units: 'meters',
        },
      },
      state
    );

    expect(validDraft.lifecycle).toBe('draft');
    expect(validDraft.canExecute).toBe(true);
    expect(validDraft.spatialAssumptions).toEqual(
      expect.objectContaining({
        crs: 'EPSG:4326',
        coordinateOrder: 'longitude,latitude',
        precision: 'not-survey-grade',
      })
    );
    expect(validDraft.result.params).toEqual({
      'Input Layer': 'study-sites',
      Distance: 500,
      Units: 'meters',
      targetScope: 'selection',
    });

    const streamingDraft = createToolParametersModel(
      {
        componentId: 'buffer-params',
        toolKey: 'BufferTool',
        streamComplete: false,
        draftParams: {
          'Input Layer': 'study-sites',
          Distance: 500,
          Units: 'meters',
        },
      },
      state
    );

    expect(streamingDraft.lifecycle).toBe('loading');
    expect(streamingDraft.canExecute).toBe(false);

    const invalidUnitsDraft = createToolParametersModel(
      {
        componentId: 'buffer-params',
        toolKey: 'BufferTool',
        draftParams: {
          'Input Layer': 'study-sites',
          Distance: 500,
          Units: 'furlongs',
        },
      },
      state
    );

    expect(invalidUnitsDraft.lifecycle).toBe('invalid');
    expect(invalidUnitsDraft.canExecute).toBe(false);
    expect(invalidUnitsDraft.validation.errors[0]).toContain('Units must be one of:');
  });

  test('ExecutionReceipt cannot present an unexecuted proposal as completed', () => {
    const unexecuted = createExecutionReceiptModel({
      componentId: 'receipt-1',
      toolKey: 'BufferTool',
    });

    expect(unexecuted.grounded).toBe(false);
    expect(unexecuted.lifecycle).toBe('empty');
    expect(unexecuted.result.ok).toBe(false);

    const warningRun = createExecutionReceiptModel(
      { componentId: 'receipt-1', toolKey: 'BufferTool' },
      {
        ok: true,
        tool: 'BufferTool',
        status: { code: 0, message: 'Buffered 1 selected feature(s).' },
        execution: {
          startedAt: '2026-11-22T06:00:00.000Z',
          finishedAt: '2026-11-22T06:00:00.010Z',
          durationMs: 10,
          inputLayerIds: ['study-sites'],
          outputLayerIds: ['result-1'],
          featureCounts: { input: 1, output: 1 },
          target: {
            layerId: 'study-sites',
            mode: 'selection',
            selectedFeatureIds: ['site-1'],
            selectedFeatureCount: 1,
            totalFeatureCount: 3,
          },
        },
        spatial: {
          warnings: [{ code: 'buffer-skipped-features', message: 'Skipped 1 null feature.' }],
        },
      }
    );

    expect(warningRun.grounded).toBe(true);
    expect(warningRun.lifecycle).toBe('partial');
    expect(warningRun.result.warningCount).toBe(1);
    expect(warningRun.result.target.mode).toBe('selection');
  });

  test('resolveComposition enforces bounded component registration and versioned interoperability', () => {
    const registry = createComponentRegistry();
    expect(registry.listSupportedTypes()).toEqual([...COMPONENT_TYPES]);
    expect(LIFECYCLE_STATES).toContain('completed');

    const versionMismatch = resolveComposition(
      {
        contractVersion: 'swb.ui.v99',
        components: [{ type: 'LayerInput', toolKey: 'BufferTool' }],
      },
      { layers: [STUDY_SITES_LAYER] }
    );

    expect(versionMismatch.ok).toBe(false);
    expect(versionMismatch.components[0].type).toBe('FallbackComponent');
    expect(versionMismatch.errors[0]).toContain('Incompatible composition contractVersion');

    const unknownComponent = resolveComposition(
      {
        contractVersion: CONTRACT_VERSION,
        components: [{ type: 'ArbitraryScriptWidget', componentId: 'bad-1' }],
      },
      { layers: [STUDY_SITES_LAYER] }
    );

    expect(unknownComponent.ok).toBe(false);
    expect(unknownComponent.components[0].type).toBe('FallbackComponent');
    expect(unknownComponent.components[0].reason).toContain('Unregistered component type "ArbitraryScriptWidget"');
  });

  test('createComponentEvent and validateComponentEvent enforce revisioned event contract', () => {
    const event = createComponentEvent({
      eventType: 'swb:params-draft-changed',
      componentId: 'buffer-params-1',
      stateRevision: 4,
      payload: {
        toolKey: 'BufferTool',
        params: { Distance: 750, Units: 'meters' },
      },
    });

    expect(validateComponentEvent(event)).toEqual({ ok: true, errors: [] });
    expect(validateComponentEvent({ ...event, contractVersion: 'other.v1', stateRevision: 0 })).toEqual({
      ok: false,
      errors: [
        'Unsupported contractVersion: other.v1. Expected swb.ui.v0.',
        'Event stateRevision must be a positive integer.',
      ],
    });
  });
});

describe('createComponentSession revisioning, rerun, and workflow chaining', () => {
  test('rejects stale agent proposals and stale user events when stateRevision has advanced', () => {
    const session = createComponentSession({
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedFeaturesByLayerId: { 'study-sites': ['site-1', 'site-2'] },
        targetScope: 'selection',
      },
    });

    expect(session.getState().stateRevision).toBe(1);

    // Agent proposes initial 500m buffer at revision 1
    const initialProposal = session.applyAgentProposal({
      baseRevision: 1,
      toolKey: 'BufferTool',
      draftParams: {
        'Input Layer': 'study-sites',
        Distance: 500,
        Units: 'meters',
      },
    });
    expect(initialProposal.applied).toBe(true);
    expect(session.getState().stateRevision).toBe(2);

    // User edits Distance to 750m (advances revision to 3)
    const userEditEvent = createComponentEvent({
      eventType: 'swb:params-draft-changed',
      componentId: 'buffer-params-1',
      stateRevision: 2,
      payload: {
        toolKey: 'BufferTool',
        params: { Distance: 750 },
      },
    });
    const dispatchResult = session.dispatchEvent(userEditEvent);
    expect(dispatchResult.ok).toBe(true);
    expect(session.getState().stateRevision).toBe(3);

    // Late agent response referencing old baseRevision 1 arrives and is rejected
    const staleProposal = session.applyAgentProposal({
      baseRevision: 1,
      toolKey: 'BufferTool',
      draftParams: {
        Distance: 100,
        Units: 'feet',
      },
    });
    expect(staleProposal).toEqual({
      applied: false,
      reason: 'stale-revision',
      stateRevision: 3,
    });
    expect(session.getState().drafts.BufferTool.Distance).toBe(750);
    expect(session.getState().drafts.BufferTool.Units).toBe('meters');

    // Stale UI event with stateRevision 1 is also rejected
    const staleEventResult = session.dispatchEvent(
      createComponentEvent({
        eventType: 'swb:selection-changed',
        componentId: 'selection-1',
        stateRevision: 1,
        payload: {
          layerId: 'study-sites',
          selectedFeatureIds: ['site-3'],
        },
      })
    );
    expect(staleEventResult.ok).toBe(false);
    expect(staleEventResult.reason).toBe('stale-revision');
    expect(session.getState().selection.selectedFeaturesByLayerId['study-sites']).toEqual([
      'site-1',
      'site-2',
    ]);
  });

  test('blocks execution while streamComplete is false, then runs BufferTool -> rerun -> ExportTool end-to-end', async () => {
    const session = createComponentSession({
      streamComplete: false,
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedLayerIds: ['study-sites'],
        selectedFeaturesByLayerId: { 'study-sites': ['site-1', 'site-2'] },
        targetScope: 'selection',
      },
      drafts: {
        BufferTool: {
          'Input Layer': 'study-sites',
          Distance: 500,
          Units: 'meters',
          targetScope: 'selection',
        },
      },
    });

    const blockedWhileStreaming = await session.executeTool({ toolKey: 'BufferTool' });
    expect(blockedWhileStreaming.ok).toBe(false);
    expect(blockedWhileStreaming.reason).toBe('stream-incomplete');

    session.setStreamComplete(true);

    // First buffer run (500 meters on 2 selected features)
    const firstBuffer = await session.executeTool({ toolKey: 'BufferTool' });
    expect(firstBuffer.ok).toBe(true);
    expect(firstBuffer.executedParams).toEqual({
      'Input Layer': 'study-sites',
      Distance: 500,
      Units: 'meters',
      targetScope: 'selection',
    });
    expect(firstBuffer.receipt.result).toEqual(
      expect.objectContaining({
        grounded: true,
        ok: true,
        toolKey: 'BufferTool',
        featureCounts: { input: 2, output: 2 },
        target: expect.objectContaining({
          layerId: 'study-sites',
          mode: 'selection',
          selectedFeatureCount: 2,
          totalFeatureCount: 3,
        }),
      })
    );
    expect(session.getState().layers.map((l) => l.id)).toEqual(['study-sites', 'result-1']);

    // User revises Distance to 800 meters and reruns against preserved study-sites layer
    session.updateDraftParams({
      toolKey: 'BufferTool',
      params: { Distance: 800 },
    });
    const rerunBuffer = await session.executeTool({ toolKey: 'BufferTool' });
    expect(rerunBuffer.ok).toBe(true);
    expect(rerunBuffer.executedParams.Distance).toBe(800);
    // Source layer preserved, previous intermediate result-1 replaced cleanly
    expect(session.getState().layers.map((l) => l.id)).toEqual(['study-sites', 'result-1']);
    expect(session.getState().layers[1].geojson.toolMetadata.params.Distance).toBe(800);

    const spatialResult = createSpatialResultModel(
      {
        componentId: 'result-view',
        primaryOutputLayerId: 'result-1',
      },
      session.getState()
    );
    expect(spatialResult.result.primaryOutputLayerId).toBe('result-1');
    expect(spatialResult.result.sourceLayerId).toBe('study-sites');
    expect(spatialResult.result.attributeSummary.totalRows).toBe(2);

    // Chain into ExportTool for result-1
    const exportRun = await session.executeTool({
      toolKey: 'ExportTool',
      params: {
        Layer: 'result-1',
        Format: 'GeoJSON',
        targetScope: 'layer',
      },
    });
    expect(exportRun.ok).toBe(true);
    expect(exportRun.receipt.artifacts).toHaveLength(1);
    const exportedGeoJSON = JSON.parse(exportRun.receipt.artifacts[0].data);
    expect(exportedGeoJSON.features).toHaveLength(2);
    expect(exportedGeoJSON.toolHistory.map((entry) => entry.name)).toEqual(['Buffer', 'Export']);
  });
});
