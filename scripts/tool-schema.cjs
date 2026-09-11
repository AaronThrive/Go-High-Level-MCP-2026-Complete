'use strict';
const Ajv = require('ajv');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const options = { strict: false, allErrors: true, allowUnionTypes: true, coerceTypes: false, useDefaults: false, removeAdditional: false };
const draft7 = new Ajv(options);
const draft2020 = new Ajv2020(options);
addFormats(draft7);
addFormats(draft2020);
const validators = new Map();
class ToolInputError extends Error {}
function validateToolInput(name, args, schema) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError(`Arguments for ${name} must be an object`);
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    // Existing handwritten/OpenAPI-derived schemas use draft-07 syntax;
    // explicitly declared 2020-12 schemas use the matching validator.
    const ajv = schema.$schema?.includes('2020-12') ? draft2020 : draft7;
    validate = ajv.compile(schema);
    validators.set(key, validate);
  }
  if (!validate(args)) {
    const details = validate.errors.map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new ToolInputError(`Invalid arguments for ${name}: ${details}`);
  }
}
module.exports = { validateToolInput, ToolInputError };
