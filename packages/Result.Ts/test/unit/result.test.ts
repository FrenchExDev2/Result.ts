import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  Result, ResultAccessError, validationError,
  type Result as Outcome, type StatusResult, type ValidationError, type ValidationResult,
} from '../../src/index.js';

class InvalidNameError extends Error {
  readonly code = 'INVALID_NAME';
}
const isInvalidName = (error: unknown): error is InvalidNameError => error instanceof InvalidNameError;

describe('success and failure', () => {
  it('creates distinct, immutable branches with complementary flags', () => {
    const ok = Result.success(42);
    const failed = Result.failure('missing');
    expect(ok).toMatchObject({ isSuccess: true, isFailure: false, value: 42 });
    expect(failed).toMatchObject({ isSuccess: false, isFailure: true, error: 'missing' });
    expect('error' in ok).toBe(false);
    expect('value' in failed).toBe(false);
    expect(Object.isFrozen(ok)).toBe(true);
    expect(Object.isFrozen(failed)).toBe(true);
    expect(() => Object.assign(ok, { isSuccess: false })).toThrow(TypeError);
    expect(() => Object.assign(failed, { error: 'changed' })).toThrow(TypeError);
  });

  it('supports operations without payloads', () => {
    const ok: StatusResult = Result.success();
    const failed: StatusResult = Result.failure();
    expect(ok.valueOrThrow()).toBeUndefined();
    expect(failed.match(() => 'unexpected', () => 'failed')).toBe('failed');
    expect(failed.isFailure).toBe(true);
  });

  it.each([0, false, '', null, undefined])('preserves an explicit value %s', (value) => {
    expect(Result.success(value).valueOrThrow()).toBe(value);
  });

  it('preserves domain payloads without freezing consumer-owned values', () => {
    const value = { balance: 10 };
    const error = new InvalidNameError('Empty name');
    expect(Result.success(value).valueOrThrow()).toBe(value);
    expect(Result.failure(error).error).toBe(error);
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(error)).toBe(false);
    value.balance = 20;
    expect(Result.success(value).value.balance).toBe(20);
  });

  it('retains primitive and nullish error payloads', () => {
    for (const error of [null, undefined, 0, false, '']) {
      expect(Result.failure(error).error).toBe(error);
    }
  });

  it('throws a diagnostic access error carrying the original failure', () => {
    const error = new InvalidNameError('Empty name');
    const failed = Result.failure(error);
    expect(() => failed.valueOrThrow()).toThrow(ResultAccessError);
    try {
      failed.valueOrThrow();
    } catch (caught: unknown) {
      expect(caught).toBeInstanceOf(ResultAccessError);
      if (!(caught instanceof ResultAccessError)) throw caught;
      expect(caught.name).toBe('ResultAccessError');
      expect(caught.error).toBe(error);
      expect(caught.cause).toBe(error);
      expect(caught.message).toBe('Cannot get the value of a failed result.');
    }
  });
});

describe('matching', () => {
  it('calls exactly the success branch and permits detached methods', () => {
    const onFailure = vi.fn();
    const { match, valueOrThrow } = Result.success(21);
    expect(match(value => value * 2, onFailure)).toBe(42);
    expect(valueOrThrow()).toBe(21);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('calls exactly the failure branch with the original domain error', () => {
    const error = new InvalidNameError('Name required');
    const onSuccess = vi.fn();
    const onFailure = vi.fn((caught: InvalidNameError) => caught.code);
    expect(Result.failure(error).match(onSuccess, onFailure)).toBe('INVALID_NAME');
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('supports different return types from the two branches', () => {
    const result: Outcome<number, string> = Result.success(42);
    const matched = result.match(value => value, error => error);
    expectTypeOf(matched).toEqualTypeOf<number | string>();
    expect(matched).toBe(42);
  });

  it('propagates synchronous callback errors from either branch', () => {
    const error = new TypeError('callback failed');
    const throws = (): never => { throw error; };
    expect(() => Result.success().match(throws, vi.fn())).toThrow(error);
    expect(() => Result.failure().match(vi.fn(), throws)).toThrow(error);
  });

  it('awaits only the selected success callback', async () => {
    const onFailure = vi.fn();
    const { matchAsync } = Result.success(21);
    await expect(matchAsync(async value => value * 2, onFailure)).resolves.toBe(42);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('awaits only the selected failure callback', async () => {
    const onSuccess = vi.fn();
    await expect(Result.failure('missing').matchAsync(onSuccess, async error => error.length))
      .resolves.toBe(7);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('accepts synchronous callbacks in matchAsync', async () => {
    await expect(Result.success(2).matchAsync(value => value + 1, () => 0)).resolves.toBe(3);
    await expect(Result.failure('bad').matchAsync(() => 0, error => error.length)).resolves.toBe(3);
  });

  it('turns a synchronous callback throw into a rejection', async () => {
    const error = new TypeError('callback');
    const throws = (): never => { throw error; };
    await expect(Result.success().matchAsync(throws, vi.fn())).rejects.toBe(error);
    await expect(Result.failure().matchAsync(vi.fn(), throws)).rejects.toBe(error);
  });

  it('propagates rejected callbacks from either branch', async () => {
    const error = new TypeError('callback');
    const rejects = async (): Promise<never> => { throw error; };
    await expect(Result.success().matchAsync(rejects, vi.fn())).rejects.toBe(error);
    await expect(Result.failure().matchAsync(vi.fn(), rejects)).rejects.toBe(error);
  });
});

describe('validation and combine', () => {
  it('creates a frozen problem with optional copied member names', () => {
    const members = ['name'];
    const error = validationError('Required', members);
    members.push('email');
    expect(error).toEqual({ errorMessage: 'Required', memberNames: ['name'] });
    expect(validationError('Invalid').memberNames).toEqual([]);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.memberNames)).toBe(true);
  });

  it('accepts a single error and creates a nonempty list', () => {
    const error = validationError('Name required', ['name']);
    const result = Result.validationFailure(error);
    expect(result.error).toEqual([error]);
    expect(result.error[0].errorMessage).toBe('Name required');
    expect(Object.isFrozen(result.error)).toBe(true);
  });

  it('takes a defensive snapshot of every nested validation record', () => {
    const members = ['name'];
    const first = { errorMessage: 'Required', memberNames: members };
    const second = { errorMessage: 'Invalid email', memberNames: ['email'] };
    const errors = [first, second];
    const result = Result.validationFailure(errors);
    first.errorMessage = 'changed';
    second.memberNames.push('other');
    members[0] = 'changed';
    errors.length = 0;
    expect(result.error).toEqual([
      { errorMessage: 'Required', memberNames: ['name'] },
      { errorMessage: 'Invalid email', memberNames: ['email'] },
    ]);
    for (const error of result.error) {
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(error.memberNames)).toBe(true);
    }
  });

  it('rejects empty validation failures', () => {
    expect(() => Result.validationFailure([])).toThrow(RangeError);
  });

  it('returns heterogeneous tuple values in their input order', () => {
    const user = { name: 'Ada' };
    const result = Result.combine(Result.success(user), Result.success(42), Result.success(false));
    expect(result.valueOrThrow()).toEqual([user, 42, false]);
    expect(Object.isFrozen(result.valueOrThrow())).toBe(true);
    expect(result.valueOrThrow()[0]).toBe(user);
    expect(Object.isFrozen(user)).toBe(false);
    expectTypeOf(result.valueOrThrow()).toEqualTypeOf<readonly [typeof user, number, boolean]>();
  });

  it('accumulates all failures, retaining order and repeated errors', () => {
    const name = validationError('Name required', ['name']);
    const email = validationError('Email invalid', ['email']);
    const result = Result.combine(
      Result.validationFailure([name, email]),
      Result.success(42),
      Result.validationFailure(name),
    );
    expect(result.isFailure).toBe(true);
    if (result.isSuccess) throw new Error('Expected accumulated errors');
    expect(result.error).toEqual([name, email, name]);
    expect('value' in result).toBe(false);
    expect(Object.isFrozen(result.error)).toBe(true);
  });

  it('supports an empty tuple and arities greater than seven', () => {
    expect(Result.combine().valueOrThrow()).toEqual([]);
    const values = Array.from({ length: 10 }, (_, i) => Result.success(i));
    expect(Result.combine(...values).valueOrThrow()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('combines dynamic arrays and nested combinations', () => {
    const results: readonly ValidationResult<number>[] = [Result.success(1), Result.success(2)];
    const nested = Result.combine(Result.combine(...results), Result.success('ok'));
    expect(nested.valueOrThrow()).toEqual([[1, 2], 'ok']);
  });

  it('preserves explicit nullish and void successes in combined values', () => {
    expect(Result.combine(Result.success(null), Result.success(undefined), Result.success()).valueOrThrow())
      .toEqual([null, undefined, undefined]);
  });

  it('keeps nested combination failures flat', () => {
    const errors: ValidationError[] = [validationError('one'), validationError('two')];
    const nested = Result.combine(Result.validationFailure(errors[0]!));
    const combined = Result.combine(nested, Result.validationFailure(errors[1]!));
    expect(combined.match(() => [], problems => problems)).toEqual(errors);
  });
});

describe('selective factory boundaries', () => {
  it('runs the synchronous factory once and keeps its return value', () => {
    const factory = vi.fn(() => ({ id: 42 }));
    const guard = vi.fn(isInvalidName);
    expect(Result.fromTry(factory, (error): error is InvalidNameError => guard(error)).valueOrThrow())
      .toEqual({ id: 42 });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(guard).not.toHaveBeenCalled();
  });

  it('captures the expected synchronous exception without changing its identity', () => {
    const error = new InvalidNameError('Name required');
    const result = Result.fromTry(() => { throw error; }, isInvalidName);
    expect(result.match(() => undefined, caught => caught)).toBe(error);
  });

  it.each([new TypeError('bug'), 'not an Error', null, undefined])(
    'rethrows an unexpected synchronous value unchanged (%s)', (error) => {
      let caught: unknown = Symbol('not caught');
      try { Result.fromTry(() => { throw error; }, isInvalidName); }
      catch (value: unknown) { caught = value; }
      expect(caught).toBe(error);
    },
  );

  it('propagates guard failures instead of converting them into domain failures', () => {
    const guardError = new TypeError('guard bug');
    const guard = (_: unknown): _ is InvalidNameError => { throw guardError; };
    expect(() => Result.fromTry(() => { throw new InvalidNameError(); }, guard)).toThrow(guardError);
  });

  it('awaits a successful async factory once', async () => {
    const factory = vi.fn(async () => 42);
    const guard = vi.fn(isInvalidName);
    expect((await Result.fromTryAsync(factory, (error): error is InvalidNameError => guard(error)))
      .valueOrThrow()).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(guard).not.toHaveBeenCalled();
  });

  it('accepts synchronous values and void from async boundaries', async () => {
    expect((await Result.fromTryAsync(() => 42, isInvalidName)).valueOrThrow()).toBe(42);
    expect((await Result.fromTryAsync(async () => {}, isInvalidName)).valueOrThrow()).toBeUndefined();
  });

  it('captures expected promise rejections and synchronous throws', async () => {
    const error = new InvalidNameError('Name required');
    for (const factory of [async () => { throw error; }, () => { throw error; }]) {
      const result = await Result.fromTryAsync(factory, isInvalidName);
      expect(result.match(() => undefined, caught => caught)).toBe(error);
    }
  });

  it.each([new TypeError('bug'), 'not an Error', null, undefined])(
    'rejects unexpected async values unchanged (%s)', async (error) => {
      await expect(Result.fromTryAsync(async () => { throw error; }, isInvalidName)).rejects.toBe(error);
      await expect(Result.fromTryAsync(() => { throw error; }, isInvalidName)).rejects.toBe(error);
    },
  );

  it('propagates an async boundary guard failure', async () => {
    const error = new TypeError('guard bug');
    const guard = (_: unknown): _ is InvalidNameError => { throw error; };
    await expect(Result.fromTryAsync(async () => { throw new InvalidNameError(); }, guard))
      .rejects.toBe(error);
  });

  it('supports structural guards for a union of domain exceptions', () => {
    class ConflictError extends Error { readonly code = 'CONFLICT'; }
    type DomainError = InvalidNameError | ConflictError;
    const guard = (error: unknown): error is DomainError =>
      error instanceof InvalidNameError || error instanceof ConflictError;
    const error = new ConflictError('Already registered');
    const result = Result.fromTry(() => { throw error; }, guard);
    expect(result.match(() => undefined, caught => caught.code)).toBe('CONFLICT');
  });
});
