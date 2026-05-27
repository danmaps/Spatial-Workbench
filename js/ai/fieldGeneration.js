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

async function generateFieldValueForFeature({ feature, sourceFields, instruction, outputFieldName, outputType }) {
  const payload = {
    id: feature.properties.__id,
    geometryType: feature.geometry ? feature.geometry.type : null,
    properties: sourceFields.length
      ? sourceFields.reduce((acc, fieldName) => {
          acc[fieldName] = feature.properties[fieldName];
          return acc;
        }, {})
      : feature.properties,
  };

  const systemPrompt = [
    'You generate exactly one field value for one GIS feature.',
    'Return only JSON with shape {"id":"...","value":...}.',
    `The target output field is "${outputFieldName}" and its type is "${outputType}".`,
    'Keep the output grounded in the provided feature properties.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    instruction,
    outputFieldName,
    outputType,
    sourceFields,
    feature: payload,
  });

  const response = await requestStructuredData({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 600,
  });

  return {
    id: feature.properties.__id,
    value: coerceGeneratedValue(response && response.value, outputType),
  };
}

// Process features in parallel batches (concurrency limit = 5) to avoid
// sequential await overhead while not overwhelming the AI API.
async function generateFieldValues({ features, sourceFields, instruction, outputFieldName, outputType }) {
  const CONCURRENCY = 5;
  const results = new Array(features.length);

  for (let i = 0; i < features.length; i += CONCURRENCY) {
    const batch = features.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((feature) =>
        generateFieldValueForFeature({
          feature,
          sourceFields,
          instruction,
          outputFieldName,
          outputType,
        })
      )
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}

module.exports = {
  generateFieldValueForFeature,
  generateFieldValues,
  coerceGeneratedValue,
};
