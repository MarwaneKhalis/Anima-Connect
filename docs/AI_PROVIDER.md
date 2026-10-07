# Fournisseur IA configurable

Cette première intégration accepte un endpoint externe compatible avec l’API OpenAI Chat Completions. Elle sert à tester la connexion et à préparer un brouillon de lettre ciblé. Elle ne lance jamais un appel IA au moment d’envoyer une candidature.

## Configuration et appels

- `POST /api/career/ai/config` avec `{ "baseUrl": "https://api.example.org/v1", "model": "nom-du-modele", "apiKey": "…" }` enregistre la configuration. Une URL HTTPS publique est requise; les identifiants intégrés à l’URL, paramètres, fragments, hôtes locaux et adresses IP sont refusés. À chaque appel, toutes les réponses DNS A et AAAA sont vérifiées; si une seule est privée, réservée ou non globale, la requête est refusée. La connexion est épinglée sur une IP validée, tandis que le nom d’hôte reste utilisé pour le SNI et la validation du certificat TLS. Aucun redirect n’est suivi.
- `GET /api/career/ai/config` renvoie l’URL, le modèle, la date de mise à jour et l’état verrouillé du coffre. La clé n’est jamais renvoyée.
- `POST /api/career/ai/test` avec `{}` envoie uniquement un prompt technique court au modèle configuré. Aucun profil, CV, offre ou réponse personnelle n’est joint.
- `POST /api/career/ai/cover-letter` avec `{ "applicationId": "…" }` prépare un brouillon à vérifier. Les réponses de candidature ne sont ajoutées que si l’utilisateur demande explicitement `{ "applicationId": "…", "includeAnswers": true }`.
- `DELETE /api/career/ai/config` supprime la configuration chiffrée. Comme pour les autres opérations de l’API locale, les requêtes d’écriture doivent porter l’en-tête `X-Anima-Request: 1`.

## Données transmises pour un brouillon

La requête de brouillon transmet au fournisseur sélectionné :

- l’intitulé, l’entreprise, le lieu et la description de l’offre (description limitée aux 12 000 premiers caractères) ;
- le titre professionnel et le résumé du profil ;
- jusqu’à 30 compétences, 15 langues, 8 expériences et 5 formations, avec les champs professionnels correspondants ;
- en option explicite seulement, jusqu’à 40 paires question/réponse de la candidature, avec chaque valeur limitée à 500 caractères.

Les champs structurés de nom et de coordonnées (adresse, code postal, téléphone, e-mail), les liens personnels, le fichier CV, les identifiants de comptes carrière et les cookies du navigateur ne sont pas joints. Cela ne garantit pas que ces mêmes informations soient absentes des textes libres : le résumé, les descriptions d’expérience ou la description de l’offre peuvent contenir des données personnelles si l’utilisateur les y a saisies. L’application ne transmet pas non plus l’URL de l’offre, qui peut contenir des paramètres de suivi.

Le brouillon est une proposition à relire. Le prompt demande de ne reprendre que les faits présents dans les données, sans inventer d’expérience, de compétence ou de diplôme. Si l’option `includeAnswers` est utilisée, les réponses peuvent contenir des informations sensibles : elles ne partent vers le fournisseur qu’après cette demande explicite.

## Protection et limites

La clé est chiffrée avec AES-256-GCM dans la table `career_ai_settings` du coffre existant. La clé de chiffrement du coffre reste en mémoire uniquement tant que le coffre est déverrouillé. La réponse de configuration expose uniquement les métadonnées; les erreurs du fournisseur ne recopient ni sa réponse brute ni la clé. Le code ne journalise pas les prompts.

La résolution DNS et chaque requête HTTPS partagent une limite de 45 secondes. Le corps JSON envoyé au fournisseur est limité à 32 Kio, ses réponses à 128 Kio et le brouillon à 12 000 caractères. Les tests du fournisseur utilisent un transport mocké et ne contactent aucun service externe.

Le composant `web/AiAssistant.tsx` expose le panneau de configuration, le test et la génération explicite. Il attend `request(path, method?, body?)` (le helper API de l’espace carrière) et `selectedApplication: { id, title, company }`; le contexte affiché confirme l’offre concernée et l’option d’inclure les réponses revient à `false` quand la sélection change. Le parent l’intègre dans l’espace carrière.
