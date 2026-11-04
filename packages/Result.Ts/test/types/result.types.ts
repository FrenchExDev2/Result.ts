import { expectTypeOf } from 'vitest';
import { Result, type Result as Outcome, type StatusResult, type ValidationErrors } from '../../src/index.js';

/** Compile-time contract: payload access requires a branch check. */
export function narrowing(result: Outcome<number, Error>): void {
  // @ts-expect-error An unchecked result has no universally accessible value.
  result.value;
  // @ts-expect-error An unchecked result has no universally accessible error.
  result.error;
  if (result.isSuccess) {
    expectTypeOf(result.value).toEqualTypeOf<number>();
    // @ts-expect-error A success does not expose an error.
    result.error;
  } else {
    expectTypeOf(result.error).toEqualTypeOf<Error>();
    // @ts-expect-error A failure does not expose a value.
    result.value;
  }
  if (result.isFailure) expectTypeOf(result.error).toEqualTypeOf<Error>();
  else expectTypeOf(result.value).toEqualTypeOf<number>();
  // @ts-expect-error Both match branches are mandatory.
  result.match(value => value);
  // @ts-expect-error The flags are readonly.
  result.isSuccess = true;
}

/** Compile-time contract: generic defaults, tuples and callbacks retain types. */
export function inference(result: Outcome<number>): void {
  expectTypeOf(result.match(value => value, errors => errors))
    .toEqualTypeOf<number | ValidationErrors>();
  const combined = Result.combine(Result.success(42), Result.success('Ada'));
  expectTypeOf(combined.valueOrThrow()).toEqualTypeOf<readonly [number, string]>();
  expectTypeOf(Result.combine().valueOrThrow()).toEqualTypeOf<readonly []>();
  const statuses: StatusResult[] = [Result.success(), Result.failure()];
  expectTypeOf(statuses[0]).toEqualTypeOf<StatusResult | undefined>();
  const empty: Outcome = Result.success();
  expectTypeOf(empty.valueOrThrow()).toEqualTypeOf<void>();
  // @ts-expect-error combine accepts validation errors, not arbitrary domain errors.
  Result.combine(Result.failure(new Error('domain')));
  // @ts-expect-error The tuple is readonly.
  combined.valueOrThrow()[0] = 0;
  // @ts-expect-error A runtime guard is required for selectively caught errors.
  Result.fromTry(() => 42);
}
