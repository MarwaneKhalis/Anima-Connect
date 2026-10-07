# Intégration du moteur de campagne durable

`server/career-campaign.ts` fournit une file SQLite indépendante de React. Le module est
volontairement injecté : il ne construit pas le navigateur, ne découvre pas les offres et
n’envoie aucun formulaire sans que l’hôte lui fournisse explicitement un parcours.

## Contrat d’hôte

Créer `CareerCampaignStore` sur le même `DatabaseSync` que le magasin carrière, puis un
`CareerCampaignEngine` avec un `CampaignApplicationPort` qui délègue `createApplication`
à `CareerStore.createApplication`, `getApplication` à `CareerStore.getApplication` et
`run` au runner de candidature déjà existant. `createApplication` est idempotent par offre
grâce à la contrainte unique du magasin carrière.

Après une découverte et avant la fermeture de sa vue, appeler
`engine.createFromOffers(offers, resumeId, maxSubmissions, idempotencyKey)` avec une clé stable
générée pour l’action utilisateur (UUID côté client). Le serveur garde la campagne en état
`building` tant que le lot n’est pas entièrement inséré, puis la scelle en `queued`. Une répétition
avec la même clé reprend le même lot; CV/plafond différents ou une liste d’offres différente après
scellement sont refusés. Une panne entre création d’application et insertion de queue se répare
en répétant le même appel. `addOffers(id, offers)` n’accepte que `building`/`queued` et scelle le lot
après ajout; elle refuse les campagnes démarrées ou terminales. La campagne et chaque application
sont écrites en SQLite.
Le plafond est entre 1 et 500; la concurrence est limitée à 1–4 (valeur par défaut : 1).

Au démarrage du processus, exécuter d’abord `CareerStore.recoverInterruptedRuns()`, puis
`await engine.recoverAfterRestart()` (ou lancer cette promesse en tâche de fond avec journalisation).
La demande de démarrage est persistée avant l’activation : un crash dans cet intervalle laisse une
campagne `queued` avec `startRequested=true`, qui est également reprise. Les campagnes qui étaient
`running` sont réconciliées puis reprennent sans dépendre du montage React. Les campagnes
explicitement `paused` avec un item en cours sont réconciliées (pending ou uncertain) mais restent
en pause et ne reprennent pas seules. Le moteur marque `submitting` ou
`uncertain` comme incertain et ne réappelle jamais le port pour cet item. Il faut garder la
résolution humaine des candidatures incertaines dans le parcours métier existant.

`pause(id)` empêche les nouvelles prises de file mais laisse finir les actions en cours.
`stop(id)` annule les signaux en cours et rend la campagne terminale. `start(id)` reprend une
campagne en pause. Chaque exception est contenue à l’item et les éléments suivants continuent;
les interventions (`needs_input`/`blocked`) n’arrêtent pas la campagne.

Pour l’API, `store.list(limit = 50)` renvoie les campagnes modifiées récemment, de la plus récente
à la plus ancienne, avec un maximum strict de 100; `store.counts(id)` renvoie
`{total,pending,running,submitted,needsInput,uncertain,failed,skipped}`.

## Frontière de sûreté et tests

Le moteur ne prétend pas rendre compatibles tous les ATS : c’est l’adaptateur `run` qui doit
utiliser les parcours reconnus. Il doit respecter le marqueur de soumission existant et renvoyer
`uncertain` si le résultat ne peut pas être confirmé. Le plafond réserve atomiquement une place
avant exécution; un résultat incertain compte dans ce plafond et n’est jamais rejoué. Les tests
`tests/career-campaign.test.ts` emploient SQLite sur disque et des parcours de fixture seulement;
aucune offre réelle ni aucun employeur n’est contacté.

## API séparée

`server/career-campaign-api.ts` expose `handleCareerCampaignApi` sans modifier le routeur carrière
existant. À monter avant son 404 final. Il reçoit `{careerStore,campaigns,engine,demo}` et offre :

- `GET /api/career/campaigns?limit=50` → `{campaigns:[{...campaign,counts}]}` (limite max 100)
- `GET /api/career/campaigns/:id` → `{campaign:{...campaign,counts},items}`
- `POST /api/career/campaigns` → `{jobIds,resumeId,maxSubmissions,idempotencyKey}`
- `POST /api/career/campaigns/:id/start|pause|stop` avec `{}` et l’en-tête `X-Anima-Request: 1`

`start` répond 202 sans attendre la campagne et intercepte les rejets en arrière-plan; les états
terminaux répondent 200 sans redémarrer. `stop` attend la fin du worker avant de répondre. La démo
refuse création et démarrage. Les tests HTTP associés sont dans `tests/career-campaign-api.test.ts`.
