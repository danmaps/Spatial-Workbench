const { getToolDocPath, renderDocsIndex, renderToolDocPage } = require('./tool-docs');

describe('tool docs renderer', () => {
  const specs = [
    {
      key: 'BufferTool',
      name: 'Buffer',
      description: 'Makes a buffer around the input layer',
      parameters: [
        { name: 'Distance', type: 'float', description: 'Buffer distance', defaultValue: 10 },
      ],
    },
    {
      key: 'ExportTool',
      name: 'Export',
      description: 'Export data',
      parameters: [],
    },
  ];

  test('builds stable per-tool doc paths', () => {
    expect(getToolDocPath('BufferTool')).toBe('/tool-docs/BufferTool.html');
  });

  test('renders docs index with tool links', () => {
    const html = renderDocsIndex(specs);
    expect(html).toContain('Tool docs');
    expect(html).toContain('/tool-docs/BufferTool.html');
    expect(html).toContain('/tool-docs/ExportTool.html');
  });

  test('renders a tool page with parameter and spec sections', () => {
    const html = renderToolDocPage(specs[0], specs);
    expect(html).toContain('Buffer');
    expect(html).toContain('Parameters');
    expect(html).toContain('Spec JSON');
    expect(html).toContain('Distance');
    expect(html).toContain('&quot;key&quot;: &quot;BufferTool&quot;');
  });
});
