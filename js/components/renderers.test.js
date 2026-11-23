const { createComponentSession } = require('./session');
const { renderComposition, renderSpatialResult } = require('./renderers');
const { createSpatialResultModel } = require('./contracts');

const STUDY_SITES_LAYER = {
  id: 'study-sites',
  name: 'Study Sites',
  geometryType: 'Point',
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { __id: 'site-1', name: 'Site Alpha', priority: 'high' },
        geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
      },
      {
        type: 'Feature',
        properties: { __id: 'site-2', name: 'Site Beta', priority: 'medium' },
        geometry: { type: 'Point', coordinates: [-118.25, 34.06] },
      },
    ],
  },
};

describe('swb.ui.v0 DOM and Leaflet component renderers', () => {
  test('renders both compact and workspace layouts from the same component descriptors and wires revisioned user events', async () => {
    const session = createComponentSession({
      layers: [STUDY_SITES_LAYER],
      selection: {
        activeLayerId: 'study-sites',
        selectedLayerIds: ['study-sites'],
        selectedFeaturesByLayerId: { 'study-sites': ['site-1'] },
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

    const layoutSpec = {
      contractVersion: 'swb.ui.v0',
      layout: 'compact',
      components: [
        {
          type: 'LayerInput',
          componentId: 'layer-in',
          toolKey: 'BufferTool',
          parameterName: 'Input Layer',
          targetScope: 'selection',
        },
        {
          type: 'SpatialSelection',
          componentId: 'sel-in',
          layerId: 'study-sites',
          mode: 'selected_features',
        },
        {
          type: 'ToolParameters',
          componentId: 'buf-params',
          toolKey: 'BufferTool',
          lockedParams: ['Input Layer'],
        },
        {
          type: 'SpatialResult',
          componentId: 'buf-result',
          surfaceVariant: 'compact',
        },
        {
          type: 'ExecutionReceipt',
          componentId: 'buf-receipt',
          toolKey: 'BufferTool',
        },
      ],
    };

    const host = document.createElement('div');
    const capturedEvents = [];

    const renderCurrent = (layoutMode = 'compact') => {
      const resolved = session.resolveLayout({
        ...layoutSpec,
        layout: layoutMode,
        components: layoutSpec.components.map((c) =>
          c.type === 'SpatialResult' ? { ...c, surfaceVariant: layoutMode } : c
        ),
      });
      renderComposition(host, resolved, {
        enableLeafletMap: false,
        onEvent: (event) => {
          capturedEvents.push(event);
          session.dispatchEvent(event);
        },
      });
      return resolved;
    };

    renderCurrent('compact');

    expect(host.querySelector('.swb-layout-compact')).not.toBeNull();
    expect(host.querySelectorAll('[data-component-type]')).toHaveLength(5);

    // Every form input has an explicit <label for="...">
    const formInputs = Array.from(host.querySelectorAll('input, select'));
    expect(formInputs.length).toBeGreaterThan(0);
    formInputs.forEach((input) => {
      expect(input.id).toBeTruthy();
      expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    });

    // Unexecuted receipt shows explicit Empty badge and grounded notice
    const receiptSection = host.querySelector('[data-component-type="ExecutionReceipt"]');
    expect(receiptSection.dataset.lifecycle).toBe('empty');
    expect(receiptSection.textContent).toContain('No execution has run yet');

    // User toggles second feature in SpatialSelection
    const checkboxes = host.querySelectorAll('.swb-feature-checkbox');
    expect(checkboxes).toHaveLength(2);
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change'));

    expect(capturedEvents[0].eventType).toBe('swb:selection-changed');
    expect(session.getState().selection.selectedFeaturesByLayerId['study-sites']).toEqual([
      'site-1',
      'site-2',
    ]);

    // Re-render in workspace layout and edit Distance parameter
    renderCurrent('workspace');
    expect(host.querySelector('.swb-layout-workspace')).not.toBeNull();
    expect(host.querySelector('.swb-workspace-controls')).not.toBeNull();
    expect(host.querySelector('.swb-workspace-inspector')).not.toBeNull();
    expect(host.querySelector('.swb-attribute-table')).not.toBeNull();

    const distanceInput = host.querySelector('input[data-param-name="Distance"]');
    expect(distanceInput.value).toBe('500');
    distanceInput.value = '750';
    distanceInput.dispatchEvent(new Event('change'));

    expect(session.getState().drafts.BufferTool.Distance).toBe(750);

    // Re-render and submit execute request
    renderCurrent('workspace');
    const form = host.querySelector('.swb-params-form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    const execEvent = capturedEvents[capturedEvents.length - 1];
    expect(execEvent.eventType).toBe('swb:execute-requested');
    expect(execEvent.payload.params.Distance).toBe(750);
    expect(execEvent.payload.params.Units).toBe('meters');

    // Execute tool and re-render grounded receipt + result
    await session.executeTool({ toolKey: 'BufferTool' });
    renderCurrent('workspace');

    const updatedReceipt = host.querySelector('[data-component-type="ExecutionReceipt"]');
    expect(updatedReceipt.dataset.lifecycle).toBe('completed');
    expect(updatedReceipt.textContent).toContain('Buffered 2 selected feature(s).');
    expect(updatedReceipt.textContent).toContain('Selected features (2 of 2 on study-sites)');
  });

  test('SpatialResult mounts Leaflet preview layers when a Leaflet adapter is available', () => {
    const addTo = jest.fn().mockReturnThis();
    const fitBounds = jest.fn();
    const setView = jest.fn().mockReturnValue({ fitBounds });
    const mockLeaflet = {
      map: jest.fn(() => ({ setView, fitBounds })),
      tileLayer: jest.fn(() => ({ addTo })),
      geoJSON: jest.fn(() => ({
        addTo: jest.fn().mockReturnValue({
          getBounds: () => ({ isValid: () => true, extend: (b) => b }),
        }),
      })),
    };

    const model = createSpatialResultModel(
      {
        componentId: 'res-1',
        surfaceVariant: 'compact',
      },
      {
        layers: [STUDY_SITES_LAYER],
      }
    );

    const container = document.createElement('div');
    renderSpatialResult(container, model, { leaflet: mockLeaflet });

    expect(mockLeaflet.map).toHaveBeenCalledTimes(1);
    expect(mockLeaflet.geoJSON).toHaveBeenCalledTimes(1);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  test('renders SpatialPredicatePicker and GeometryComparison components and dispatches their events (#167)', () => {
    const session = createComponentSession({
      layers: [
        STUDY_SITES_LAYER,
        {
          id: 'compare-out',
          name: 'Compare A vs B',
          geometryType: 'Polygon',
          geojson: {
            type: 'FeatureCollection',
            features: [],
            toolMetadata: {
              name: 'Compare',
              comparison: {
                layerAId: 'parcel-a',
                layerBId: 'parcel-b',
                areaASqm: 1000,
                areaBSqm: 1200,
                intersectionAreaSqm: 800,
                onlyInAAreaSqm: 200,
                onlyInBAreaSqm: 400,
                areaDeltaSqm: 200,
                jaccardSimilarity: 0.5714,
              },
            },
          },
        },
      ],
    });

    const host = document.createElement('div');
    const render = () => {
      const resolved = session.resolveLayout({
        contractVersion: 'swb.ui.v0',
        layout: 'workspace',
        components: [
          {
            type: 'SpatialPredicatePicker',
            componentId: 'pred-1',
            toolKey: 'SpatialJoinTool',
          },
          {
            type: 'GeometryComparison',
            componentId: 'cmp-1',
            comparisonLayerId: 'compare-out',
          },
        ],
      });
      renderComposition(host, resolved, {
        onEvent: (event) => {
          session.dispatchEvent(event);
        },
      });
    };

    render();

    const predSelect = host.querySelector('.swb-predicate-select');
    expect(predSelect.value).toBe('intersects');
    predSelect.value = 'within_distance';
    predSelect.dispatchEvent(new Event('change'));

    expect(session.getState().drafts.SpatialJoinTool.Predicate).toBe('within_distance');

    render();
    const distInput = host.querySelector('.swb-predicate-distance');
    expect(distInput).not.toBeNull();
    distInput.value = '250';
    distInput.dispatchEvent(new Event('change'));
    expect(session.getState().drafts.SpatialJoinTool.Distance).toBe(250);

    render();
    const acceptBButton = host.querySelector('[data-comparison-decision="accepted_b"]');
    expect(acceptBButton).not.toBeNull();
    acceptBButton.click();

    expect(session.getState().comparisonDecisions['compare-out']).toEqual({
      decision: 'accepted_b',
      candidateLayerId: 'parcel-b',
    });
  });
});
