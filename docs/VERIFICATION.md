# Vérification — 6 octobre 2026

## Résultat local

Windows, Node.js 24, Chromium Playwright. TypeScript `--noEmit` et build Vite standard réussis. Suite complète : **50 tests réussis, 0 échec, 0 ignoré**, durée 49,6 secondes sur la dernière exécution après intégration des commits.

| Vérification | Preuve |
|---|---|
| Candidature simple et CV choisi | POST reçu par le serveur fictif ; fichier, MIME, octets et SHA-256 comparés |
| Préparation | Aucun POST final avant lancement de l'envoi |
| Plusieurs étapes | Identité → CV/question → récapitulatif → reçu |
| Connexion et redirection ATS | Compte fourni uniquement à l'origine exacte du site de destination |
| Réponses personnelles | Champs inconnus bloqués, defaults ignorés, radios Yes/No cohérents, réponses candidature prioritaires |
| Secret | Chiffrement authentifié, altération rejetée, espaces conservés, aucun mot de passe dans API/disque/log d'erreur |
| Envoi incertain | Un POST sans reçu → uncertain ; nouvel envoi refusé après redémarrage |
| Interruption/concurrence | État durable avant clic, stop avant/après clic, deuxième parcours HTTP 409 |
| Fichiers | PDF/DOCX ; upload HTTP 5 Mio ; limite 10 Mio ; nom Unicode téléchargé |
| Interface | Profil, deux CV, choix explicite, offre, préparation, envoi, reçu, reload et deux lots successifs |
| Mobile/CRM | Vue 390 × 844 sans débordement ; prospection intégrée avec une seule barre latérale |
| API locale | Header de mutation, Origin, Host hostile et Sec-Fetch-Site contrôlés |
| Ancienne prospection | Les neuf tests métier existants réussissent |

L'architecte a revu les branches avant commit, fait reproduire puis corriger les défauts et donné son accord final. Son contrôle indépendant de restauration a vérifié le retour du profil, des octets/SHA du CV, du compte chiffré et du coffre verrouillé puis déverrouillable avec sa phrase originale.

## Découverte réelle, en lecture seule

Le 6 octobre 2026, le moteur a lu les tableaux publics :

- Greenhouse Figma : **162 offres** trouvées.
- Lever Spotify : **80 offres** trouvées.

Ces nombres sont un constat de test, pas des données de démonstration permanentes. La découverte JSON-LD et le refus des redirections vers des adresses privées sont couverts par un serveur local fictif.

## Captures reproductibles

`tests/career-ui.test.ts` génère les captures suivantes dans `artifacts/career-ui/` :

1. `01-dashboard.png`
2. `02-profile.png`
3. `03-offers.png`
4. `04-application-ready.png`
5. `05-receipt.png`
6. `06-mobile.png`
7. `07-prospecting.png`

Les captures proviennent d'une exécution réelle sur données synthétiques. Elles sont exclues de Git et conservées comme artefact par la CI.

## Portée des résultats

Aucune candidature de test n'a été envoyée à un employeur réel. La réussite sur les fixtures ne certifie pas tous les portails de recrutement. Les contrôles CAPTCHA/MFA, SSO, nouveaux comptes et formulaires propriétaires non reconnus demandent une intervention. La prospection LinkedIn garde l'envoi manuel de la version précédente ; les résultats métier des candidatures se renseignent manuellement. Ces limites sont visibles dans l'interface et décrites dans le README.
