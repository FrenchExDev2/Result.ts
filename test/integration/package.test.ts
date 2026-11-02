import { describe, expect, it } from 'vitest';
import { Result, validationError, type ValidationResult } from '@frenchexdev/result';
import { EmailAlreadyRegisteredError, register, validateRegistration } from '../../examples/registration.js';

describe('built ESM package and registration example', () => {
  it('resolves public exports from the built package', async () => {
    const value: ValidationResult<number> = Result.success(42);
    const combined = Result.combine(value, Result.validationFailure(validationError('Required')));
    expect(await combined.matchAsync(() => 'unexpected', async errors => errors[0].errorMessage))
      .toBe('Required');
  });

  it('reports all input problems and returns a usable valid registration', () => {
    expect(validateRegistration('', 'invalid').match(() => [], errors => errors.map(e => e.memberNames)))
      .toEqual([['name'], ['email']]);
    expect(validateRegistration(' Ada ', 'ada@example.test').valueOrThrow())
      .toEqual({ name: 'Ada', email: 'ada@example.test' });
  });

  it('saves once, preserves expected domain exceptions and propagates defects', async () => {
    const user = validateRegistration('Ada', 'ada@example.test').valueOrThrow();
    expect((await register(user, async value => value)).valueOrThrow()).toBe(user);
    const conflict = new EmailAlreadyRegisteredError(user.email);
    const failed = await register(user, async () => { throw conflict; });
    expect(failed.match(() => undefined, error => error)).toBe(conflict);
    const defect = new TypeError('Storage bug');
    await expect(register(user, async () => { throw defect; })).rejects.toBe(defect);
  });
});
