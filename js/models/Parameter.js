class Parameter {
    constructor(name, description, type, defaultValue, options = null, min = null, max = null, required = false, unit = null) {
        const config = typeof required === 'object' && required !== null ? required : { required, unit };
        this.name = name;
        this.description = description;
        this.type = type;
        this.defaultValue = defaultValue;
        this.options = options;
        this.min = min;
        this.max = max;
        this.required = Boolean(config.required);
        this.unit = config.unit || null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Parameter };
} else {
    window.Parameter = Parameter;
}