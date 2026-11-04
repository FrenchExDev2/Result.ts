# Validation des workflows de release — 3 novembre 2026

Les validations ci-dessous ont été exécutées sous Windows avec PowerShell Core 7.6.9 et pnpm 11.20.0 pour les workspaces. Les tests ont été lancés en arrière-plan avec une fenêtre de suivi PowerShell visible, fermée normalement après sauvegarde des résultats.

## Vérifications réussies

- Les cinq workflows ont été vérifiés avec actionlint 1.7.12 : aucune erreur.
- Les quatre copies autonomes du mécanisme de release passent chacune 11 tests Node.js : 44 tests, aucun échec.
- Le shared kernel a été installé dans un workspace isolé depuis son lockfile npm autonome avec `--frozen-lockfile`, puis construit. Ses 66 tests existants passent avec 100 % des statements, branches, fonctions et lignes couvertes.
- Result a été installé avec `--frozen-lockfile`, construit et contrôlé en types. Ses 48 tests existants passent avec 100 % des statements, branches, fonctions et lignes couvertes.
- Les sources des fixtures et des spécifications du kernel sont copiées explicitement ; aucun autre package du dépôt n'est installé dans ce staging. Les contrats existants et les seuils de couverture ne sont pas réduits.
- Les dépendances des workspaces et les trois verrous migrés ne contiennent plus de transport `file:`. Les résolutions des packages tiers conservées dans les verrous ont été comparées sémantiquement aux sauvegardes initiales et sont inchangées.
- Les versions initiales sont coordonnées : Builder et Requirements en 0.1.0, CodeGenerationPipeline en 0.0.1, Result en 0.1.0. CodeGenerationPipeline consomme le kernel 0.1.0, comme Requirements et Builder.

## Préconditions de la première publication

Les consultations publiques du registre npm renvoient HTTP 404 pour les packages internes nécessaires. Les installations figées de Builder, CodeGenerationPipeline et Requirements échouent avec ERR_PNPM_OUTDATED_LOCKFILE, parce que leurs anciennes résolutions d'archives ont été retirées et que les remplacements npm ne peuvent pas encore être résolus.

Leurs suites complètes n'ont donc pas été qualifiées dans cette nouvelle configuration registry-only. Suivre RELEASE.md : publier le shared kernel avec son workflow isolé, puis CodeGenerationPipeline, puis Requirements, et enfin Builder ; Result est indépendant. Régénérer et commiter chaque verrou consommateur après disponibilité de ses producteurs. Aucun repli vers une archive n'est prévu.

Les jobs Linux sont configurés mais n'ont pas été exécutés sur GitHub pendant cette intervention. Aucun tag Git, push ni publication npm n'a été réalisé. Le secret GitHub Actions NPM_TOKEN doit être ajouté avant la publication.

## Preuves et suivi local

- Campagne finale : C:\Users\serard\AppData\Local\Temp\FrenchExDev-release-0a92e3a319f442db9f32df279f5eb059/tests-qualified/summary.json
- Kernel final : C:\Users\serard\AppData\Local\Temp\FrenchExDev-release-0a92e3a319f442db9f32df279f5eb059/kernel-qualified/summary.json
- Logs complets et résultats QuietCli : dans les mêmes dossiers.
- Verrous avant migration : C:\Users\serard\AppData\Local\Temp\FrenchExDev-release-0a92e3a319f442db9f32df279f5eb059/*.original-lock.yaml
- Réouverture du suivi : pwsh -NoProfile -File "C:\Users\serard\AppData\Local\Temp\FrenchExDev-release-0a92e3a319f442db9f32df279f5eb059/Watch-Release.ps1" -RunDirectory "C:\Users\serard\AppData\Local\Temp\FrenchExDev-release-0a92e3a319f442db9f32df279f5eb059/kernel-qualified" -WorkerId 3756

La consultation optionnelle des gains QuietCli a échoué dans le rapport (propriété OverheadMs absente). Aucun chiffre de gain ou de performance n'est déduit de cette consultation.
