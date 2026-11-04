/** A validation problem, optionally associated with one or more input members. */
export interface ValidationError {
  readonly errorMessage: string;
  readonly memberNames: readonly string[];
}

/** A validation failure always contains at least one problem. */
export type ValidationErrors = readonly [ValidationError, ...ValidationError[]];

/**
 * Creates a frozen validation problem and defensively copies its member names.
 * @param errorMessage Human-readable explanation of the validation failure.
 * @param memberNames Input fields concerned by the failure.
 */
export function validationError(
  errorMessage: string,
  memberNames: readonly string[] = [],
): ValidationError {
  return Object.freeze({ errorMessage, memberNames: Object.freeze([...memberNames]) });
}
