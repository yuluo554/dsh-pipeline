/**
 * Shared error vocabulary for dsh-pipeline. `code` is machine-routable (the
 * B2 matrix asserts on it); `message` is human-readable and mentions the
 * offending definition locations by node id / prompt index.
 */
export class PipelineError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
  }
}

export const ErrorCode = {
  schema: 'SCHEMA_INVALID',
  duplicateId: 'IR_DUPLICATE_ID',
  reservedId: 'IR_RESERVED_ID',
  unknownDependency: 'IR_UNKNOWN_DEPENDENCY',
  selfDependency: 'IR_SELF_DEPENDENCY',
  selfReference: 'IR_SELF_REFERENCE',
  dependencyCycle: 'IR_DEPENDENCY_CYCLE',
  unknownVariable: 'IR_UNKNOWN_VARIABLE',
  outputSchema: 'IR_OUTPUT_SCHEMA',
  unsupportedFeature: 'IR_UNSUPPORTED_FEATURE',
  store: 'STORE_ERROR',
  capability: 'CAPABILITY_MISSING',
  engine: 'ENGINE_ERROR',
} as const
