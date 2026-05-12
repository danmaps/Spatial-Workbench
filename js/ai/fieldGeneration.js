const { requestStructuredData } = require('./requestStructuredData');

function coerceGeneratedValue(rawValue, outputType) {
  if (rawValue === null || rawValue === undefined) return null;

  if (outputType === 'number') {
    const asNumber = Number(rawValue);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  if (outputType === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') {
      const normalized = rawValue.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }

  return String(rawValue);
}

async function generateFieldValues({ features, sourceFields, instruction, outputFieldName, outputType }) {
  const payload = features.map((feature) => ({
    id: feature.properties.__id,
    geometryType: feature.geometry ? feature.geometry.type : null,
    properties: sourceFields.length
      ? sourceFields.reduce((acc, fieldName) => {
          acc[fieldName] = feature.properties[fieldName];
          return acc;
        }, {})
      : feature.properties,
  }));

  const systemPrompt = [
    'You generate one field value per GIS feature.',
    'Return only JSON with shape {"results":[{"id":"...","value":...}]}',
    `The target output field is "${outputFieldName}" and its type is "${outputType}".`,
    'Do not omit ids. Keep output values grounded in the provided feature properties.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    instruction,
    outputFieldName,
    outputType,
    sourceFields,
    features: payload,
  });

  const response = await requestStructuredData({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 1400,
  });

  const results = Array.isArray(response && response.results) ? response.results : [];
  const byId = new Map();
  for (const row of results) {
    if (!row || !row.id) continue;
    byId.set(row.id, coerceGeneratedValue(row.value, outputType));
  }

  return features.map((feature) => ({
    id: feature.properties.__id,
    value: byId.has(feature.properties.__id) ? byId.get(feature.properties.__id) : null,
  }));
}

module.exports = {
  generateFieldValues,
  coerceGeneratedValue,
};
