<p align="center">
  <img src="icon/logo.png" alt="Result.ts logo" width="150px" />
</p>


# Result.Ts — `@frenchexdev2/result`

Bibliothèque TypeScript du Result pattern, adaptée de [Result Pattern : Give value to your Exceptions](https://serard.dev/content/blog/result-pattern.html#the-result-pattern-a-comprehensive-guide-to-error-handling-in-net).

Elle rend succès et échec explicites dans les signatures, accumule les erreurs de validation et conserve les exceptions métier existantes. ESM, déclarations TypeScript, aucune dépendance à l’exécution. Les sources n’utilisent aucune API Node.js et sont utilisables dans un navigateur avec un bundler. Node.js 22+ est requis pour le développement du package.

## Installation dans ce workspace

Le paquet se trouve dans `packages/Result.Ts` du workspace pnpm autonome `Result.Ts`. La racine privée porte le catalogue de versions et le verrou `pnpm-lock.yaml`.

Depuis la racine `Result.Ts`, utiliser la version pnpm déclarée à sa racine :

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

`pnpm test` compile le paquet, vérifie les contrats de types, exécute les tests avec couverture et vérifie une archive npm extraite. Une fenêtre PowerShell suit le lancement et se ferme après la sauvegarde du bilan dans `test-results/` à la racine.

Un autre paquet de ce workspace peut déclarer `"@frenchexdev2/result": "workspace:*"` dans ses dépendances. Les autres workspaces consomment une version publiée ou une archive obtenue avec `pnpm --filter @frenchexdev2/result pack`. Le paquet doit être compilé avant son utilisation et avant les tests d’intégration qui importent `dist/`.

```ts
import { Result, validationError, type ValidationResult } from '@frenchexdev2/result';

function validateAge(age: number): ValidationResult<number> {
  return age >= 18
    ? Result.success(age)
    : Result.validationFailure(validationError('Il faut avoir au moins 18 ans.', ['age']));
}

const result = validateAge(21);
if (result.isSuccess) {
  console.log(result.value); // number
} else {
  console.error(result.error); // ValidationErrors
}
```

Un accès direct à `result.value` avant discrimination est rejeté par TypeScript. `isFailure` permet également de discriminer les deux branches. Les deux callbacks de `match` et `matchAsync` sont obligatoires. TypeScript n’oblige cependant pas à utiliser un résultat retourné : ce contrat ne remplace pas les règles de lint et la revue du code.

## Les trois usages de l’article

- `StatusResult` : succès ou échec sans données, via `Result.success()` et `Result.failure()`.
- `Result<T>` ou `ValidationResult<T>` : une valeur ou une liste non vide d’erreurs, créée avec `Result.validationFailure(...)`.
- `Result<T, E>` : une valeur ou une erreur métier typée, créée avec `Result.failure(error)` ou une frontière `fromTry`.

Les fabriques retournent des branches précises, assignables aux types génériques compatibles. Les noms sont en camelCase. Contrairement aux contraintes `notnull` du modèle C#, TypeScript accepte explicitement `null`, `undefined`, `false`, `0` et `''` comme valeurs : le discriminant décide du succès.

## Accumuler les erreurs de validation

```ts
import {
  Result, validationError, type ValidationError, type ValidationResult,
} from '@frenchexdev2/result';

function validateProfile(name: string, email: string): ValidationResult<{ name: string; email: string }> {
  const errors: ValidationError[] = [];
  if (!name.trim()) errors.push(validationError('Nom obligatoire.', ['name']));
  if (!email.includes('@')) errors.push(validationError('Adresse e-mail invalide.', ['email']));

  return errors.length > 0
    ? Result.validationFailure(errors)
    : Result.success({ name: name.trim(), email });
}

const profile = validateProfile('', 'invalide');
const age: ValidationResult<number> = Result.validationFailure(validationError('Âge invalide.', ['age']));
const combined = Result.combine(profile, age);

combined.match(
  ([user, years]) => console.log(user.name, years),
  errors => console.error(errors.map(error => error.errorMessage)),
);
// Rapporte les trois problèmes dans l’ordre des validateurs.
```

`combine` reçoit des résultats déjà calculés. Il accumule toutes leurs erreurs, sans les dédupliquer, ou produit un tuple readonly dont chaque position conserve son type. Il accepte aussi un tableau dynamique avec `Result.combine(...results)`, des combinaisons imbriquées et un nombre quelconque de résultats. Sans argument, il réussit avec `readonly []`.

Une liste vide passée à `validationFailure([])` déclenche une `RangeError` : un échec de validation doit expliquer au moins un problème. La liste d’erreurs, ses objets et leurs `memberNames` sont copiés et gelés. Le premier problème est accessible avec `result.error[0]` après discrimination ; il n’y a pas de propriété parallèle `validationResult`.

## Réutiliser les exceptions métier

```ts
import { Result, type Result as Outcome } from '@frenchexdev2/result';

class InvalidNameError extends Error {
  readonly code = 'INVALID_NAME';
}

function createUser(name: string): Outcome<{ name: string }, InvalidNameError> {
  return Result.fromTry(
    () => {
      if (!name.trim()) throw new InvalidNameError('Nom obligatoire.');
      return { name: name.trim() };
    },
    (error): error is InvalidNameError => error instanceof InvalidNameError,
  );
}

const response = createUser('').match(
  user => ({ status: 201, body: user }),
  error => ({ status: 400, body: { code: error.code, message: error.message } }),
);
```

Les génériques TypeScript sont effacés à l’exécution : le garde de type est donc **obligatoire**. Seules les exceptions reconnues deviennent des échecs. Une autre exception, une valeur lancée qui n’est pas une `Error` ou une erreur du garde se propage. Le même objet métier est conservé, avec sa stack, sa cause et ses propriétés. Un garde peut reconnaître une union de plusieurs exceptions existantes, sans nouvelle hiérarchie d’erreurs.

## Opérations asynchrones

```ts
import { Result } from '@frenchexdev2/result';

const parsed = await Result.fromTryAsync(
  async () => JSON.parse('{"id":42}') as { id: number },
  (error): error is SyntaxError => error instanceof SyntaxError,
);

const response = await parsed.matchAsync(
  async value => ({ status: 200, body: String(value.id) }),
  async error => ({ status: 400, body: error.message }),
);
```

`fromTryAsync` attend une valeur, une promesse ou un thenable et traite aussi les exceptions synchrones de la fabrique. Utiliser cette variante pour toute fabrique asynchrone : `fromTry` n’attend pas les promesses. `matchAsync` attend uniquement le callback sélectionné et accepte également des callbacks synchrones. Les exceptions et rejets des callbacks ne sont pas convertis en nouveaux résultats.

## API et limites

Les fabriques sont disponibles via `Result` ou comme exports nommés : `success`, `failure`, `validationFailure`, `combine`, `fromTry`, `fromTryAsync`. `validationError(message, memberNames?)` crée un problème de validation.

Chaque résultat expose `isSuccess`, `isFailure`, `match`, `matchAsync` et `valueOrThrow`. `valueOrThrow()` est une sortie explicite vers les exceptions : sur échec, il lance `ResultAccessError`, dont `error` et `cause` contiennent la charge d’échec originale.

Les enveloppes et les tuples combinés sont gelés. Les valeurs applicatives et les erreurs métier restent les objets d’origine et ne sont **pas** gelés en profondeur. `Result<T, E>` peut représenter tout type d’erreur, mais `combine` est volontairement réservé aux erreurs de validation. Les méthodes sont liées à leur branche et restent utilisables après déstructuration.

Comme dans la bibliothèque présentée par l’article, aucun `map`/`bind` n’est inclus. `match` peut retourner des types différents pour ses deux branches. Les objets sérialisés en JSON perdent leurs méthodes : ce package ne fournit pas de désérialiseur ni de validation de données externes. Utiliser un validateur à la frontière pour les données non fiables.

## Vérification et exemple complet

Les tests de `test/unit/` couvrent la sélection des branches, la capture sélective, les promesses, l’accumulation et l’immutabilité. Les contrats de `test/types/` vérifient aussi les usages que le compilateur doit refuser. Les tests de `test/integration/` importent le package compilé par son nom public et exercent [l’exemple d’inscription](examples/registration.ts). La couverture de `src/` est exigée à 100 % des lignes, fonctions, instructions et branches ; rapports dans `test-results/coverage/`.

### Campagne de mutation

```sh
pnpm test:mutation
```

La configuration autonome `stryker.conf.cjs` utilise les plugins Stryker déclarés dans le catalogue de ce workspace. Elle mute `src/result.ts` et `src/validation-error.ts`, y compris leurs initialisations statiques, avec les tests unitaires et d’intégration. Chaque campagne recalcule tous les résultats, sans cache incrémental. Les sources et les tests de travail restent intacts : les mutations sont exécutées dans une sandbox.

Le vérificateur TypeScript classe les mutants invalides en `CompileError`, distinctement des mutants tués par les tests. La configuration Vitest dédiée désactive la couverture V8 et redirige l’import public `@frenchexdev2/result` vers les sources instrumentées : la campagne mesure les sources mutées plutôt que les anciens fichiers de `dist/`. Les contrats de typage de `test/types/` ne sont pas une suite de tests d’exécution Stryker.

Le lanceur surveillé conserve les rapports sous `test-results/<lancement>/mutation/` à la racine. En appel direct, les rapports HTML et JSON se trouvent par défaut dans `reports/mutation/` du paquet. `STRYKER_REPORT_DIR` permet de choisir un dossier de campagne ; les événements locaux dans son sous-dossier `events/` donnent les résultats individuels des mutants. Le seuil bloquant reste fixé à 100 %, comme dans le preset précédemment utilisé.

```sh
pnpm --filter @frenchexdev2/result pack
```

`prepack` reconstruit les exports et vérifie les types. L’archive contient `dist/`, ce README et la licence. Sa création ne publie rien sur un registre.

Licence : [FrenchExDev Educational License v1.0](LICENSE), reprise du workspace.

Références : [article d’origine](https://serard.dev/content/blog/result-pattern.html), [unions discriminées TypeScript](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions), [résolution des modules NodeNext](https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-nodenext). La conception a été rapprochée de la source locale `content/blog/result-pattern.md`, le site n’étant pas accessible depuis l’outil web pendant cette implémentation.
