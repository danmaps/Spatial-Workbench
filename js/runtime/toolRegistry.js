const toolDescriptors = [
  { exportName: 'AddDataTool', load: () => require('../tools/AddDataTool').AddDataTool },
  { exportName: 'BufferTool', load: () => require('../tools/BufferTool').BufferTool },
  { exportName: 'ExportTool', load: () => require('../tools/ExportTool').ExportTool },
  { exportName: 'GenerateAIFeatures', load: () => require('../tools/GenerateAIFeatures').GenerateAIFeatures },
  { exportName: 'GroupTool', load: () => require('../tools/GroupTool').GroupTool },
  { exportName: 'RandomPointsTool', load: () => require('../tools/RandomPointsTool').RandomPointsTool },
  { exportName: 'AddAIGeneratedFieldTool', load: () => require('../tools/AddAIGeneratedFieldTool').AddAIGeneratedFieldTool },
  { exportName: 'ConvertTextToNumericTool', load: () => require('../tools/ConvertTextToNumericTool').ConvertTextToNumericTool },
];

function loadToolClass(descriptor) {
  return descriptor.load();
}

function loadToolClasses() {
  return toolDescriptors.map(loadToolClass);
}

function getToolClasses() {
  return loadToolClasses();
}

function instantiateTools() {
  return toolDescriptors.map((descriptor) => {
    const ToolClass = loadToolClass(descriptor);
    return new ToolClass();
  });
}

function getToolByKey(toolKey) {
  const descriptor = toolDescriptors.find((entry) => entry.exportName === toolKey);
  if (descriptor) {
    const ToolClass = loadToolClass(descriptor);
    return new ToolClass();
  }
  return null;
}

module.exports = {
  getToolClasses,
  instantiateTools,
  getToolByKey,
};
