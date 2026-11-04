<p align="center">
  <img src="icon/logo.png" alt="Result.ts logo" width="150" />
</p>

# Result.Ts — workspace pnpm

Workspace autonome de la bibliothèque TypeScript `@frenchexdev2/result`, organisé
comme `Builder.ts` et `Requirements.ts` : une racine privée et des paquets sous `packages/*`.

```text
Result.Ts/
├── packages/
│   └── Result.Ts/          Bibliothèque, exemples et tests existants
├── scripts/               Validation et fenêtre de suivi
├── package.json           Commandes du workspace privé
├── pnpm-workspace.yaml    Paquets et catalogue des dépendances
└── pnpm-lock.yaml         Résolutions reproductibles
```

Prérequis : Node.js 22.22+, pnpm 11.20.0 et PowerShell Core 7.6+ pour la validation surveillée.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm test:mutation
```

`pnpm test` compile le paquet, vérifie les contrats TypeScript, exécute les tests
unitaires et d’intégration avec les seuils de couverture existants à 100 %, puis
vérifie l’import ESM d’une archive npm extraite. `pnpm test:mutation` lance la
campagne Stryker. Chaque lancement ouvre une fenêtre de suivi PowerShell et attend
sa fin ; la fenêtre se ferme automatiquement après la sauvegarde du bilan.
Les journaux, rapports et résumés sont conservés sous `test-results/<lancement>/`.
Le lanceur affiche la commande permettant de rouvrir le suivi.
Ces scripts utilisent le module QuietCli présent dans le workspace FrenchExDev_i2.

Le nom public, les exports ESM et les sources du paquet restent identiques.
La documentation complète de l’API et les exemples sont dans
[packages/Result.Ts/README.md](packages/Result.Ts/README.md).

Pour produire une archive distribuable, après compilation et vérification des types :

```sh
pnpm --filter @frenchexdev2/result pack
```

Un autre workspace utilise une version publiée ou cette archive. Le protocole
`workspace:*` relie uniquement les paquets d’un même workspace pnpm.

La migration conserve les fichiers d’origine dans le dossier voisin `../Result.Ts.tmp`.
Ce dossier est une sauvegarde locale ; le dépôt Git reste à la racine de `Result.Ts`.

## GitHub Actions and npm releases

See [RELEASE.md](RELEASE.md) for the NPM_TOKEN secret, committed version preparation, Windows/Linux checks, and publication by vX.Y.Z tag.
