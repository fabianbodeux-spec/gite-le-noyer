# Le Noyer

Pour la mise en ligne, suivre [RAILWAY.md](RAILWAY.md). La configuration Docker/Gunicorn utilise un volume persistant et une clé propriétaire définie dans les variables du service. Le lancement local ci-dessous reste inchangé.

Site local HTML, CSS, JavaScript et serveur Python sans dépendance supplémentaire.

## Démarrer

```sh
cd ~/le-noyer-v6
python3 demarrer.py
```

Ouvrir l’adresse indiquée par le serveur (ports 8040 à 8042). Le formulaire nécessite ce serveur : ouvrir simplement le fichier HTML ne suffit pas. Arrêter avec Ctrl+C.

## Pages et ressources

- `index.html` : ouverture sur le relief 3D, maison, galerie filtrable avec agrandissement, randonnée, puis demande de séjour dans un panneau latéral (`#reserver`, ouvert par tout lien `/#reserver`).
- `ui.js` : en-tête masqué en descendant et transparent sur le relief, panneau de réservation, profondeur légère des photos.
- `midweek.html` : espace dédié aux marcheurs, choix de distances, circuits existants, téléchargement GPX, aperçu local du tracé et préparation du séjour.
- `site.css` : styles partagés, adaptations mobile, focus clavier et réduction des mouvements.
- `site.js` : interactions, navigation des photos et distances au clavier, formulaire et aperçu GPX sans dépendance à une carte externe.
- `favicon.svg` : monogramme N et feuillage, utilisé pour le logo et le favicon.
- `relief.js` / `relief.css` : relief 3D (Three.js, sans compilation) de la vallée de la Lienne. Accueil : caméra guidée par le défilement ; randonnées : relief manipulable, tracé GPX drapé et profil altimétrique. Chargé seulement à l’approche de la section ; image ou aperçu SVG de secours sans WebGL ; vue fixe si l’utilisateur réduit les animations.
- `relief/lienne.bin` : altitudes 200 × 243 (uint16, décimètres) couvrant 50,300–50,370 N et 5,680–5,770 E, issues des Terrain Tiles ouvertes (Mapzen / AWS). La position de la maison (`HOUSE` dans `relief.js`) est celle du hameau de Bierleux : à remplacer par les coordonnées exactes.
- `vendor/three.module.min.js` : Three.js r160 (licence MIT, `vendor/three.LICENSE`). `fonts/` : Fraunces et Instrument Sans (licence OFL), hébergées localement.

Les liens depuis les circuits préremplissent le type de séjour et la distance dans la demande. Les catégories 5, 10, 15, 20 et 30 km indiquent des envies de distance ; le kilométrage publié reste visible séparément.

`demarrer.py` lance le serveur de `serveur.py` et ne régénère pas l’accueil. Les anciens scripts de génération restent archivés dans le dossier ; ne pas les lancer pour modifier la nouvelle version. La base `demandes.sqlite3`, les photos et les traces sont conservées. Les paiements ne sont pas encaissés par le site : le propriétaire enregistre manuellement les sommes reçues.

## Gestion des locations

Au démarrage, Terminal affiche l’adresse `/admin` et une clé propriétaire. Ouvrez cette adresse et saisissez la clé. La clé est conservée localement dans `.noyer-admin-key` (permissions privées, fichier exclu de Git et du serveur web) et reste identique entre les redémarrages. Dans le navigateur, elle n’est conservée qu’en mémoire pendant la session. Pour utiliser une clé stable, définissez `NOYER_ADMIN_TOKEN` dans votre environnement (au moins 24 caractères). Ne partagez pas cette clé avec les visiteurs.

1. Choisissez l’année dans la gestion.
2. Ajoutez vos périodes tarifaires : arrivées comprises entre le début inclus et la fin exclue, tarif de référence mid-week pour 4 nuits, tarif week-end fixe pour toute durée autorisée et frais de ménage. Une période peut couvrir toute l’année, du 1er janvier au 1er janvier suivant. Les périodes ne peuvent pas se chevaucher ; modifiez ou désactivez un tarif pour le remplacer par plusieurs saisons.
3. Vérifiez le calendrier : les dates sans tarif restent signalées. Le calendrier affiche le tarif de référence mid-week (4 nuits) et le tarif fixe du week-end sur les jours d’arrivée autorisés. Sans tarif pour l’arrivée choisie, aucun devis ne peut être créé.
4. Dans « Ajouter des dates indisponibles », en haut de la gestion, saisissez l’arrivée et le départ ou cliquez sur ces deux dates dans le calendrier annuel. Choisissez le motif puis cliquez sur « Enregistrer l’indisponibilité ». Le formulaire fonctionne même sans tarif ni demande préalable. La nuit du départ reste libre. L’année affichée suit automatiquement l’arrivée enregistrée.
5. Le visiteur choisit ses dates et son groupe, calcule le prix puis demande ce séjour.
6. Confirmez ou refusez dans `/admin`. Une confirmation bloque les nuits ; une annulation les libère. Plusieurs demandes en attente peuvent concerner les mêmes nuits, mais une seule peut être confirmée.

Aucune location à la nuit : le mid-week commence entre lundi et mercredi à 17 h et se termine au plus tard vendredi à 9 h, pour au moins deux nuits. Le tarif de référence saisi dans la grille correspond à quatre nuits et s’ajuste proportionnellement aux nuits choisies. Le week-end commence vendredi ou samedi à 17 h, se termine au plus tard lundi à 9 h et dure au moins deux nuits ; son tarif reste fixe. Le calendrier propose les départs disponibles et le serveur impose les mêmes règles. Les blocages manuels restent libres de dates pour gérer les travaux et réservations externes.

Aucun tarif de démonstration n’est installé. Les prix sont ceux du logement entier, en euros, avec un maximum de 30 voyageurs. Le forfait et le ménage sont ceux de la période d’arrivée, même si le séjour traverse une autre période ou une autre année. Aucun autre supplément ni taxe n’est ajouté automatiquement : la grille doit correspondre au prix que vous souhaitez proposer.

Les anciens tarifs à la nuit restent conservés dans la table `rates`, mais ne servent plus aux nouveaux devis. Les forfaits sont enregistrés séparément dans `package_rates` et doivent être renseignés avec vos montants réels : aucune conversion automatique des anciens prix n’est effectuée. Les anciennes réservations confirmées restent bloquantes et conservent leur prix ; les anciennes demandes en attente nécessitent un nouveau devis au forfait avant confirmation.

Le prix de chaque demande est archivé. Un changement de tarif oblige le visiteur à recalculer son devis avant l’envoi. La confirmation du propriétaire accepte le prix archivé, et non le nouveau tarif. Une modification des dates ou du groupe impose une nouvelle demande. Les anciennes demandes restent conservées, en attente et sans devis ; elles ne peuvent pas être confirmées directement.

Pour les nouveaux forfaits, le prévisionnel annuel rattache le séjour complet et son ménage à l’année d’arrivée. Les anciens séjours confirmés à la nuit conservent leur calcul historique, avec les nuits de l’année et le ménage dans l’année d’arrivée. Ce montant représente les réservations confirmées, pas des paiements reçus. La vue publique ne contient pas les noms, e-mails ni motifs de blocage.

La base est migrée au premier lancement sans supprimer les demandes existantes. Les écritures utilisent une transaction SQLite verrouillée et la disponibilité est revérifiée à la confirmation pour éviter les doubles réservations concurrentes. Les fichiers Python et SQLite ne sont pas téléchargeables via le serveur.

Si `/admin` affiche seulement l’ancien tableau des demandes, arrêtez l’ancien serveur dans Terminal avec Ctrl+C, relancez `python3 ~/le-noyer-v6/demarrer.py`, puis utilisez exactement l’adresse « Gestion » affichée par ce nouveau processus. Rechargez la page. Le nouveau backend affiche « Vos locations. » et demande une clé propriétaire ; l’ancien tableau ne propose pas les nouveaux formulaires.

Ce serveur écoute uniquement sur ce Mac (`127.0.0.1`). Une mise en ligne nécessitera un hébergement adapté, HTTPS et la configuration de l’envoi d’e-mails et du paiement si souhaités. Le calendrier connaît uniquement les réservations et blocages saisis dans cette base ; aucune synchronisation avec une plateforme externe n’est active.

## Simplification du travail propriétaire

A `/admin`, l’espace propriétaire est organisé en pages : vue d’ensemble, réservations externes, demandes du site, accueil et ménage, tarifs du site et disponibilités. Les fiches s’ouvrent dans un panneau individuel. L’année choisie pilote les tarifs et le calendrier ; les tâches proches restent visibles.

- **Réservations externes** : Ardennes-étape, Villa for You, Belvilla, téléphone et autre origine. Saisir ou préremplir la plateforme, la référence, les dates et le nombre de voyageurs. Le nom et un contact sont facultatifs. Aucun montant, devis ou règlement n’est demandé. Les séjours externes peuvent avoir toute durée jusqu’à 366 jours. Après vérification des chevauchements, « Valider les dates » les inscrit au calendrier. Cette validation ne confirme pas la réservation sur la plateforme et ne remplace pas son suivi client.
- **Import de confirmation** : le texte collé est analysé localement pour rechercher les champs libellés et ne contacte aucune boîte e-mail ni plateforme. Les informations restent à vérifier. Une référence déjà enregistrée pour la même origine, ou un message identique sans référence, évite un doublon.
- **Accueil et ménage** : les séjours confirmés alimentent la liste des arrivées avec un compte à rebours. L’espace de travail sépare les consignes destinées au ménage des notes privées. Chaque départ crée une rotation avec créneau 9 h–17 h et signale une éventuelle arrivée le même jour. Vous pouvez préparer un message puis l’ouvrir dans WhatsApp, le partager via le menu du téléphone ou le copier vers toute messagerie. Vous choisissez vous-même la conversation et envoyez le message ; le site n’envoie rien automatiquement. Après l’envoi, confirmez l’étape pour l’inscrire dans l’historique.
- **Demandes du site** : une chronologie par dossier enregistre la réception, les courriels préparés, les paiements validés et chaque envoi confirmé manuellement après copie dans votre messagerie privée. Les étapes d’accueil et de ménage y figurent aussi. Aucun courriel ne part depuis le site.
- **Paiements du site** : le propriétaire rapproche le paiement avec son relevé, puis saisit montant, mode et référence. Les paiements partiels sont pris en charge et le solde est calculé. Si le paiement intégral est validé et les dates encore disponibles, le système confirme automatiquement la réservation. Le site prépare un courriel qui regroupe le paiement, la confirmation de réservation et les informations d’arrivée. Après l’avoir copié dans votre messagerie et envoyé, confirmez l’envoi dans la fiche pour inscrire les étapes dans la chronologie. Aucun paiement n’est détecté ou encaissé automatiquement par une banque ou un prestataire.
- **Tarifs et prévisionnel** : la grille ne concerne que les séjours réservés directement sur le site. Le montant prévisionnel exclut les réservations externes, dont les paiements et recettes restent gérés par les plateformes.
- **Disponibilités** : le calendrier combine les demandes confirmées et les blocages manuels. Un chevauchement bloque la validation d’une réservation externe. Une libération des dates externes doit correspondre à une annulation déjà effectuée auprès de la plateforme.

`booking_workflows` conserve l’origine, la référence, les notes privées et la checklist. `booking_timeline` conserve les événements horodatés et `booking_payments` le registre des paiements directs. Les anciennes demandes reçoivent un seul événement « Suivi chronologique activé » ; l’historique avant cette date, les paiements et les e-mails antérieurs ne sont pas reconstitués. Les réservations externes partagent le calendrier et les outils d’accueil/ménage, sans utiliser les montants, le suivi des paiements ou les communications commerciales des demandes directes. Aucune synchronisation automatique avec les plateformes n’est active.

### Courriels par copier-coller

Le site prépare les réponses pour le devis, la relance, le règlement, la confirmation de réservation, l’arrivée, le refus, l’indisponibilité et l’annulation. Copiez le destinataire, l’objet et le texte dans votre messagerie privée. Après avoir envoyé le courriel, cliquez sur la validation correspondante : la chronologie enregistre alors l’envoi. La validation du paiement ouvre directement le courriel adapté ; si le solde est entièrement réglé et les dates libres, il inclut la confirmation et les informations d’arrivée. Aucun SMTP ni envoi automatique n’est activé.

Pour afficher ces nouveautés, arrêter l’ancien processus avec Ctrl+C puis relancer `python3 ~/le-noyer-v6/demarrer.py`. Utiliser l’adresse « Gestion » et la clé affichées par ce nouveau processus. Recharger ensuite `/admin`.

## API

- `GET /api/availability?year=2030` : calendrier public, nuits disponibles, occupées ou sans tarif.
- `POST /api/quote` : `arrival`, `departure`, `guests`, éventuellement `package` (`midweek` ou `weekend`, sinon déduit des dates) ; retourne le forfait, les horaires, le ménage, le total en centimes et un `token`.
- `POST /api/requests` : coordonnées, dates, groupe et `quote_token` ; crée une demande en attente.
- `GET /api/admin/state?year=2030` : tarifs, demandes, blocages et prévisionnel.
- `POST /api/admin/rates` : crée un tarif forfaitaire ou modifie son `id` ; montants `midweek`, `weekend`, `cleaning` en euros. Le tarif `midweek` est la référence pour quatre nuits et il est proratisé ; le tarif `weekend` reste fixe pour deux ou trois nuits.
- `POST /api/admin/blocks` : `start`, `end`, `reason`.
- `POST /api/admin/requests/ID/status` : `status` parmi `confirmed`, `cancelled`, `rejected`.
- `POST /api/admin/rates/ID/deactivate` ou `/api/admin/blocks/ID/deactivate` : désactivation sans suppression.
- `GET /api/admin/workspace?year=2030` : actions du jour, dossiers enrichis et rotations ménage.
- `POST /api/admin/import-preview` : `text` ; extrait un brouillon sans sauvegarder de demande.
- `POST /api/admin/external` : origine `source`, référence, coordonnées facultatives, dates de toute durée jusqu’à 366 jours, nombre de voyageurs et message ; crée une réservation externe à valider, sans prix ni paiement.
- `POST /api/admin/external/ID` : complète une réservation externe en attente avec les mêmes champs et sa `version` actuelle.
- `POST /api/admin/requests/ID/workflow` : `version`, `notes` et checklist des étapes d’accueil, d’accès et de ménage.
- Le même endpoint accepte `cleaning_note` (maximum 2 000 caractères), séparé des notes privées.
- `POST /api/admin/requests/ID/cleaning-notified` : `channel` (`whatsapp`, `share` ou `copy`) ; inscrit dans l’historique la transmission déclarée par le propriétaire, sans conserver le texte du message.
- `POST /api/admin/requests/ID/draft` : `kind` parmi `quote`, `arrival`, `followup`, `unavailable`, `payment`, `rejection`, `cancellation` ; retourne un courriel préparé sans l’envoyer. Pour le reçu, fournir également `payment_id`.
- `POST /api/admin/requests/ID/payment` : `amount` en euros, `method` (`transfer`, `card`, `cash`, `other`), `reference` facultative et `version`. Enregistre le paiement, confirme automatiquement si le solde est réglé et les dates disponibles, puis retourne le courriel à copier-coller.
- `POST /api/admin/requests/ID/message-sent` : `kind` et, pour un reçu, `payment_id` ; inscrit dans l’historique l’envoi confirmé manuellement après copie.
- `GET /api/admin/workspace?year=2030` inclut la chronologie et les paiements de chaque dossier.
- `POST /api/admin/rates/bulk` : liste `ids` de périodes et montants `midweek`, `weekend`, `cleaning` ; mise à jour atomique.

Les routes de gestion nécessitent `Authorization: Bearer CLÉ`. Les écritures utilisent `Content-Type: application/json`. Une indisponibilité, un tarif manquant, un devis périmé ou un chevauchement renvoie un conflit HTTP 409.

## Réservation côté visiteurs

Deux choix ouvrent le parcours : mid-week avec arrivée du lundi au mercredi et départ au plus tard vendredi matin, ou week-end avec arrivée vendredi/samedi et départ au plus tard lundi matin. Chaque séjour dure au moins deux nuits. Le calendrier occupe la partie principale de la réservation, avec des cases de 78 px minimum sur ordinateur et de 62 px sur petit écran. Le formulaire est placé à droite sur ordinateur et sous le calendrier sur mobile.

Le premier clic sur une date d’arrivée renseigne le bandeau latéral. Le calendrier propose alors chaque départ possible respectant la fenêtre, le minimum de deux nuits et les disponibilités ; le second clic valide le séjour. Les deux champs se remplissent à mesure des clics ; aucune fin n’est enregistrée automatiquement. « Effacer les dates » recommence la sélection et le changement de forfait remet les dates à zéro. Une arrivée n’est proposée que si son forfait est tarifé et si aucune nuit du séjour n’est bloquée ; le contrôle couvre aussi le passage de décembre à janvier. Les autres arrivées sont indiquées comme complètes, passées ou à tarifer. Le serveur revérifie toujours le prix et la disponibilité avant l’enregistrement. Les champs de dates du bandeau sont en lecture seule : la sélection s’effectue dans le grand calendrier, y compris au clavier avec Tabulation et Entrée. Les règles de période et le minimum de deux nuits restent imposés. Le prix mid-week est ajusté au nombre de nuits ; le tarif week-end est fixe. Une date de départ peut être sélectionnée même si une autre réservation débute ce jour-là, car le départ est à 9 h et l’arrivée suivante à 17 h. Lorsqu’un séjour traverse un changement de mois, le calendrier affiche automatiquement le mois du départ pour le second clic.

Le bouton de connexion propriétaire affiche maintenant un message explicite si le module de gestion manque, si un ancien serveur répond, si la clé est refusée ou si le serveur reste injoignable. Les espaces accidentels et le libellé « Clé propriétaire : » sont retirés de la saisie. Ces messages ne modifient pas les autorisations d’accès.

## Direction visuelle

Palette : forêt `#183628`, ivoire `#F8F6EF`, cuivre `#AA8061`, sauge `#E8EDE3`, texte `#223C30`, blanc `#FFFFFF`.

Titres en Iowan Old Style / Palatino et interface en Avenir Next / Segoe UI, avec polices système pour fonctionner hors connexion. Alignement à gauche, accueil photographique, sections asymétriques et peu de décor. Les photos locales de la maison portent l’identité ; la page marcheurs distingue clairement préparation du séjour et choix du circuit.

## Vérifications effectuées

Pour la dernière adaptation des durées et tarifs : syntaxes Python et JavaScript vérifiées, ainsi que `git diff --check`. Aucun parcours fonctionnel ou rendu navigateur n’a été exécuté pour cette adaptation.
