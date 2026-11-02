import { Result, validationError, type ValidationError, type ValidationResult } from '../src/index.js';

/** User data after all independent input checks succeed. */
export interface Registration {
  readonly name: string;
  readonly email: string;
}

/** Validates all fields before returning the registration payload. */
export function validateRegistration(name: string, email: string): ValidationResult<Registration> {
  const errors: ValidationError[] = [];
  if (!name.trim()) errors.push(validationError('Le nom est obligatoire.', ['name']));
  if (!email.includes('@')) errors.push(validationError('L’adresse e-mail est invalide.', ['email']));
  return errors.length > 0
    ? Result.validationFailure(errors)
    : Result.success({ name: name.trim(), email });
}

/** Existing domain exception, returned by identity when the factory fails. */
export class EmailAlreadyRegisteredError extends Error {
  readonly code = 'EMAIL_TAKEN';
  /** @param email Address rejected by the domain factory. */
  constructor(readonly email: string) {
    super(`L’adresse ${email} est déjà enregistrée.`);
    this.name = 'EmailAlreadyRegisteredError';
  }
}

/** Wraps a repository boundary while allowing unexpected failures to propagate. */
export async function register(
  user: Registration,
  save: (user: Registration) => Promise<Registration>,
): Promise<Result<Registration, EmailAlreadyRegisteredError>> {
  return Result.fromTryAsync(
    () => save(user),
    (error): error is EmailAlreadyRegisteredError => error instanceof EmailAlreadyRegisteredError,
  );
}
