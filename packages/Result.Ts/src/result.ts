import { validationError, type ValidationError, type ValidationErrors } from './validation-error.js';

/** Common outcome flags for consumers that do not need the payload. */
export interface IResult {
  readonly isSuccess: boolean;
  readonly isFailure: boolean;
}

/** The successful branch; a failed result has no value property. */
export interface Success<T> extends IResult {
  readonly isSuccess: true;
  readonly isFailure: false;
  readonly value: T;
}

/** The failed branch; a successful result has no error property. */
export interface Failure<E> extends IResult {
  readonly isSuccess: false;
  readonly isFailure: true;
  readonly error: E;
}

/** Operations shared by both branches of a result. Callback errors propagate. */
export interface ResultOperations<T, E> {
  /** Evaluates exactly one callback and returns its value. */
  match<U, V>(onSuccess: (value: T) => U, onFailure: (error: E) => V): U | V;
  /** Awaits exactly one callback, accepting values and PromiseLike results. */
  matchAsync<U, V>(
    onSuccess: (value: T) => U | PromiseLike<U>,
    onFailure: (error: E) => V | PromiseLike<V>,
  ): Promise<U | V>;
  /** Returns the value or throws ResultAccessError with the failure as its cause. */
  valueOrThrow(): T;
}

/**
 * An explicit success or failure. One type parameter selects validation errors;
 * the second selects a domain error type. Narrow with isSuccess or isFailure.
 */
export type Result<T = void, E = ValidationErrors> =
  (Success<T> | Failure<E>) & ResultOperations<T, E>;

/** Outcome of an operation without a value or error payload. */
export type StatusResult = Result<void, void>;

/** Result whose failure accumulates every independent validation problem. */
export type ValidationResult<T> = Result<T, ValidationErrors>;

/** A factory-created success can be returned for any compatible error type. */
export type SuccessResult<T> = Success<T> & ResultOperations<T, never>;

/** A factory-created failure can be returned for any compatible value type. */
export type FailureResult<E> = Failure<E> & ResultOperations<never, E>;

/** Runtime guard required because TypeScript error types are erased. */
export type ErrorGuard<E> = (error: unknown) => error is E;

/** Thrown only when a caller explicitly requests a value from a failure. */
export class ResultAccessError<E = unknown> extends Error {
  /** Original failure, preserved by identity and also exposed as Error.cause. */
  readonly error: E;

  /** @param error Original failure payload. */
  constructor(error: E) {
    super('Cannot get the value of a failed result.', { cause: error });
    this.name = 'ResultAccessError';
    this.error = error;
  }
}

/** Builds operations around an immutable branch without relying on this binding. */
function operations<T, E>(branch: Success<T> | Failure<E>): ResultOperations<T, E> {
  return {
    match: (onSuccess, onFailure) => branch.isSuccess
      ? onSuccess(branch.value)
      : onFailure(branch.error),
    matchAsync: async (onSuccess, onFailure) => branch.isSuccess
      ? await onSuccess(branch.value)
      : await onFailure(branch.error),
    valueOrThrow: () => {
      if (branch.isFailure) throw new ResultAccessError(branch.error);
      return branch.value;
    },
  };
}

/** Creates a success for an operation without a value. */
export function success(): SuccessResult<void>;
/** @param value Successful payload; null and undefined are valid explicit values. */
export function success<T>(value: T): SuccessResult<T>;
export function success<T>(value?: T): SuccessResult<T | undefined> {
  const branch = Object.freeze({ isSuccess: true, isFailure: false, value } as const);
  return Object.freeze({ ...branch, ...operations<T | undefined, never>(branch) });
}

/** Creates a failure for an operation without an error payload. */
export function failure(): FailureResult<void>;
/** @param error Domain error; existing exception objects are preserved by identity. */
export function failure<E>(error: E): FailureResult<E>;
export function failure<E>(error?: E): FailureResult<E | undefined> {
  const branch = Object.freeze({ isSuccess: false, isFailure: true, error } as const);
  return Object.freeze({ ...branch, ...operations<never, E | undefined>(branch) });
}

/**
 * Creates a validation failure, copying and freezing errors and member names.
 * @param error One problem or a nonempty list of problems, in reporting order.
 * @throws RangeError if the supplied list is empty.
 */
export function validationFailure(
  error: ValidationError | readonly ValidationError[],
): FailureResult<ValidationErrors> {
  const errors = 'errorMessage' in error ? [error] : error;
  const [first, ...rest] = errors;
  if (first === undefined) throw new RangeError('A validation failure requires at least one error.');
  const copy = (item: ValidationError): ValidationError =>
    validationError(item.errorMessage, item.memberNames);
  const snapshot: ValidationErrors = Object.freeze([copy(first), ...rest.map(copy)]);
  return failure(snapshot);
}

/** Extracts the successful tuple, preserving each input position and type. */
export type CombinedValues<R extends readonly ValidationResult<unknown>[]> = {
  readonly [K in keyof R]: R[K] extends Result<infer T, ValidationErrors> ? T : never;
};

/**
 * Collects every validation error, in input order, or returns a frozen value tuple.
 * Inputs are already evaluated; combine neither runs validators nor starts tasks.
 * An empty input is a successful empty tuple. Tuple arity is unrestricted.
 * @param results Independent validation outcomes, including spread readonly arrays.
 */
export function combine<const R extends readonly ValidationResult<unknown>[]>(
  ...results: R
): ValidationResult<CombinedValues<R>> {
  const values: unknown[] = [];
  const errors: ValidationError[] = [];
  for (const result of results) {
    if (result.isSuccess) values.push(result.value);
    else errors.push(...result.error);
  }
  if (errors.length > 0) return validationFailure(errors);
  // All branches succeeded: values now has exactly one entry per input position.
  return success(Object.freeze(values) as CombinedValues<R>);
}

/**
 * Wraps a synchronous factory, catching only errors accepted by the guard.
 * @param factory Factory enforcing the domain rules; use fromTryAsync for promises.
 * @param isExpected Guard selecting the exception types to turn into failure values.
 * @throws Any thrown value rejected by the guard, unchanged.
 */
export function fromTry<T, E>(factory: () => T, isExpected: ErrorGuard<E>): Result<T, E> {
  try {
    return success(factory());
  } catch (error: unknown) {
    if (isExpected(error)) return failure(error);
    throw error;
  }
}

/**
 * Awaits a factory and catches only errors accepted by the guard.
 * @param factory Factory returning a value, a promise, or a thenable.
 * @param isExpected Guard selecting expected failures; rejected values propagate.
 */
export async function fromTryAsync<T, E>(
  factory: () => T | PromiseLike<T>,
  isExpected: ErrorGuard<E>,
): Promise<Result<T, E>> {
  try {
    return success(await factory());
  } catch (error: unknown) {
    if (isExpected(error)) return failure(error);
    throw error;
  }
}

/** Factories grouped like the .NET API; named exports support individual imports. */
export const Result = Object.freeze({
  success, failure, validationFailure, combine, fromTry, fromTryAsync,
});
