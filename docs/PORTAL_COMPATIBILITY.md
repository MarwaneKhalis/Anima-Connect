# Compatibilité des portails

Mise à jour : 9 octobre 2026. Les vérifications publiques ont été faites en lecture seule. Aucun formulaire n'a été rempli, aucun compte connecté et aucune candidature envoyée.

## Matrice

| Portail | Découverte d’offres | Formulaire réel observé | Candidature automatisée réelle | Scénarios locaux |
|---|---|---|---|---|
| Greenhouse | Adaptateur de tableau implémenté. Figma : 162 offres rapportées lors d’une lecture du tableau public le 6 octobre (`docs/VERIFICATION.md`). | Non vérifié sur un formulaire actuel pendant cette revue. Des pages d’application indexées montrent des questions spécifiques et peuvent exiger une vérification anti-robot; une page indexée n’est pas une vérification de compatibilité. | **Non vérifiée.** Aucun envoi réel. Le moteur candidature est générique, pas un adaptateur Greenhouse. | Formulaires HTML standards, réponse manquante, réponses sélectionnées, étapes, redirection ATS, CAPTCHA/MFA et reçu couverts par fixtures locales.
| Lever | Adaptateur de tableau implémenté. Spotify : 80 offres rapportées lors d’une lecture du tableau public le 6 octobre (`docs/VERIFICATION.md`). | Une page d’application publique Slate a été consultée le 9 octobre : CV par pièce jointe, champs de coordonnées, localisation, lettre de motivation et questions facultatives de diversité. Lecture sans interaction : [page publique observée](https://jobs.lever.co/slate/557fe4ab-d292-4069-8c63-36752f3da91d/apply). | **Non vérifiée.** La page observée expose des contrôles personnalisés; aucune saisie ni aucun envoi n’a été tenté. Le moteur candidature est générique, pas un adaptateur Lever. | Formulaires génériques et parcours à plusieurs étapes sur serveur fictif. Ces fixtures ne reproduisent pas le widget Lever observé.
| Workday | Aucun adaptateur de découverte dédié. Ajout manuel par URL possible. | Une offre publique Priceline était visible dans les résultats de recherche; l’outil de lecture n’a pas pu extraire directement la page lors de cette revue. Le formulaire de candidature n’a pas été inspecté. | **Non vérifiée.** Aucun envoi réel. | Pas de fixture Workday spécifique.

## Sens des niveaux

- **Découverte implémentée** signifie que le connecteur correspondant existe dans le dépôt.
- **Lecture publique** confirme uniquement que la page ou le tableau a pu être lu sans compte ni interaction.
- **Fixture locale** confirme le comportement sur le serveur fictif et le Chromium de test.
- **Candidature réelle non vérifiée** signifie qu’aucun formulaire employeur n’a été soumis. Les tests et l’import d’un tableau ne prouvent pas qu’un parcours de candidature est compatible avec ce même portail.

## Reproduire les scénarios locaux

Depuis la racine, exécuter `pnpm test`. Les scénarios correspondants se trouvent dans `tests/job-discovery.test.ts`, `tests/career-browser.test.ts` et `tests/career-ui.test.ts`; les serveurs de formulaires sont définis dans `tests/fixtures/careers.ts`. Ils n’envoient que vers des serveurs loopback fictifs autorisés en mode test.

## Écarts visibles

- Le moteur candidature reconnaît des champs HTML et des boutons connus; il ne détecte pas les widgets propriétaires et bloque les questions ou obstacles ambigus.
- Pour une question manquante, une préparation ou un obstacle manuel, Chromium reste ouvert et la fiche permet de reprendre la même session après vérification humaine, ou de la fermer. La reprise ne peut fonctionner que si l'étape reste sur la même origine : les requêtes tierces et redirections vers une autre origine sont bloquées, ce qui exclut de fait certains CAPTCHA/MFA/SSO. Cette reprise est couverte par une fixture locale; elle n'établit pas la compatibilité avec le formulaire Lever observé.
- Un lot en pause peut être repris explicitement ou abandonné après la fin du parcours actif; les éléments non traités gardent l'état `cancelled` dans le dernier instantané de file.
- La découverte de tableaux n’établit pas la compatibilité du formulaire associé.
- Une vérification d’un portail réel doit rester en lecture seule jusqu’à une étape de préparation explicitement séparée. Ne jamais cliquer le bouton d’envoi dans une vérification de compatibilité.
