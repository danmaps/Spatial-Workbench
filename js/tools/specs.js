// Static tool specs for server-side API use.
// Keep in sync with tool constructors.

const tools = [
  {
    key: 'AddDataTool',
    name: 'Add Data',
    description: 'Upload GeoJSON or tabular data (CSV/XLSX) with coordinates',
    parameters: [
      { name: 'Input', description: 'data to add', type: 'file', defaultValue: '' },
      { name: 'Lat Column', description: 'latitude column name', type: 'dropdown', defaultValue: '' },
      { name: 'Long Column', description: 'longitude column name', type: 'dropdown', defaultValue: '' },
      { name: 'Override Columns', description: 'manually specify columns', type: 'boolean', defaultValue: false },
    ],
  },
  {
    key: 'BufferTool',
    name: 'Buffer',
    description: 'Makes a buffer around the input layer',
    parameters: [
      { name: 'Input Layer', description: 'The input layer to buffer', type: 'dropdown', defaultValue: '' },
      { name: 'Distance', description: 'The distance', type: 'float', defaultValue: 10 },
      {
        name: 'Units',
        description: 'The units for the distance',
        type: 'dropdown',
        defaultValue: 'miles',
        options: ['feet', 'miles', 'kilometers', 'degrees'],
      },
    ],
  },
  {
    key: 'ExportTool',
    name: 'Export',
    description: 'Export data',
    parameters: [
      { name: 'Layer', description: 'layer to export', type: 'dropdown', defaultValue: '' },
      { name: 'Format', description: 'format to export', type: 'dropdown', defaultValue: 'geojson' },
    ],
  },
  {
    key: 'GenerateAIFeatures',
    name: 'Generate AI Features',
    description: 'Generate features from a prompt using the AI endpoint',
    parameters: [
      { name: 'Prompt', description: 'The prompt to generate AI features', type: 'text', defaultValue: '' },
    ],
  },
  {
    key: 'GroupTool',
    name: 'Group',
    description: 'Group nearby features into a single layer',
    parameters: [
      { name: 'Layer', description: 'layer to group', type: 'dropdown', defaultValue: '' },
      { name: 'Distance', description: 'distance threshold', type: 'float', defaultValue: 10 },
      {
        name: 'Units',
        description: 'The units for the distance',
        type: 'dropdown',
        defaultValue: 'miles',
        options: ['feet', 'miles', 'kilometers', 'degrees'],
      },
    ],
  },
  {
    key: 'RandomPointsTool',
    name: 'Random Points',
    description: 'Adds random points within selected polygon',
    parameters: [
      { name: 'Points Count', description: 'Number of random points to generate.', type: 'int', defaultValue: 10 },
      { name: 'Inside Polygon', description: 'Generate points inside polygon', type: 'boolean', defaultValue: false },
      { name: 'Polygon', description: 'Polygon to add random points within.', type: 'dropdown', defaultValue: '' },
    ],
  },
];

module.exports = { tools };
