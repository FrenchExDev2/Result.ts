# Releases npm par tag

Le workspace conserve sa propre ligne de versions. Un tag `vX.Y.Z` publie tous ses packages publics en `X.Y.Z` ; la racine reste privée. Les versions des autres workspaces ne sont jamais modifiées automatiquement.

Le workflow `.github/workflows/ci.yml` construit et teste sous Windows et Linux avec Node.js 24 et le pnpm indiqué par `packageManager`. Les branches, pull requests et lancements manuels vérifient le code. Seul un push de tag `v*` peut publier, après réussite des deux plateformes. Un tag mal formé ou différent des versions commitées est refusé.

## Authentification npm et trusted publishers

Les publications utilisent le compte npm `serard` et le scope `@frenchexdev2`. Les jobs de publication disposent de `id-token: write` pour utiliser OIDC avec GitHub Actions. Le secret `NPM_TOKEN`, fourni à `NODE_AUTH_TOKEN`, reste optionnel pour démarrer la première publication ; il n'est plus nécessaire après la configuration des trusted publishers. Les installations, builds et tests s'exécutent sans ce secret. Le registre est `https://registry.npmjs.org/` avec accès public.

Un package doit exister sur npm avant de pouvoir lui associer un trusted publisher. Après sa première publication, exécuter `npm trust github @frenchexdev2/nom --repository ORGANISATION/DEPOT --file ci.yml --allow-publish --yes` avec un compte autorisé et une validation 2FA. Pour la publication isolée de `requirements-shared-kernel`, ajouter également le workflow `release-package.yml`. Le dépôt déclaré par `repository.url` doit correspondre au dépôt GitHub qui publie le package. Un trusted publisher n'est considéré comme opérationnel qu'après une publication OIDC réussie.

## Préparer une release

Depuis la racine du dépôt, remplacer la version d'exemple par la version voulue :

```powershell
node scripts/release.mjs prepare v1.2.3
pnpm install --lockfile-only --no-frozen-lockfile --ignore-scripts
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:ci
node scripts/release.mjs check v1.2.3
```

`prepare` modifie les versions de la racine et des packages, ainsi que les contraintes `builderCompatibility` lorsqu'elles existent. Les dépendances internes conservent `workspace:*`, `workspace:^` ou `workspace:~`. pnpm les convertit en versions npm dans les manifests publiés. Les dépendances externes ne sont pas bumpées par cette commande.

Lors de la mise en place initiale, commiter aussi `.github/`, `scripts/`, `test/`, `release/`, `release.config.json`, `pnpm-workspace.yaml`, `RELEASE.md` et les mises à jour des README et exclusions Git. Pour les releases suivantes, examiner puis commiter les manifests et le lockfile avant de créer le tag :

```powershell
git add package.json packages pnpm-lock.yaml
git commit -m "chore: prepare release 1.2.3"
git tag v1.2.3
git push origin HEAD
git push origin v1.2.3
```

La CI vérifie les versions ; elle ne les réécrit jamais. Elle installe avec `--frozen-lockfile`. Le job de publication reconstruit le même commit et désactive les hooks de publication, le build ayant déjà été exécuté sans token. Une préversion telle que `v1.3.0-rc.1` utilise le canal npm `next` ; une version stable utilise `latest`. Les métadonnées `+build` ne sont pas acceptées.

Les versions npm déjà présentes sont ignorées par la publication récursive pnpm : une relance peut terminer une publication partielle. Les versions déjà publiées restent immuables ; toute correction nécessite une nouvelle version. Les publications d'un même dépôt sont sérialisées.

## Dépendances entre workspaces

Aucun override `file:` ni lien de sources entre workspaces n'est utilisé. Pour faire évoluer une dépendance externe, modifier sa version dans tous les manifests consommateurs concernés, régénérer leur lockfile, puis construire et tester ces consommateurs. Ne pas remplacer une version npm par un fichier `.tgz`.

Les archives de fixtures utilisées par les anciens tests de distribution restent des artefacts de test ; elles ne servent pas à installer les dépendances des workflows.

## Première publication

Au 3 novembre 2026, les versions internes nécessaires ne sont pas encore disponibles publiquement sur npm. Les anciennes résolutions d'archives ont été supprimées des trois lockfiles concernés ; les résolutions des dépendances tierces ont été conservées. Ces trois verrous doivent être complétés depuis npm une fois leurs producteurs publiés, puis commités. Ils ne constituent pas encore des installations figées valides.

Respecter cet ordre pour le démarrage :

1. Publier Result avec `v0.1.0`, indépendamment du reste.
2. Dans Requirements, publier seulement `@frenchexdev2/requirements-shared-kernel@0.1.0` avec `requirements-shared-kernel/v0.1.0`, selon la procédure ci-dessous.
3. Dans CodeGenerationPipeline, régénérer le lockfile depuis npm et préparer `v0.0.1`. Sa dépendance au shared kernel est `0.1.0`.
4. Dans Requirements, régénérer le lockfile depuis npm et préparer `v0.1.0`. Le shared kernel déjà publié sera ignoré par pnpm ; les autres packages seront publiés.
5. Dans Builder, régénérer le lockfile depuis npm et préparer `v0.1.0`. Ses dépendances Requirements utilisent la série `0.1.x`.

Ne pas taguer une release normale tant que `pnpm install --frozen-lockfile` échoue. Une réponse npm 404 n'autorise aucun repli vers une archive locale. Les tests, verrous et publications effectifs doivent être vérifiés à chaque étape.

## Publication isolée d'un package indépendant

Le mécanisme de release permet de construire un package indépendant dans un workspace temporaire contenant ses sources et les fixtures source explicitement listées dans `isolatedTestSources`. Ces fixtures ne contiennent aucun manifeste de package et ne sont pas installées comme dépendances. Il est activé pour `requirements-shared-kernel` dans `release.config.json` de Requirements, avec le workflow `.github/workflows/release-package.yml`. Aucune installation du reste du workspace n'est nécessaire.

Son lockfile autonome est conservé dans `release/requirements-shared-kernel/pnpm-lock.yaml`. Il est déjà généré avec pnpm 11.20.0. Pour le mettre à jour, depuis Requirements :

```powershell
node scripts/release.mjs prepare requirements-shared-kernel/v0.1.0
$stage = Join-Path ([IO.Path]::GetTempPath()) ('requirements-kernel-' + [guid]::NewGuid().ToString('N'))
node scripts/release.mjs stage requirements-shared-kernel/v0.1.0 $stage
pnpm --dir $stage install --lockfile-only --no-frozen-lockfile --ignore-scripts
pnpm --dir $stage install --frozen-lockfile
pnpm --dir $stage run build
pnpm --dir $stage run test:ci
Copy-Item -LiteralPath (Join-Path $stage 'pnpm-lock.yaml') -Destination release/requirements-shared-kernel/pnpm-lock.yaml -Force
```

Commiter les sources du package, ses manifests et le verrou autonome avant de poser le tag :

```powershell
git add package.json packages release.config.json release scripts test .github
git commit -m "chore: prepare shared kernel 0.1.0"
git tag requirements-shared-kernel/v0.1.0
git push origin HEAD
git push origin requirements-shared-kernel/v0.1.0
```

Le workflow isolé vérifie le tag, installe son propre verrou figé, construit et teste sur Windows et Linux, puis publie uniquement le package sélectionné. Les tests isolés reprennent les contrats existants et leurs seuils de couverture ; leurs imports de façades sont dirigés vers le kernel extrait. Le staging refuse un répertoire existant et exclut `node_modules`, les sorties de build et les résultats de tests.

## Vérifier le mécanisme de release

`node --test test/release.test.mjs` vérifie les tags, la coordination des versions, le rejet des transports locaux, les paramètres de publication et le staging isolé. Ces tests n'installent aucun package métier et ne publient rien.

Références : [publication pnpm](https://pnpm.io/cli/publish), [protocoles workspace](https://pnpm.io/workspaces), [publication npm avec GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).
