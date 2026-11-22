const { Tool } = require('./Tool');
const { Parameter } = require('./Parameter');

jest.mock('../state', () => ({
  getState: jest.fn(() => ({ layers: ['a', 'b'] })),
  getLayer: jest.fn(),
  listLayers: jest.fn(),
  applyResult: jest.fn(),
}));

describe('Tool base architecture', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
      <a id="selectedToolDocsLink" class="hidden" href="#"></a>
      <div id="toolContent"></div>
      <div id="statusMessage" style="display:none"><span id="statusMessageText"></span></div>
      <input id="param-Count" value="7" />
      <input id="param-Enabled" type="checkbox" checked />
      <input id="param-Name" value="demo" />
      <input id="param-Ratio" value="2.5" />
    `;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();
  });

  test('collectParamsFromDOM parses supported parameter types', () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [
          { name: 'Count', type: 'int', defaultValue: 0 },
          { name: 'Enabled', type: 'boolean', defaultValue: false },
          { name: 'Name', type: 'text', defaultValue: '' },
          { name: 'Ratio', type: 'float', defaultValue: 0 }
        ], 'demo', null);
      }
    }

    const tool = new DemoTool();
    expect(tool.collectParamsFromDOM()).toEqual({
      Count: 7,
      Enabled: true,
      Name: 'demo',
      Ratio: 2.5,
    });
  });

  test('run() returns the canonical ToolResult envelope', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [], 'demo', null);
      }
      async run() {
        this.setStatus(0, 'done');
        return {
          added: ['layer-1'],
          download: { filename: 'out.geojson', mimeType: 'application/geo+json', data: '{"type":"FeatureCollection","features":[]}' },
        };
      }
    }

    const result = await new DemoTool().run({}, {});

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: { code: 0, message: 'done' },
      outputs: [expect.objectContaining({ type: 'layer', layerIds: ['layer-1'] })],
      artifacts: [expect.objectContaining({ type: 'download', filename: 'out.geojson' })],
      logs: [],
    }));
  });

  test('execute passes params and context into run()', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [
          { name: 'Count', type: 'int', defaultValue: 0 },
          { name: 'Name', type: 'text', defaultValue: '' }
        ], 'demo', { kind: 'map' });
        this.run = jest.fn(async (params, context) => {
          this.setStatus(0, 'ran');
          return { params, context };
        });
      }
    }

    const tool = new DemoTool();
    await tool.execute();

    expect(tool.run).toHaveBeenCalledTimes(1);
    const [params, context] = tool.run.mock.calls[0];
    expect(params).toEqual({ Count: 7, Name: 'demo' });
    expect(context.map).toEqual({ kind: 'map' });
    expect(context.tool).toBe(tool);
    expect(context.state).toEqual({ layers: ['a', 'b'] });
    expect(typeof context.getLayer).toBe('function');
    expect(typeof context.listLayers).toBe('function');
    expect(typeof context.applyResult).toBe('function');
  });

  test('execute validates params before run()', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [
          { name: 'Name', type: 'text', defaultValue: '' }
        ], 'demo', null);
        this.run = jest.fn();
      }

      async validate() {
        return { ok: false, errors: ['Name is required.'] };
      }
    }

    const tool = new DemoTool();
    const result = await tool.execute();

    expect(tool.run).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errors: ['Name is required.'],
      status: { code: 2, message: 'Name is required.' },
      outputs: [],
      artifacts: [],
      logs: [],
    }));
    expect(tool.getStatus()).toEqual({ code: 2, message: 'Name is required.' });
  });

  test('handleRunResult supports download responses', async () => {
    const click = jest.fn();
    const remove = jest.fn();
    const anchorMock = { click, remove, set href(v) { this._href = v; }, set download(v) { this._download = v; } };
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return anchorMock;
      return originalCreateElement(tag);
    });

    class DemoTool extends Tool {
      constructor() {
        super('Demo', [], 'demo', null);
      }
    }

    const tool = new DemoTool();
    await tool.handleRunResult({
      artifacts: [{
        type: 'download',
        filename: 'out.geojson',
        mimeType: 'application/json',
        data: '{"ok":true}'
      }]
    });

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  test('execute wrapper updates error status when run throws', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [], 'demo', null);
      }
      async run() {
        throw new Error('boom');
      }
    }

    const tool = new DemoTool();
    await tool.execute();

    expect(tool.getStatus().code).toBe(1);
    expect(tool.getStatus().message).toBe('boom');
    expect(document.getElementById('statusMessageText').textContent).toBe('boom');
  });

  test('execute wrapper re-renders with last entered params instead of defaults', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo', [
          { name: 'Count', type: 'int', defaultValue: 1, min: 0, max: 10 },
          { name: 'Enabled', type: 'boolean', defaultValue: false },
        ], 'demo', null);
      }
      async run() {
        this.setStatus(0, 'ran');
      }
    }

    const tool = new DemoTool();
    tool.renderUI();
    document.getElementById('param-Count').value = '7';
    document.getElementById('param-Enabled').checked = true;

    await tool.execute();

    expect(document.getElementById('param-Count').value).toBe('7');
    expect(document.getElementById('param-Enabled').checked).toBe(true);
  });

  test('execute wrapper dispatches a completion event', async () => {
    const listener = jest.fn();
    document.addEventListener('spatial-workbench:tool-complete', listener);

    class DemoTool extends Tool {
      constructor() {
        super('Demo', [], 'demo', null);
      }
      async run() {
        this.setStatus(0, 'done');
        return { ok: true };
      }
    }

    const tool = new DemoTool();
    await tool.execute();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail.status.message).toBe('done');
    expect(listener.mock.calls[0][0].detail.result).toEqual(expect.objectContaining({
      ok: true,
      status: { code: 0, message: 'done' },
      outputs: [],
      artifacts: [],
      logs: [],
    }));
  });

  test('renderUI exposes docs icon for the selected tool', () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo Tool', [], 'demo', null);
      }
    }

    const tool = new DemoTool();
    tool.renderUI();

    const docsLink = document.getElementById('selectedToolDocsLink');
    expect(docsLink.classList.contains('hidden')).toBe(false);
    expect(docsLink.getAttribute('href')).toBe('/tool-docs/DemoTool.html');
    expect(docsLink.getAttribute('aria-label')).toBe('Demo Tool documentation');
  });

  test('Parameter and getSpec serialize required and unit metadata', () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo Tool', [
          new Parameter('Distance', 'Buffer distance', 'float', 500, null, 0, 10000, true, 'meters'),
          new Parameter('Units', 'Distance units', 'dropdown', 'meters', ['meters', 'kilometers'], null, null, true),
          new Parameter('Note', 'Optional note', 'text', ''),
        ], 'demo', null);
      }
    }

    const spec = new DemoTool().getSpec();
    expect(spec.parameters).toEqual([
      {
        name: 'Distance',
        description: 'Buffer distance',
        type: 'float',
        defaultValue: 500,
        options: undefined,
        min: 0,
        max: 10000,
        required: true,
        unit: 'meters',
      },
      {
        name: 'Units',
        description: 'Distance units',
        type: 'dropdown',
        defaultValue: 'meters',
        options: ['meters', 'kilometers'],
        min: undefined,
        max: undefined,
        required: true,
      },
      {
        name: 'Note',
        description: 'Optional note',
        type: 'text',
        defaultValue: '',
        options: undefined,
        min: undefined,
        max: undefined,
      },
    ]);
  });

  test('validateParameters enforces required, min/max, and options', async () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo Tool', [
          new Parameter('Name', 'Required label', 'text', '', null, null, null, true),
          new Parameter('Count', 'Bounded count', 'int', 5, null, 1, 10, true),
          new Parameter('Units', 'Allowed units', 'dropdown', 'meters', ['meters', 'kilometers'], null, null, true),
        ], 'demo', null);
        this.run = jest.fn();
      }
    }

    const tool = new DemoTool();
    expect(tool.validateParameters({ Name: '', Count: 0, Units: 'parsecs' })).toEqual({
      ok: false,
      errors: [
        'Name is required.',
        'Count must be at least 1.',
        'Units must be one of: meters, kilometers.',
      ],
    });
    expect(tool.validateParameters({ Name: 'Site A', Count: 5, Units: 'meters' })).toEqual({
      ok: true,
      errors: [],
    });
  });

  test('renderUI disables Execute button while required parameters are invalid', () => {
    class DemoTool extends Tool {
      constructor() {
        super('Demo Tool', [
          new Parameter('Prompt', 'Required prompt', 'text', '', null, null, null, true),
        ], 'demo', null);
      }
    }

    const tool = new DemoTool();
    tool.renderUI();

    const input = document.getElementById('param-Prompt');
    const executeButton = document.getElementById('toolExecuteButton');
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(executeButton.disabled).toBe(true);
    expect(executeButton.getAttribute('aria-disabled')).toBe('true');

    input.value = 'Buffer study parcels by 500 meters';
    input.dispatchEvent(new Event('input'));

    expect(executeButton.disabled).toBe(false);
    expect(executeButton.getAttribute('aria-disabled')).toBe('false');
  });
});
