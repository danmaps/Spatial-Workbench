const { CONTRACT_VERSION, COMPONENT_TYPES } = require('../contracts');
const { getHeadlessToolCatalog } = require('../../headless-runtime');

const OPENUI_ROOT_LAYOUTS = Object.freeze({
  CompactCard: 'compact',
  Stack: 'compact',
  ReviewWorkspace: 'workspace',
  Workspace: 'workspace',
});

const OPENUI_COMPONENT_CATALOG = Object.freeze([
  {
    name: 'LayerInput',
    signature: 'LayerInput({ componentId, toolKey, parameterName, selectedLayerId, targetScope })',
    description: 'Selects a geometry-compatible input layer and explicit analysis scope ("layer" or "selection").',
  },
  {
    name: 'SpatialSelection',
    signature: 'SpatialSelection({ componentId, layerId, mode, emptySelectionPolicy })',
    description: 'Displays and edits the selected feature subset for the target layer.',
  },
  {
    name: 'ToolParameters',
    signature: 'ToolParameters({ componentId, toolKey, draftParams, lockedParams })',
    description: 'Renders editable draft parameters derived from the runtime tool schema with explicit units and EPSG:4326 disclosures.',
  },
  {
    name: 'SpatialResult',
    signature: 'SpatialResult({ componentId, primaryOutputLayerId, layerIds, surfaceVariant, attributeMode })',
    description: 'Displays preserved source and output geometry on a map preview with linked feature attributes.',
  },
  {
    name: 'ExecutionReceipt',
    signature: 'ExecutionReceipt({ componentId, toolKey })',
    description: 'Displays grounded runtime execution metadata, spatial warnings, and downloadable artifacts.',
  },
]);

function generateOpenUISystemPrompt(toolCatalog = null) {
  const tools = Array.isArray(toolCatalog) ? toolCatalog : getHeadlessToolCatalog();
  const layerTools = tools.filter((t) => t.stateMode === 'layers');

  const componentLines = OPENUI_COMPONENT_CATALOG.map(
    (c) => `- ${c.signature}: ${c.description}`
  ).join('\n');

  const toolLines = layerTools
    .map((t) => {
      const params = (t.parameters || [])
        .map((p) => `${p.name} (${p.type}${p.options ? `: ${p.options.join('|')}` : ''}${p.required ? ', required' : ''})`)
        .join(', ');
      return `- ${t.key} ("${t.name}"): ${params}`;
    })
    .join('\n');

  return [
    `You compose GIS interfaces using OpenUI Lang for Spatial Workbench (${CONTRACT_VERSION}).`,
    'Root layout containers:',
    '- CompactCard([...components]): inline conversational response card stack',
    '- ReviewWorkspace([...components]): two-column split review workspace',
    '',
    'Registered GIS components:',
    componentLines,
    '',
    'Callable spatial tools:',
    toolLines,
    '',
    'Rules:',
    '1. Only use registered components and tool keys.',
    '2. Proposed parameter values populate a user-editable draft; never claim an operation has completed before execution.',
    '3. Keep analysis scope explicit with targetScope ("layer" or "selection").',
  ].join('\n');
}

function extractBalancedCalls(sourceText) {
  const calls = [];
  const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\{/g;
  let match;

  while ((match = callRegex.exec(sourceText)) !== null) {
    const componentName = match[1];
    if (OPENUI_ROOT_LAYOUTS[componentName]) continue;

    const braceStart = sourceText.indexOf('{', match.index);
    if (braceStart === -1) break;

    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    let braceEnd = -1;

    for (let i = braceStart; i < sourceText.length; i += 1) {
      const ch = sourceText[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quoteChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        continue;
      }

      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          braceEnd = i;
          break;
        }
      }
    }

    if (braceEnd !== -1) {
      const rawObjectText = sourceText.slice(braceStart, braceEnd + 1);
      calls.push({
        type: componentName,
        rawObjectText,
        complete: true,
      });
      callRegex.lastIndex = braceEnd + 1;
    } else {
      calls.push({
        type: componentName,
        rawObjectText: null,
        complete: false,
      });
      break;
    }
  }

  return calls;
}

function parseRelaxedJsonObject(rawObjectText) {
  if (!rawObjectText) return {};
  try {
    return JSON.parse(rawObjectText);
  } catch (_) {
    // Normalize unquoted object keys in OpenUI Lang expressions into valid JSON
    const normalized = rawObjectText
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(normalized);
    } catch (_err) {
      return {};
    }
  }
}

function parseOpenUILang(input, options = {}) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const streamComplete = options.streamComplete !== undefined
      ? Boolean(options.streamComplete)
      : (input.streamComplete !== false);
    return {
      contractVersion: input.contractVersion || CONTRACT_VERSION,
      layout: input.layout === 'workspace' ? 'workspace' : 'compact',
      streamComplete,
      components: Array.isArray(input.components) ? input.components : [],
    };
  }

  const text = String(input || '').trim();
  const rootMatch = text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  const rootName = rootMatch ? rootMatch[1] : 'CompactCard';
  const layout = OPENUI_ROOT_LAYOUTS[rootName] || (options.layout === 'workspace' ? 'workspace' : 'compact');

  const hasClosingRoot = /\[\s*[\s\S]*\]\s*\)\s*$/.test(text);
  const extractedCalls = extractBalancedCalls(text);
  const hasIncompleteCall = extractedCalls.some((call) => !call.complete);
  const inferredComplete = Boolean(text.length > 0 && hasClosingRoot && !hasIncompleteCall);
  const streamComplete = options.streamComplete !== undefined
    ? Boolean(options.streamComplete && inferredComplete)
    : inferredComplete;

  const components = extractedCalls
    .filter((call) => call.complete)
    .map((call, index) => {
      const props = parseRelaxedJsonObject(call.rawObjectText);
      const surfaceVariant = props.surfaceVariant || layout;
      return {
        ...props,
        type: call.type,
        componentId: props.componentId || `${call.type.toLowerCase()}-${index + 1}`,
        ...(call.type === 'SpatialResult' ? { surfaceVariant } : {}),
        streamComplete,
      };
    });

  return {
    contractVersion: options.contractVersion || CONTRACT_VERSION,
    layout,
    rootContainer: rootName,
    streamComplete,
    components,
    supportedComponentTypes: [...COMPONENT_TYPES],
  };
}

module.exports = {
  OPENUI_ROOT_LAYOUTS,
  OPENUI_COMPONENT_CATALOG,
  generateOpenUISystemPrompt,
  parseOpenUILang,
};
