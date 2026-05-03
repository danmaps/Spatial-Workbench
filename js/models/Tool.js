const stateModule = require('../state');

class Tool {
    constructor(name, parameters = [], description, map) {
        this.name = name;
        this.parameters = parameters;
        this.description = description;
        this.map = map;

        // Wrap the UI execution method in the constructor
        this.execute = this.reRenderOnExecute(this.execute.bind(this));

        // Messages to store status info
        this.statusMessage = `${name} executed successfully.`;
        this.statusCode = 0;

        //SUCCESS = 0;
        //GENERAL_ERROR = 1;
        //INVALID_INPUT = 2;
        //EXECUTION_FAILED = 3;
        //RESOURCE_NOT_FOUND = 4;
        //PERMISSION_DENIED = 5;
        //TIMEOUT = 6;
        //EXTERNAL_DEPENDENCY_ERROR = 7; 
    }

    // Method to set status and message
    setStatus(code, message) {
        this.statusCode = code;
        this.statusMessage = message;
    }

    // Method to get the current status
    getStatus() {
        return {
            code: this.statusCode,
            message: this.statusMessage
        };
    }

    // Describe this tool in a machine-readable way
    getSpec() {
        const params = (this.parameters || []).map((p) => ({
            name: p.name,
            description: p.description,
            type: p.type,
            defaultValue: p.defaultValue,
            options: p.options || undefined,
            min: p.min ?? undefined,
            max: p.max ?? undefined,
        }));
        return {
            key: this.constructor?.name || this.name,
            name: this.name,
            description: this.description || '',
            parameters: params,
        };
    }

    renderUI(paramValues = {}) {
        // console.log(`Rendering UI for ${this.constructor.name}`);
        const toolSelection = document.getElementById('toolSelection');
        const toolDetails = document.getElementById('toolDetails');
        const toolContent = document.getElementById('toolContent');

        toolSelection.style.display = 'none';
        toolDetails.classList.remove('hidden');
        toolContent.innerHTML = ''; // Clear existing content

        const toolName = document.createElement('h2');
        // add tool name to toolContent as attribute "tool"
        toolName.textContent = this.name;
        toolContent.appendChild(toolName);

        this.parameters.forEach(param => {
            const paramLabel = document.createElement('label');
            paramLabel.classList.add('param-label');
            paramLabel.textContent = `${param.name} `;
            paramLabel.htmlFor = `param-${param.name}`;

            let paramInput;
            let paramSlider;

            const hasValue = Object.prototype.hasOwnProperty.call(paramValues, param.name);
            const value = hasValue ? paramValues[param.name] : param.defaultValue;

            if (param.type === "dropdown") {
                paramInput = document.createElement('select');
                paramInput.id = `param-${param.name}`;
            } else if (param.type === "int" || param.type === "float") {
                // Create container for number input and slider
                const numberContainer = document.createElement('div');
                numberContainer.classList.add('number-input-container');

                // Create number input
                paramInput = document.createElement('input');
                paramInput.type = "number";
                paramInput.id = `param-${param.name}`;
                paramInput.value = value;
                paramInput.step = param.type === "int" ? "1" : "0.1";
                
                // Add min/max if defined
                if (param.min !== undefined) paramInput.min = param.min;
                if (param.max !== undefined) paramInput.max = param.max;

                // Create slider
                paramSlider = document.createElement('input');
                paramSlider.type = "range";
                paramSlider.classList.add('param-slider');
                paramSlider.value = value;
                paramSlider.step = param.type === "int" ? "1" : "0.1";
                
                // Set min/max for slider
                paramSlider.min = param.min !== undefined ? param.min : 0;
                paramSlider.max = param.max !== undefined ? param.max : 100;

                // Link slider and input
                paramInput.addEventListener('input', (e) => {
                    paramSlider.value = e.target.value;
                });
                
                paramSlider.addEventListener('input', (e) => {
                    paramInput.value = e.target.value;
                });

                numberContainer.appendChild(paramInput);
                numberContainer.appendChild(paramSlider);
                
                // Modify the later append logic to use the container
                toolContent.appendChild(paramLabel);
                toolContent.appendChild(numberContainer);
                toolContent.appendChild(document.createElement('br'));
                return; // Use return instead of continue
            } else if (param.type === "boolean") {
                paramInput = document.createElement('input');
                paramInput.type = "checkbox";
                paramInput.id = `param-${param.name}`;
                paramInput.checked = !!value;
            } else if (param.type === "text") {
                paramInput = document.createElement('input');
                paramInput.type = "text";
                paramInput.id = `param-${param.name}`;
                paramInput.value = value;
            } else if (param.type === "file") {
                paramInput = document.createElement('input');
                paramInput.type = "file";
                paramInput.id = `param-${param.name}`;
            }
            
            // Common setup for non-number inputs
            if (paramInput) {
                toolContent.appendChild(paramLabel);
                toolContent.appendChild(paramInput);
                toolContent.appendChild(document.createElement('br'));

                paramInput.addEventListener('keydown', function(event) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        executeButton.click();
                    }
                });
            }
        });

        // Create and append the Execute button after adding all parameters
        const executeButton = document.createElement('button');
        executeButton.textContent = 'Execute';
        executeButton.addEventListener('click', () => this.execute());
        toolContent.appendChild(executeButton);

    }

    collectParamsFromDOM() {
        const params = {};
        this.parameters.forEach(param => {
            const el = document.getElementById(`param-${param.name}`);
            if (!el) return;

            if (param.type === 'boolean') {
                params[param.name] = !!el.checked;
            } else if (param.type === 'int') {
                const value = parseInt(el.value, 10);
                params[param.name] = Number.isNaN(value) ? param.defaultValue : value;
            } else if (param.type === 'float') {
                const value = parseFloat(el.value);
                params[param.name] = Number.isNaN(value) ? param.defaultValue : value;
            } else if (param.type === 'file') {
                params[param.name] = el.files && el.files.length ? el.files[0] : null;
            } else {
                params[param.name] = el.value;
            }
        });
        return params;
    }

    getExecutionContext() {
        return {
            map: this.map || (typeof stateModule.getMap === 'function' ? stateModule.getMap() : null),
            state: typeof stateModule.getState === 'function' ? stateModule.getState() : null,
            tool: this,
        };
    }

    async handleRunResult(result) {
        if (!result || !result.download) return;
        const { filename = 'download.json', mimeType = 'application/json', data = '' } = result.download;
        const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    async execute() {
        const params = this.collectParamsFromDOM();
        const context = this.getExecutionContext();
        const result = await this.run(params, context);
        await this.handleRunResult(result);
        return result;
    }

    async run(_params, _context) {
        throw new Error(`${this.name} must implement run(params, context)`);
    }

    reRenderOnExecute(exec) {
        return async () => {
            const toolContent = document.getElementById('toolContent');
            const paramValues = this.collectParamsFromDOM();
            
            // Start loading animation (pulsing background of toolContent div)
            toolContent.classList.add('pulsate');
            
            try {
                await exec();
            } catch (error) {
                // Set error status
                this.setStatus(1, error?.message || 'Execution failed');
                console.error('Error during execution:', error);
            } finally {
                // Stop loading animation
                toolContent.classList.remove('pulsate');
                
                // log the status
                const status = this.getStatus();
                const logStatus = status.code !== 0 ? console.warn : console.log;
                logStatus("Status:", status.code, status.message);

                // Update the status message in the UI
                document.getElementById('statusMessage').style.display = 'block';

                // remove whatever alert-* class is currently applied
                const oldStatusMessage = document.getElementById('statusMessageText');
                oldStatusMessage.classList.remove('alert-success', 'alert-danger');

                // if status.code is 0, make the status message a success message
                const alertType = status.code === 0 ? 'success' : 'danger';
                document.getElementById('statusMessageText').classList.add(`alert-${alertType}`);

                const statusMessage = document.getElementById('statusMessageText');
                statusMessage.textContent = status.message;
                
                // Re-render the UI
                this.renderUI(paramValues);
            }
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Tool };
} else {
    window.Tool = Tool;
}
