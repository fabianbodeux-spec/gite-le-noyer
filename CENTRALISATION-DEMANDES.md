# Centraliser les trois plateformes dans le backend du Noyer

## Objectif

Utiliser `/admin` comme point de départ quotidien pour toutes les demandes : site du Noyer, trois plateformes de location, téléphone et e-mail. Voir l’origine, les dates, le prix proposé, le statut et la prochaine action sans devoir consulter plusieurs tableaux.

Cette branche contient une première mise en œuvre manuelle pour Ardennes-étape, Villa for You et Belvilla : ajout et préremplissage de demandes externes, suivi commun, notes, checklists et brouillons de réponse dans le backend. Aucun compte externe n’est connecté, aucune synchronisation ni réponse automatique n’est activée. Les moyens d’accès autorisés pour ce logement restent à préciser. Voir `README.md` pour les fonctions effectivement disponibles ; les étapes d’intégration automatique ci-dessous restent des propositions.

## Connexions adaptées aux trois plateformes

Vérification des pages officielles effectuée le 19 novembre 2026. Les liens communiqués sont des pages publiques de recherche ou d’accueil : ils ne donnent pas accès aux demandes propriétaires ni aux calendriers privés du logement.

| Plateforme | Éléments confirmés dans les pages officielles | Connexion proposée pour Le Noyer |
| --- | --- | --- |
| Ardennes-étape | L’espace propriétaire permet de consulter le planning partagé et d’enregistrer des réservations personnelles et blocages. | Ajouter les dossiers manuellement dans un premier temps ; vérifier auprès de l’interlocuteur propriétaire l’existence d’un export iCal ou d’une intégration autorisée. Aucun accès API/iCal utilisable pour ce compte n’est confirmé à ce stade. |
| Villa for You | Le site renvoie vers l’espace propriétaire MyVilla. Il indique gérer les réservations et paiements et diffuser les logements dans un réseau de partenaires. | Identifier la référence du Noyer dans MyVilla et demander les possibilités d’export de calendrier et de réservations. Les notifications réellement reçues par le propriétaire pourront alimenter une boîte centrale après vérification de leur contenu. Pas d’API ou de flux privé confirmé à ce stade. |
| Belvilla | La page propriétaire annonce une synchronisation iCal et une intégration API avec des gestionnaires de canaux. Elle décrit aussi des réservations confirmées automatiquement. | Vérifier le flux disponible dans le compte propriétaire et son sens import/export. Une API pour un gestionnaire de canaux partenaire ne signifie pas qu’une API libre est accessible à notre backend. Les réservations déjà confirmées chez Belvilla doivent être distinguées de simples demandes locales. |

Sources : [Ardennes-étape, espace propriétaire et planning](https://www.ardennes-etape.fr/nouveaux-proprietaires), [Villa for You, location et lien MyVilla](https://www.villaforyou.com/fr/louer-ma-maison-de-vacances), [Belvilla, FAQ propriétaire et synchronisation](https://partner.belvilla.com/fr).

### Priorité proposée

Commencer par une boîte centrale avec quatre origines identifiées : « Site Le Noyer », « Ardennes-étape », « Villa for You » et « Belvilla », plus le téléphone. Ajouter les demandes externes avec leur référence réelle. Ensuite, activer les imports calendaires dont les liens privés auront été obtenus, et la réception des notifications propriétaires si elles contiennent les informations nécessaires.

Pour chaque dossier externe, distinguer le statut reçu de la plateforme du statut de traitement interne. Une réservation déjà ferme n’attend pas une nouvelle acceptation locale ; si elle entre en conflit avec un autre séjour, afficher un incident à résoudre et conserver les deux références. Une demande ou option externe susceptible de bloquer temporairement le planning doit conserver cette information et son éventuelle expiration au lieu d’être assimilée automatiquement à une demande locale non bloquante.

Villa for You et Belvilla peuvent diffuser des logements auprès de partenaires. Il faut donc vérifier si les annonces du Noyer sur les trois sites correspondent à trois contrats indépendants ou à une redistribution d’un même partenaire. Ne pas compter deux fois une réservation redistribuée. Une référence partenaire commune permet un rapprochement fiable ; des dates identiques seules déclenchent une suggestion de rapprochement, pas une fusion automatique.

### Questions à vérifier dans chaque espace propriétaire

- Quelle est la référence exacte du logement Le Noyer ?
- Existe-t-il un export iCal privé ? Un import d’un calendrier externe ?
- Peut-on exporter les réservations, leurs modifications et annulations ?
- Quels e-mails reçoit réellement le propriétaire : demande, option, confirmation ou annulation ?
- Existe-t-il une intégration partenaire autorisée et quels accès ce compte peut-il obtenir ?
- L’annonce est-elle gérée directement ou diffusée par l’un des autres partenaires ?

## Rattachement au dépôt GitHub existant

Le dossier local n’avait pas de dépôt Git. Une branche initiale locale `feature/centralisation-demandes` a été initialisée. Le dépôt distant est désormais identifié et l’accès par le connecteur est confirmé : `https://github.com/fabianbodeux-spec/gite-le-noyer`. Le remote local `origin` pointe vers ce dépôt.

Lors de la vérification, le dépôt GitHub est vide, sans commit ni branche : il n’y a pas d’historique distant à reprendre. Le premier commit doit enregistrer la version locale actuelle. La base SQLite, les clés et les liens iCal privés restent exclus de Git. Le connecteur permet de consulter GitHub, mais le réseau du terminal ne résout pas `github.com` ; un push Git classique peut donc échouer depuis cet environnement.

## Interface proposée

Dans l’en-tête propriétaire :

```text
Boîte de réception | Calendrier | Tarifs | Plateformes
```

La boîte de réception affiche les vraies demandes avec les filtres « À traiter », « En attente du voyageur », « Confirmées », « Refusées » et « Annulées ». Chaque ligne indique la plateforme, le nom du voyageur, les dates, le nombre de personnes, le montant connu, la dernière activité et les conflits éventuels.

Une fiche regroupe le message reçu, les coordonnées autorisées, les notes privées, l’historique, le prix proposé et un lien vers la demande sur sa plateforme d’origine. Un bouton « Ajouter une demande externe » permet de démarrer immédiatement, même avant toute connexion automatique.

Les actions proposées : vérifier les dates, préparer une réponse, suivre le dossier, refuser ou annuler. Une confirmation externe n’est envoyée automatiquement que si la plateforme dispose d’une intégration autorisée qui le permet. Sinon, le gestionnaire ouvre la plateforme et confirme manuellement ; le backend enregistre ensuite la référence et bloque les dates.

## Trois modes d’alimentation complémentaires

| Mode | Ce qui arrive dans le backend | Usage et limite |
| --- | --- | --- |
| Saisie manuelle | Origine, référence, coordonnées, dates, groupe, message et montant si connu | Première version utilisable avec les trois sites, sans dépendre de leurs intégrations. |
| Calendrier iCal disponible sur la plateforme | Événements calendaires et indisponibilités publiées | Pour rapprocher les dates ; ne pas l’assimiler à une boîte de réception de demandes ou de conversations. |
| API officielle, webhook autorisé ou e-mail reçu | Selon les autorisations : demandes, mises à jour, messages, réservations | À définir plateforme par plateforme. Un e-mail importé constitue d’abord une proposition à vérifier, pas une confirmation automatique. |

Les possibilités exactes seront vérifiées dans la documentation officielle des trois sites. Pas de collecte par contournement d’accès ni de partage de mots de passe entre applications.

Référence technique : le [format iCalendar, RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), décrit l’échange d’événements et de disponibilités. Les fonctions de messagerie et les autorisations de chaque plateforme nécessitent une vérification séparée.

## Parcours d’une demande

1. Réception automatique autorisée ou ajout manuel avec la plateforme et une référence.
2. Rapprochement avec les références déjà connues : une mise à jour du même dossier ne crée pas un doublon.
3. Vérification des nuits dans le calendrier commun et signalement des chevauchements.
4. Préparation d’un devis local ou saisie du prix proposé par la plateforme. Les deux montants ne sont pas confondus : frais, commissions et paiements peuvent différer.
5. Réponse au voyageur via l’intégration autorisée ou sur le site d’origine. Un brouillon n’est jamais présenté comme un message envoyé.
6. Confirmation vérifiée, blocage des nuits et journalisation de l’origine de la décision.
7. En cas de modification ou d’annulation, mise à jour du dossier depuis la source compétente et contrôle des dates libérées.

Une demande en attente ne bloque pas le logement. Si une gestion d’options temporaires est ajoutée, elle devra afficher sa date d’expiration et être distincte d’une réservation ferme.

## Calendrier commun

Les réservations confirmées, les blocages personnels et les indisponibilités externes alimentent une seule vue. La confirmation locale reste transactionnelle, comme dans le moteur actuel. Un conflit externe est signalé et soumis au propriétaire ; il ne supprime aucune réservation existante.

Chaque connexion affiche sa dernière synchronisation réussie, son état et les erreurs. Un calendrier ancien ou une connexion en échec ne doit jamais laisser croire à une disponibilité garantie. Le système local seul ne peut pas empêcher une réservation simultanée sur une plateforme distante.

Pour les flux iCal, conserver l’UID de l’événement, sa source et ses dates. L’absence d’un événement ne libère des nuits que si une synchronisation complète et valide confirme sa disparition ; un téléchargement incomplet ou en échec ne libère rien. Une annulation externe ne peut pas retirer un blocage personnel ou celui d’une autre source.

L’export éventuel d’un calendrier commun demande une URL HTTPS accessible aux plateformes, avec un secret propre au flux et sans coordonnées de voyageurs. Il n’est pas utilisable depuis le seul serveur actuel en `127.0.0.1`. L’import et l’export doivent éviter les boucles de réimportation des propres réservations du Noyer.

## Évolution technique proposée

Conserver Python, SQLite, le formulaire du site et les données existantes. Ajouter des migrations progressives et des modules séparés pour les connecteurs.

- `channels` : identité des trois plateformes, mode de connexion, état de synchronisation. Les secrets restent hors des fichiers servis au public.
- `external_inquiries` : demandes externes, référence d’origine, informations disponibles, statut de traitement et liaison éventuelle vers une réservation locale.
- `external_events` : événements calendaires rattachés à leur source et à leur UID, sans inventer de voyageurs ou de montant quand le flux ne les fournit pas.
- `inquiry_messages` : messages reçus, brouillons, références externes et état réel d’envoi.
- `sync_runs` : date, résultat, compteurs et erreurs de chaque synchronisation, sans secrets dans les journaux.
- `audit_events` : auteur, action, référence et horodatage des modifications de statut et de dates.

Les champs inconnus restent vides : pas de faux e-mails pour satisfaire le formulaire public, pas de prix nul signifiant « gratuit ». La création d’un dossier externe utilise une route propriétaire distincte du formulaire public. Les anciennes demandes et leurs devis sont conservés.

## Mise en œuvre par étapes

### Étape 1 — Un point de gestion immédiatement utile

Ajouter les trois sources configurables, la boîte de réception unifiée, la saisie d’une demande externe, la référence de plateforme, les notes privées, le filtrage par origine et la détection des chevauchements. Conserver la confirmation manuelle et le blocage des nuits. Cette étape ne nécessite aucun identifiant externe.

### Étape 2 — Calendriers disponibles

Importer les flux iCal si les plateformes les fournissent, avec aperçu avant le premier import, rapprochement des UID, historique et gestion des erreurs. Ajouter un export protégé seulement lorsque l’hébergement et les besoins des plateformes sont connus.

### Étape 3 — Réception des demandes et échanges

Choisir, pour chaque plateforme, le moyen autorisé le plus complet : API, webhook, intégration partenaire ou réception d’e-mails. Tester les doublons, les modifications et les annulations avant toute automatisation des confirmations. Les accès aux boîtes mail ou aux plateformes seront configurés explicitement.

## Critères de validation

- La même référence de plateforme est mise à jour sans créer de doublon.
- Deux demandes concurrentes ne peuvent pas confirmer localement les mêmes nuits.
- Un séjour externe peut être enregistré sans prix ni coordonnées encore connus.
- Un conflit entrant est visible et ne remplace pas silencieusement un séjour existant.
- Une panne de synchronisation ne libère aucune nuit.
- Une annulation ne libère que les événements appartenant à la bonne source.
- Les messages ne sont marqués envoyés qu’après confirmation du canal d’envoi.
- Les API publiques ne révèlent ni messages, ni coordonnées, ni secrets.
- Les données et le formulaire existants restent fonctionnels après migration.

## Informations attendues

La réception actuelle des demandes (e-mails, extranet ou autre), les éventuels liens iCal, les références du logement et le souhait de répondre depuis le backend ou de conserver les échanges sur chaque plateforme. Ne pas placer de mots de passe ou de liens iCal privés dans ce document versionné.
