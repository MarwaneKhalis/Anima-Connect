# Anima Connect

Un carnet local de prospection LinkedIn, en français, pour une seule personne. L’application garde vos recherches, prospects, brouillons, rappels et événements dans une base SQLite sur votre ordinateur. Elle ne demande aucun compte cloud ni mot de passe LinkedIn.

## Démarrer sur Windows

1. Installez **Node.js 24 ou plus récent** depuis [nodejs.org](https://nodejs.org/), puis ouvrez PowerShell dans ce dossier.
2. Installez les dépendances et Chromium :

   ```powershell
   npm install --global pnpm
   pnpm install
   pnpm exec playwright install chromium
   ```

3. Lancez l’application :

   ```powershell
   pnpm dev
   ```

4. Ouvrez **http://127.0.0.1:5173**. Pour découvrir l’interface sans toucher à vos données, cliquez sur **Activer le mode démo** en bas de la barre latérale. La démo contient uniquement des personnes et entreprises inventées.

Pour un lancement sans serveur de développement : `pnpm build`, puis `pnpm start` et ouvrez **http://127.0.0.1:4174**. Fermez le terminal pour arrêter l’application.

## Parcours d’utilisation

1. Dans **Recherches**, créez « CTO — France », « Data Engineer — international » ou d’autres recherches. Les champs à valeurs multiples acceptent des virgules. Enregistrez la recherche.
2. Cliquez sur **Ouvrir dans LinkedIn**. Une fenêtre Chromium visible s’ouvre. Connectez-vous vous-même, puis ajustez les filtres dans LinkedIn. Cliquez sur **Associer l’URL courante** pour retrouver cette recherche plus tard.
3. Sur une page de résultats **Personnes** ou un profil que vous avez ouvert, cliquez sur **Lire la page courante**. L’application propose seulement les liens de profil visibles. Vérifiez et corrigez les champs, choisissez les personnes, puis importez. L’ajout manuel est disponible si la page a changé ou si un champ manque.
4. Dans **Prospects** ou **Pipeline**, ouvrez une fiche. Modifiez son statut, ses tags, ses notes et sa prochaine action. La chronologie garde les changements. La recherche source et ses filtres au moment de l’import restent visibles.
5. Choisissez un **Modèle** pour créer un brouillon. Relisez et modifiez le texte ; placez-le dans la **File d’actions**. Ouvrez le profil depuis la file, effectuez vous-même l’envoi dans LinkedIn, puis confirmez dans Anima Connect uniquement après avoir vérifié que le texte exact est parti au bon profil. Une invitation déjà envoyée, en attente ou incertaine bloque toute nouvelle invitation au même prospect, même après redémarrage.
6. Si une page change, une navigation échoue ou le résultat est incertain, la file se met en pause. Après vérification sur LinkedIn, indiquez **Vérifié : envoyé** ou **Vérifié : non envoyé**. Pour une invitation acceptée ou une réponse, utilisez **Mise à jour manuelle** sur la fiche et choisissez la date constatée.

**Aucune action LinkedIn n’est déclenchée par l’import.** La file ne clique pas sur les boutons d’envoi LinkedIn et n’envoie pas de lots automatiquement. Elle sert à préparer, vérifier, ouvrir et journaliser des actions effectuées par l’utilisateur. La limite par défaut est de **10 invitations confirmées par jour**, modifiable dans **Paramètres**.

## Données et sauvegardes

La base réelle est `data/anima-connect.sqlite`. La démo utilise `data/demo.sqlite`. Le profil Chromium persistant est dans `data/browser-profile/`. Tous ces fichiers sont exclus de Git. Aucun cookie, export, fichier de session, secret ou donnée réelle de prospect ne doit être ajouté au dépôt. Le serveur écoute seulement sur `127.0.0.1` et n’envoie pas de télémétrie.

Dans **Paramètres** :

- **Exporter CSV** : prospects et champs principaux, avec les noms des recherches sources à titre de référence. L’import CSV crée ou complète les fiches ; l’URL normalisée évite les doublons. Les recherches, événements et messages ne sont pas restaurés par CSV.
- **Sauvegarder la base** : copie SQLite complète, incluant recherches, fiches, sources, événements, modèles et messages.
- **Restaurer** : recharge une sauvegarde SQLite Anima Connect. Une copie de la base précédente est conservée dans `data/avant-restauration-*.sqlite`.

Gardez les sauvegardes en lieu sûr : elles contiennent des données personnelles en clair. Il n’y a pas de chiffrement dans ce MVP.

## Architecture

- `web/` : interface React et TypeScript, servie par Vite en développement.
- `server/index.ts` : serveur HTTP local et routes de l’application.
- `server/db.ts` : schéma SQLite et règles métier durables, dont dédoublonnage, chronologie, limite et blocage des invitations.
- `server/browser.ts` : adaptateur Playwright pour ouvrir Chromium visible et lire les éléments visibles sur la page courante, sans API privée LinkedIn.
- `server/domain.ts` : URL canoniques, filtres, modèles et CSV.
- `tests/` : tests sur données fictives, sans session LinkedIn.

Node.js 24 fournit le module `node:sqlite`, ce qui évite une dépendance SQLite native à compiler sur Windows. Le navigateur est lancé uniquement à la demande. Aucune opération navigateur n’est faite en mode démo.

## Étude technique et limites LinkedIn

L’[aide officielle LinkedIn sur la recherche de personnes](https://www.linkedin.com/help/linkedin/answer/a525054) décrit les filtres via l’interface, dont lieu, entreprise, école, secteur et mots-clés. Elle ne documente pas de format d’URL stable pour préremplir tous ces filtres. Anima Connect construit uniquement une URL de recherche ordinaire à partir des mots-clés et intitulés, puis conserve l’URL de la recherche que vous avez réglée dans LinkedIn. Ce choix évite de dépendre de paramètres internes non documentés. Les résultats et le contenu visible peuvent varier ; la lecture des cartes est donc une aide à la saisie, toujours à vérifier.

Les [conditions d’utilisation de LinkedIn](https://www.linkedin.com/legal/user-agreement) encadrent l’usage de logiciels qui copient les données du service ou automatisent des actions. Ce MVP limite la lecture à la page que vous ouvrez et aux profils que vous choisissez, sans exploration automatique, API privée, contournement de CAPTCHA ou envoi automatique. Vérifiez que votre utilisation respecte les conditions applicables à votre compte. Si LinkedIn affiche un contrôle ou une erreur, l’application s’arrête et vous laisse reprendre la main.

## Vérifications

```powershell
pnpm test
pnpm build
```

Les tests utilisent des profils inventés. Ils vérifient la normalisation des URL, la réimportation sans doublon, l’alerte de doublon possible, le blocage d’une deuxième invitation après redémarrage, la chronologie, l’arrêt de la file sur un résultat incertain et les champs CSV. Le build vérifie TypeScript et génère l’interface de production. Aucun test ne se connecte à LinkedIn.

À vérifier manuellement sur votre ordinateur avec votre propre session : ouverture de Chromium, connexion faite par vous, URL de recherche adaptée à votre interface LinkedIn, lecture des cartes visibles et confirmation d’un envoi réel. Les sélecteurs LinkedIn peuvent changer ; l’ajout manuel reste disponible.

