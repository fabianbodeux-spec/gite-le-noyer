# Le Noyer

Site local HTML, CSS, JavaScript et serveur Python sans dépendance supplémentaire.

## Démarrer

```sh
cd ~/le-noyer-v6
python3 demarrer.py
```

Ouvrir l’adresse indiquée par le serveur (ports 8040 à 8042). Le formulaire nécessite ce serveur : ouvrir simplement le fichier HTML ne suffit pas. Arrêter avec Ctrl+C.

## Pages et ressources

- `index.html` : maison, galerie filtrable avec agrandissement, demande de séjour.
- `midweek.html` : espace dédié aux marcheurs, choix de distances, circuits existants, téléchargement GPX, aperçu local du tracé et préparation du séjour.
- `site.css` : styles partagés, adaptations mobile, focus clavier et réduction des mouvements.
- `site.js` : interactions, navigation des photos et distances au clavier, formulaire et aperçu GPX sans dépendance à une carte externe.
- `favicon.svg` : monogramme N et feuillage, utilisé pour le logo et le favicon.

Les liens depuis les circuits préremplissent le type de séjour et la distance dans la demande. Les catégories 5, 10, 15, 20 et 30 km indiquent des envies de distance ; le kilométrage publié reste visible séparément.

`demarrer.py` lance le serveur de `serveur.py` et ne régénère pas l’accueil. Les anciens scripts de génération restent archivés dans le dossier ; ne pas les lancer pour modifier la nouvelle version. La base `demandes.sqlite3`, les photos et les traces sont conservées. Les réservations sont gérées localement, sans paiement ni envoi d’e-mail.

## Gestion des locations

Au démarrage, Terminal affiche l’adresse `/admin` et une clé propriétaire. Ouvrez cette adresse et saisissez la clé. Elle est conservée uniquement dans la mémoire de la page et change à chaque démarrage. Pour utiliser une clé stable, définissez `NOYER_ADMIN_TOKEN` dans votre environnement (au moins 24 caractères). Ne partagez pas cette clé avec les visiteurs.

1. Choisissez l’année dans la gestion.
2. Ajoutez vos périodes tarifaires : première nuit comprise, fin exclue, prix en semaine, prix du vendredi/samedi, frais de ménage et minimum de nuits. Une période peut couvrir toute l’année, du 1er janvier au 1er janvier suivant. Les périodes ne peuvent pas se chevaucher ; modifiez ou désactivez un tarif pour le remplacer par plusieurs saisons.
3. Vérifiez le calendrier : les nuits sans tarif restent signalées et ne peuvent pas faire l’objet d’une demande chiffrée.
4. Dans « Ajouter des dates indisponibles », en haut de la gestion, saisissez l’arrivée et le départ ou cliquez sur ces deux dates dans le calendrier annuel. Choisissez le motif puis cliquez sur « Enregistrer l’indisponibilité ». Le formulaire fonctionne même sans tarif ni demande préalable. La nuit du départ reste libre. L’année affichée suit automatiquement l’arrivée enregistrée.
5. Le visiteur choisit ses dates et son groupe, calcule le prix puis demande ce séjour.
6. Confirmez ou refusez dans `/admin`. Une confirmation bloque les nuits ; une annulation les libère. Plusieurs demandes en attente peuvent concerner les mêmes nuits, mais une seule peut être confirmée.

Aucun tarif de démonstration n’est installé. Les prix sont ceux du logement entier, en euros, avec un maximum de 30 voyageurs. Chaque nuit utilise sa période tarifaire ; le ménage est facturé une seule fois selon la période d’arrivée. Si un séjour traverse plusieurs périodes, le minimum de nuits le plus élevé s’applique. Aucun autre supplément ni taxe n’est ajouté automatiquement : la grille doit correspondre au prix que vous souhaitez proposer.

Le prix de chaque demande est archivé. Un changement de tarif oblige le visiteur à recalculer son devis avant l’envoi. La confirmation du propriétaire accepte le prix archivé, et non le nouveau tarif. Une modification des dates ou du groupe impose une nouvelle demande. Les anciennes demandes restent conservées, en attente et sans devis ; elles ne peuvent pas être confirmées directement.

Le prévisionnel annuel additionne les nuits des séjours confirmés sur l’année et le ménage si l’arrivée est dans l’année. Ce montant représente les réservations confirmées, pas des paiements reçus. La vue publique ne contient pas les noms, e-mails ni motifs de blocage.

La base est migrée au premier lancement sans supprimer les demandes existantes. Les écritures utilisent une transaction SQLite verrouillée et la disponibilité est revérifiée à la confirmation pour éviter les doubles réservations concurrentes. Les fichiers Python et SQLite ne sont pas téléchargeables via le serveur.

Si `/admin` affiche seulement l’ancien tableau des demandes, arrêtez l’ancien serveur dans Terminal avec Ctrl+C, relancez `python3 ~/le-noyer-v6/demarrer.py`, puis utilisez exactement l’adresse « Gestion » affichée par ce nouveau processus. Rechargez la page. Le nouveau backend affiche « Vos locations. » et demande une clé propriétaire ; l’ancien tableau ne propose pas les nouveaux formulaires.

Ce serveur écoute uniquement sur ce Mac (`127.0.0.1`). Une mise en ligne nécessitera un hébergement adapté, HTTPS et la configuration de l’envoi d’e-mails et du paiement si souhaités. Le calendrier connaît uniquement les réservations et blocages saisis dans cette base ; aucune synchronisation avec une plateforme externe n’est active.

## API

- `GET /api/availability?year=2030` : calendrier public, nuits disponibles, occupées ou sans tarif.
- `POST /api/quote` : `arrival`, `departure`, `guests` ; retourne le détail, le total en centimes et un `token`.
- `POST /api/requests` : coordonnées, dates, groupe et `quote_token` ; crée une demande en attente.
- `GET /api/admin/state?year=2030` : tarifs, demandes, blocages et prévisionnel.
- `POST /api/admin/rates` : crée un tarif ou modifie son `id` ; montants `nightly`, `weekend`, `cleaning` en euros.
- `POST /api/admin/blocks` : `start`, `end`, `reason`.
- `POST /api/admin/requests/ID/status` : `status` parmi `confirmed`, `cancelled`, `rejected`.
- `POST /api/admin/rates/ID/deactivate` ou `/api/admin/blocks/ID/deactivate` : désactivation sans suppression.

Les routes de gestion nécessitent `Authorization: Bearer CLÉ`. Les écritures utilisent `Content-Type: application/json`. Une indisponibilité, un tarif manquant, un devis périmé ou un chevauchement renvoie un conflit HTTP 409.

## Direction visuelle

Palette : forêt `#183628`, ivoire `#F8F6EF`, cuivre `#AA8061`, sauge `#E8EDE3`, texte `#223C30`, blanc `#FFFFFF`.

Titres en Iowan Old Style / Palatino et interface en Avenir Next / Segoe UI, avec polices système pour fonctionner hors connexion. Alignement à gauche, accueil photographique, sections asymétriques et peu de décor. Les photos locales de la maison portent l’identité ; la page marcheurs distingue clairement préparation du séjour et choix du circuit.

## Vérifications effectuées

- Syntaxe JavaScript (`node --check`) et syntaxe Python.
- Présence des ressources locales et absence d’identifiants HTML dupliqués.
- 14 tests sur bases temporaires : tarification semaine/week-end, frais, minimum, trous tarifaires, modification de prix, conservation du devis, demandes en attente, confirmation, annulation, séjours adjacents, confirmations concurrentes, blocages, migration des anciennes demandes, prévisionnel sur deux années, confidentialité et autorisation des routes.
- Vérification que le serveur n’écrit plus `index.html`.

Le contrôle visuel ordinateur/mobile et le test HTTP sur un port réel restent à effectuer : l’accès navigateur a échoué et les permissions empêchent le serveur local d’écouter dans l’environnement de travail. Les gestionnaires HTTP ont été testés directement sans réseau. Les liens de circuits existants ont été conservés ; leur contenu externe n’a pas été revérifié.
