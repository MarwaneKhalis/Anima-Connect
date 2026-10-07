# Anima Desktop

**Anima Connect, l’application Windows pour organiser et automatiser vos candidatures.**

Gérez votre profil et vos CV, rassemblez des offres, préparez les formulaires de candidature et suivez l’avancement depuis une application installée sur votre PC.

[**Télécharger pour Windows**](https://github.com/MarwaneKhalis/Anima-Desktop/releases/latest/download/Anima-Desktop-Setup.exe) · [Voir les versions](https://github.com/MarwaneKhalis/Anima-Desktop/releases)

![Aperçu du tableau de bord Anima Connect](docs/desktop-preview.png)

_Aperçu avec des données de test._

## Installation

1. Téléchargez **Anima-Desktop-Setup.exe** depuis le lien ci-dessus.
2. Ouvrez le fichier et suivez l’installation.
3. Lancez **Anima Connect** depuis le menu Démarrer ou le raccourci du bureau.

L’installateur est prévu pour Windows 10/11 64 bits et une installation par utilisateur. Node.js, Chrome et un serveur web ne sont pas nécessaires. Les données restent sur cet ordinateur. Une connexion Internet est nécessaire pour consulter des offres et ouvrir les sites carrière.

> **À propos de Windows SmartScreen :** les versions actuelles ne sont pas signées par un certificat éditeur. Windows peut afficher un avertissement au premier lancement.

## Ce que l’application fait

- **Centralise le profil et plusieurs CV** pour réutiliser les bonnes informations selon le poste.
- **Rassemble des offres** ajoutées par URL ou importées depuis des pages carrière prises en charge, avec dédoublonnage.
- **Prépare et remplit les formulaires** de sites carrière compatibles. Vous pouvez préparer sans envoyer ou lancer l’envoi depuis la fiche de candidature.
- **Suit les candidatures** : état, reçu, questions restantes, notes et relances.
- **Met en pause les parcours** qui demandent une réponse, un CAPTCHA ou une vérification MFA ; vous reprenez ensuite dans la session ouverte.
- **Suit la prospection** et les échanges LinkedIn. Les invitations et messages LinkedIn restent envoyés manuellement.
- **Propose un assistant IA optionnel** : configurez un fournisseur compatible OpenAI, testez-le et générez un brouillon de lettre à relire. L’IA ne soumet pas de candidature.

L’automatisation fonctionne sur les formulaires HTML qu’elle reconnaît. Les comptes à créer, SSO, questions inconnues, CAPTCHA/MFA et parcours propriétaires peuvent demander une action manuelle. La compatibilité n’est pas garantie sur tous les sites.

## Données et confidentialité

La base de candidatures, le profil, les CV et le navigateur carrière sont conservés dans le dossier utilisateur Windows. Les mots de passe des comptes carrière et la clé API IA sont chiffrés dans le coffre de l’application. Le profil et les fichiers CV sont stockés localement, mais ne sont pas eux-mêmes chiffrés par l’application.

Le fournisseur IA ne reçoit des informations professionnelles qu’après une action explicite de génération. Les champs structurés de coordonnées et les fichiers CV ne sont pas transmis ; les textes libres du profil ou de l’offre peuvent toutefois contenir des données personnelles. Consultez [les détails sur les données envoyées](docs/AI_PROVIDER.md).

L’application bureau ouvre son interface depuis les fichiers installés et communique avec son moteur par IPC. Elle ne lance pas de serveur web local.

## Développer et vérifier

Prérequis pour contribuer : Windows, Node.js 24 ou supérieur et pnpm 11.19.0.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm desktop:dist
```

L’installateur généré se trouve dans `release/`. La suite de tests utilise des offres et sites fictifs ; elle n’envoie pas de candidature à un employeur. Voir [l’architecture](docs/CAREER_ARCHITECTURE.md) et [les vérifications](docs/VERIFICATION.md).
