# Anima Connect

Espace carrière local en français : offres, candidatures, profil, CV multiples, comptes carrière chiffrés et prospection LinkedIn dans une application. React, TypeScript, Node.js 24, SQLite et Chromium.

## Démarrer

Dans PowerShell, avec Node.js **24 ou supérieur** :

```powershell
npm install --global pnpm
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm start
```

## Application bureau Windows

Anima Connect peut aussi être installée comme application Windows x64. Elle ouvre l’interface depuis les fichiers installés et appelle son moteur local par IPC : **aucun serveur web ni port localhost n’est lancé**. SQLite et le profil de navigation Playwright sont conservés dans le dossier utilisateur Windows ; Chromium est inclus dans l’installation.

Pour télécharger l’installateur depuis GitHub, ouvre l’exécution réussie du workflow **Verify Anima Connect** dans l’onglet *Actions*, puis télécharge l’artefact **anima-connect-windows**. Décompresse-le et lance `Anima Connect Setup 0.2.0.exe`.

Pour créer l’installateur localement sous Windows avec Node.js 24 et pnpm :

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dist
```

L’installateur est créé dans `release/`. Pour lancer l’application bureau en développement : `pnpm desktop:dev`. Pour vérifier le paquet Windows : `pnpm desktop:smoke`.

Ouvrir [Anima Connect](http://127.0.0.1:4174). Pour développer : `pnpm dev`, puis [localhost:5173](http://127.0.0.1:5173). Le serveur écoute uniquement sur `127.0.0.1`. La démo utilise des données fictives séparées et désactive les connexions et envois externes.

## Parcours complet

1. **Profil & CV** : enregistrer identité, coordonnées, parcours, préférences, réponses personnelles et fichiers PDF/DOCX (10 Mio maximum). Choisir un CV selon l'offre.
2. **Comptes carrière** : créer un coffre avec une phrase secrète de 12 caractères minimum et enregistrer les comptes existants des portails. L'origine HTTPS doit correspondre exactement au site de connexion. La phrase n'est pas enregistrée ; le coffre se verrouille au redémarrage.
3. **Offres** : importer un tableau Greenhouse/Lever ou une page `JobPosting` JSON-LD. Import dédoublonné, 200 offres maximum. Ajout direct d'une URL également disponible.
4. **Candidatures** : choisir offre et CV. **Préparer sans envoyer** parcourt le formulaire sans clic final. **Postuler automatiquement** lance Chromium, se connecte si nécessaire, remplit les champs reconnus, transmet le fichier choisi, avance dans les étapes et effectue l'envoi final.
5. Le reçu visible est enregistré. Sans preuve après clic, la candidature devient **Envoi à vérifier** ; tout nouvel envoi reste bloqué jusqu'à une vérification humaine documentée.
6. Un **lot sélectionné** est exécuté séquentiellement et s'arrête au premier blocage. Les candidatures envoyées quittent la sélection. L'arrêt du lot termine la candidature en cours puis interrompt le lot.
7. Le dashboard calcule ses chiffres depuis SQLite. Notes, relances et résultats métier (entretien, offre, refus) se renseignent dans le suivi. Les réponses des employeurs ne sont pas importées depuis une messagerie.

### Automatique et humain

| Étape           | Automatique                             | Intervention humaine                      |
| --------------- | --------------------------------------- | ----------------------------------------- |
| Ressources      | Réutilisation profil/CV/réponses        | Renseigner les faits et choisir le CV     |
| Découverte      | Greenhouse/Lever/JSON-LD, dédoublonnage | Fournir la source et choisir les offres   |
| Connexion       | Compte du coffre, origine exacte        | Compte existant et coffre déverrouillé    |
| Candidature     | Champs reconnus, CV, étapes, clic final | Question inconnue, CAPTCHA/MFA, ambiguïté |
| Preuve et suivi | Reçu, dates, historique, métriques      | Envoi incertain et réponse employeur      |
| LinkedIn        | Lecture page ouverte, brouillons, suivi | Connexion, choix/import et envoi LinkedIn |

Les formulaires HTML avec champs libellés et boutons reconnus sont pris en charge. Widgets propriétaires, inscriptions à de nouveaux comptes, SSO, CAPTCHA, MFA et parcours ambigus déclenchent un arrêt explicite. Le moteur n'invente ni faits ni consentements. Les tests ne prouvent pas la compatibilité avec tous les sites réels ; aucune candidature n'a été envoyée à un employeur pendant les vérifications.

## Prospection LinkedIn

**Prospection** conserve les recherches, import de profils visibles, prospects, pipeline, modèles, file de contact et sauvegardes d'Anima Connect. Le navigateur LinkedIn est distinct du moteur carrière. Les invitations/messages LinkedIn sont effectués par l'utilisateur puis confirmés ; ils ne sont pas envoyés automatiquement dans cette version. Le blocage des invitations envoyées ou incertaines reste durable.

## Données

- En mode web local : `data/anima-connect.sqlite` ; démo : `data/demo.sqlite`. L’application bureau garde ses bases et son profil de navigation dans le dossier de données utilisateur Windows.
- Mots de passe carrière : **AES-256-GCM**, clé dérivée par **scrypt**, liée à l'identité et l'origine du compte. Secrets déchiffrés uniquement côté serveur. Profil, CV, identifiants et suivi stockés localement en clair.
- Verrouiller le coffre arrête le moteur. Sans phrase secrète, les mots de passe enregistrés ne sont pas récupérables.
- Sauvegarde/restauration SQLite : **Prospection → Sauvegardes**. Le moteur est arrêté et le coffre verrouillé avant restauration ; copie de sécurité conservée. Toutes les tables carrière sont incluses.
- Données, sessions, exports, captures et Chromium exclus de Git.

## Vérifier

```powershell
pnpm build
pnpm test
```

La suite utilise de vrais serveurs carrière fictifs et Chromium : PDF/DOCX et SHA-256, profil, coffre, origine des comptes, préparation sans envoi, formulaires simples/multipages, redirection ATS, champs inconnus, contrôles de sécurité, reçu, incertitude, interruption, absence de double envoi, API et interface desktop/mobile. Captures dans `artifacts/career-ui/`. La CI Windows exécute build/tests et conserve les captures.

Les tests démarrent une base temporaire distincte. `ANIMA_TEST_MODE=1` autorise uniquement les origines HTTP loopback dans `CAREER_TEST_ORIGINS`. Ces options ne peuvent pas venir d'une requête UI. `ANIMA_DATA_DIR` choisit le dossier de données ; `PORT` le port HTTP ; `CAREER_HEADLESS=1` masque Chromium pendant les tests.

## Architecture

- `server/career-store.ts` : profil, fichiers, offres, états et historique.
- `server/vault.ts` : chiffrement et contrôle d'origine.
- `server/job-discovery.ts` : sources publiques, requêtes bornées, protection des adresses privées.
- `server/career-browser.ts` : connexion, formulaires, fichiers, étapes et reçu.
- `server/career-runner.ts` : exécution exclusive, marqueur durable avant clic final.
- `server/career-api.ts` : API validée ; `server/index.ts` : intégration locale.
- `web/CareerWorkspace.tsx` : carrière ; `web/App.tsx` : prospection.
- [Spécification](docs/CAREER_ARCHITECTURE.md).

Sources : [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Playwright](https://playwright.dev/docs/input). Découverte via flux publics ; candidature via formulaire navigateur, sans clé API d'employeur.
