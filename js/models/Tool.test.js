const { Tool } = require('./Tool');

jest.mock('../state', () => ({
  getState: jest.fn(() => ({ layers: ['a', 'b'] })),
}));

describe('Tool base architecture', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toolSelection" style="display:block"></div>
      <div id="toolDetails" class="hidden"></div>
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
      download: {
        filename: 'out.geojson',
        mimeType: 'application/json',
        data: '{"ok":true}'
      }
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
});
