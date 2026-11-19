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

- `index.html` : maison, galerie filtrable avec agrandissement, demande de séjour.
- `midweek.html` : espace dédié aux marcheurs, choix de distances, circuits existants, téléchargement GPX, aperçu local du tracé et préparation du séjour.
- `site.css` : styles partagés, adaptations mobile, focus clavier et réduction des mouvements.
- `site.js` : interactions, navigation des photos et distances au clavier, formulaire et aperçu GPX sans dépendance à une carte externe.
- `favicon.svg` : monogramme N et feuillage, utilisé pour le logo et le favicon.

Les liens depuis les circuits préremplissent le type de séjour et la distance dans la demande. Les catégories 5, 10, 15, 20 et 30 km indiquent des envies de distance ; le kilométrage publié reste visible séparément.

`demarrer.py` lance le serveur de `serveur.py` et ne régénère pas l’accueil. Les anciens scripts de génération restent archivés dans le dossier ; ne pas les lancer pour modifier la nouvelle version. La base `demandes.sqlite3`, les photos et les traces sont conservées. Les réservations sont gérées localement, sans paiement ni envoi d’e-mail.

## Gestion des locations

Au démarrage, Terminal affiche l’adresse `/admin` et une clé propriétaire. Ouvrez cette adresse et saisissez la clé. La clé est conservée localement dans `.noyer-admin-key` (permissions privées, fichier exclu de Git et du serveur web) et reste identique entre les redémarrages. Dans le navigateur, elle n’est conservée qu’en mémoire pendant la session. Pour utiliser une clé stable, définissez `NOYER_ADMIN_TOKEN` dans votre environnement (au moins 24 caractères). Ne partagez pas cette clé avec les visiteurs.

1. Choisissez l’année dans la gestion.
2. Ajoutez vos périodes tarifaires : arrivées comprises entre le début inclus et la fin exclue, prix du forfait mid-week complet, prix du forfait week-end complet et frais de ménage. Une période peut couvrir toute l’année, du 1er janvier au 1er janvier suivant. Les périodes ne peuvent pas se chevaucher ; modifiez ou désactivez un tarif pour le remplacer par plusieurs saisons.
3. Vérifiez le calendrier : les dates sans tarif restent signalées. Les montants visibles le lundi et le vendredi correspondent au forfait complet, pas à une nuit. Sans tarif pour l’arrivée choisie, aucun devis ne peut être créé.
4. Dans « Ajouter des dates indisponibles », en haut de la gestion, saisissez l’arrivée et le départ ou cliquez sur ces deux dates dans le calendrier annuel. Choisissez le motif puis cliquez sur « Enregistrer l’indisponibilité ». Le formulaire fonctionne même sans tarif ni demande préalable. La nuit du départ reste libre. L’année affichée suit automatiquement l’arrivée enregistrée.
5. Le visiteur choisit ses dates et son groupe, calcule le prix puis demande ce séjour.
6. Confirmez ou refusez dans `/admin`. Une confirmation bloque les nuits ; une annulation les libère. Plusieurs demandes en attente peuvent concerner les mêmes nuits, mais une seule peut être confirmée.

Aucune location à la nuit : deux séjours sont proposés, mid-week du lundi à 17 h au vendredi à 9 h, et week-end du vendredi à 17 h au lundi à 9 h. Le formulaire calcule automatiquement le départ. Le serveur refuse tout autre jour ou durée, même via un appel direct à l’API. Les combinaisons de forfaits ou séjours plus longs ne sont pas proposés actuellement. Les blocages manuels restent libres de dates pour gérer les travaux et réservations externes.

Aucun tarif de démonstration n’est installé. Les prix sont ceux du logement entier, en euros, avec un maximum de 30 voyageurs. Le forfait et le ménage sont ceux de la période d’arrivée, même si le séjour traverse une autre période ou une autre année. Aucun autre supplément ni taxe n’est ajouté automatiquement : la grille doit correspondre au prix que vous souhaitez proposer.

Les anciens tarifs à la nuit restent conservés dans la table `rates`, mais ne servent plus aux nouveaux devis. Les forfaits sont enregistrés séparément dans `package_rates` et doivent être renseignés avec vos montants réels : aucune conversion automatique des anciens prix n’est effectuée. Les anciennes réservations confirmées restent bloquantes et conservent leur prix ; les anciennes demandes en attente nécessitent un nouveau devis au forfait avant confirmation.

Le prix de chaque demande est archivé. Un changement de tarif oblige le visiteur à recalculer son devis avant l’envoi. La confirmation du propriétaire accepte le prix archivé, et non le nouveau tarif. Une modification des dates ou du groupe impose une nouvelle demande. Les anciennes demandes restent conservées, en attente et sans devis ; elles ne peuvent pas être confirmées directement.

Pour les nouveaux forfaits, le prévisionnel annuel rattache le séjour complet et son ménage à l’année d’arrivée. Les anciens séjours confirmés à la nuit conservent leur calcul historique, avec les nuits de l’année et le ménage dans l’année d’arrivée. Ce montant représente les réservations confirmées, pas des paiements reçus. La vue publique ne contient pas les noms, e-mails ni motifs de blocage.

La base est migrée au premier lancement sans supprimer les demandes existantes. Les écritures utilisent une transaction SQLite verrouillée et la disponibilité est revérifiée à la confirmation pour éviter les doubles réservations concurrentes. Les fichiers Python et SQLite ne sont pas téléchargeables via le serveur.

Si `/admin` affiche seulement l’ancien tableau des demandes, arrêtez l’ancien serveur dans Terminal avec Ctrl+C, relancez `python3 ~/le-noyer-v6/demarrer.py`, puis utilisez exactement l’adresse « Gestion » affichée par ce nouveau processus. Rechargez la page. Le nouveau backend affiche « Vos locations. » et demande une clé propriétaire ; l’ancien tableau ne propose pas les nouveaux formulaires.

Ce serveur écoute uniquement sur ce Mac (`127.0.0.1`). Une mise en ligne nécessitera un hébergement adapté, HTTPS et la configuration de l’envoi d’e-mails et du paiement si souhaités. Le calendrier connaît uniquement les réservations et blocages saisis dans cette base ; aucune synchronisation avec une plateforme externe n’est active.

## Simplification du travail propriétaire

Après connexion sur `/admin`, la navigation donne accès à « Aujourd’hui », aux dossiers, au planning ménage, aux tarifs et au blocage manuel.

- **Aujourd’hui** : demandes à venir en attente, arrivées et départs du jour, arrivées dans les 14 jours et conflits. Les raccourcis ouvrent le dossier concerné. Les actions immédiates incluent les dossiers à venir hors de l’année affichée ; le calendrier et la grille restent liés à l’année choisie.
- **Préremplissage d’un e-mail** : ouvrir « Ajouter une demande externe ou par téléphone », coller le message puis choisir « Préremplir les informations ». Une extraction locale par règles recherche les champs explicitement libellés : nom, e-mail, arrivée, départ, voyageurs, référence et total en euros. Elle ne lit aucune messagerie et ne contacte aucune plateforme. Les champs inconnus restent vides. Vérifier et corriger le brouillon avant « Enregistrer le dossier à vérifier » ; aucun séjour n’est confirmé à cette étape.
- **Dossiers externes** : Ardennes-étape, Villa for You, Belvilla, téléphone et autre origine. Le nom, l’e-mail et le montant peuvent rester inconnus lors de la saisie. La confirmation nécessite ensuite un nom, un e-mail et un montant au forfait. « Compléter / modifier » permet de corriger un dossier externe en attente ; une modification remet les indicateurs de devis envoyé et de règlement vérifié à zéro pour les revérifier. Les notes privées sont conservées. Une référence déjà enregistrée pour une même origine ou un même message sans référence pour les mêmes dates ne crée pas de second dossier.
- **Réponses préparées** : depuis un dossier, préparer un devis, une relance, les informations d’arrivée ou une réponse d’indisponibilité lorsque les dates sont occupées. Le texte est modifiable puis copiable vers votre messagerie ou la plateforme. Aucun message n’est envoyé automatiquement et la copie ne marque pas un devis comme envoyé. Le modèle d’arrivée est réservé aux séjours confirmés au forfait. Aucun code d’accès n’est inventé.
- **Grille annuelle** : modifier directement les prix de chaque période, copier les prix d’une saison vers le formulaire d’une nouvelle période, ou cocher plusieurs saisons et appliquer les mêmes prix en une seule opération. Une copie doit recevoir de nouvelles dates sans chevauchement. Un lot entier est annulé si une des périodes n’est plus active. Les devis existants conservent leur prix.
- **Planning ménage** : chaque départ confirmé génère une rotation affichée entre 9 h et 17 h, avec l’arrivée du même jour si elle existe. Le bouton « Marquer la maison prête » enregistre une validation manuelle. Une annulation retire la rotation de la liste. Les rotations passées non validées restent visibles sur l’année sélectionnée. Aucun intervenant n’est contacté automatiquement.
- **Checklist et notes** : coordonnées, devis préparé et statut sont déduits du dossier ; devis envoyé, règlement vérifié, informations d’accès transmises et ménage effectué se cochent manuellement. « Enregistrer le suivi » persiste ces cases et les notes privées. Le règlement vérifié est une déclaration du propriétaire, pas une vérification bancaire. Une version de dossier empêche qu’une modification ancienne écrase silencieusement un suivi plus récent.

Les tables supplémentaires sont créées de manière additive au redémarrage. `booking_workflows` conserve l’origine, la référence, les notes et la checklist ; les demandes externes rejoignent la table de demandes existante. Le planning ménage est calculé à partir des confirmations, sans service de tâches planifiées. Le backend continue de fonctionner localement sur le Mac, sans dépendance supplémentaire ni connexion automatique aux trois plateformes.

Pour afficher ces nouveautés, arrêter l’ancien processus avec Ctrl+C puis relancer `python3 ~/le-noyer-v6/demarrer.py`. Utiliser l’adresse « Gestion » et la clé affichées par ce nouveau processus. Recharger ensuite `/admin`.

## API

- `GET /api/availability?year=2030` : calendrier public, nuits disponibles, occupées ou sans tarif.
- `POST /api/quote` : `arrival`, `departure`, `guests`, éventuellement `package` (`midweek` ou `weekend`, sinon déduit des dates) ; retourne le forfait, les horaires, le ménage, le total en centimes et un `token`.
- `POST /api/requests` : coordonnées, dates, groupe et `quote_token` ; crée une demande en attente.
- `GET /api/admin/state?year=2030` : tarifs, demandes, blocages et prévisionnel.
- `POST /api/admin/rates` : crée un tarif forfaitaire ou modifie son `id` ; montants `midweek`, `weekend`, `cleaning` en euros. Les deux premiers représentent le forfait complet.
- `POST /api/admin/blocks` : `start`, `end`, `reason`.
- `POST /api/admin/requests/ID/status` : `status` parmi `confirmed`, `cancelled`, `rejected`.
- `POST /api/admin/rates/ID/deactivate` ou `/api/admin/blocks/ID/deactivate` : désactivation sans suppression.
- `GET /api/admin/workspace?year=2030` : actions du jour, dossiers enrichis et rotations ménage.
- `POST /api/admin/import-preview` : `text` ; extrait un brouillon sans sauvegarder de demande.
- `POST /api/admin/external` : origine `source`, référence `reference`, coordonnées connues, dates, groupe, `total` facultatif en euros et message ; crée une demande en attente.
- `POST /api/admin/external/ID` : complète un dossier externe en attente avec les mêmes champs et sa `version` actuelle.
- `POST /api/admin/requests/ID/workflow` : `version`, `notes` et objet `checklist` de booléens parmi `quote_sent`, `payment_verified`, `access_sent`, `cleaning_done`.
- `POST /api/admin/requests/ID/draft` : `kind` parmi `quote`, `arrival`, `followup`, `unavailable` ; retourne un brouillon, jamais un envoi.
- `POST /api/admin/rates/bulk` : liste `ids` de périodes et montants `midweek`, `weekend`, `cleaning` ; mise à jour atomique.

Les routes de gestion nécessitent `Authorization: Bearer CLÉ`. Les écritures utilisent `Content-Type: application/json`. Une indisponibilité, un tarif manquant, un devis périmé ou un chevauchement renvoie un conflit HTTP 409.

## Réservation côté visiteurs

Deux choix visibles ouvrent le parcours : mid-week du lundi 17 h au vendredi 9 h, ou week-end du vendredi 17 h au lundi 9 h. Le calendrier occupe la partie principale de la réservation, avec des cases de 78 px minimum sur ordinateur et de 62 px sur petit écran. Le formulaire est placé à droite sur ordinateur et sous le calendrier sur mobile.

Les boutons « Arrivée » sélectionnent un séjour complet. Une arrivée n’est proposée que si son forfait est tarifé et si aucune nuit du séjour n’est bloquée ; le contrôle couvre aussi le passage de décembre à janvier. Les autres arrivées sont indiquées comme complètes, passées ou à tarifer. Le serveur revérifie toujours le prix et la disponibilité avant l’enregistrement. Les champs de dates restent utilisables et le départ est calculé automatiquement.

Le bouton de connexion propriétaire affiche maintenant un message explicite si le module de gestion manque, si un ancien serveur répond, si la clé est refusée ou si le serveur reste injoignable. Les espaces accidentels et le libellé « Clé propriétaire : » sont retirés de la saisie. Ces messages ne modifient pas les autorisations d’accès.

Contrôles exécutés : 11 vérifications du calendrier (forfaits, dates occupées, prix manquant, année suivante et calcul de dates), vérification du bouton de connexion sans module, réponses 401/404 et nettoyage de la clé, puis persistance et permissions de la clé sur un dossier temporaire. Le rendu visuel ordinateur/mobile reste à contrôler dans un navigateur disponible.

## Direction visuelle

Palette : forêt `#183628`, ivoire `#F8F6EF`, cuivre `#AA8061`, sauge `#E8EDE3`, texte `#223C30`, blanc `#FFFFFF`.

Titres en Iowan Old Style / Palatino et interface en Avenir Next / Segoe UI, avec polices système pour fonctionner hors connexion. Alignement à gauche, accueil photographique, sections asymétriques et peu de décor. Les photos locales de la maison portent l’identité ; la page marcheurs distingue clairement préparation du séjour et choix du circuit.

## Vérifications effectuées

- Syntaxe JavaScript (`node --check`) et syntaxe Python.
- Présence des ressources locales et absence d’identifiants HTML dupliqués.
- 13 tests sur bases temporaires pour les forfaits : mid-week, week-end, refus des nuits isolées et autres durées, choix de la période d’arrivée, archivage des anciens tarifs, évolution du prix et devis conservé, séjours adjacents, blocages libres, dossiers historiques, confirmations concurrentes, calendrier forfaitaire, désactivation et passage d’année. Le calcul du départ et le refus du mauvais jour sont aussi vérifiés en JavaScript.
- Les contrôles précédents d’autorisation des routes, de confidentialité et de migration ont été exécutés lors de la première version du backend ; le rendu navigateur de cette adaptation n’a pas été vérifié.
- 16 tests supplémentaires sur bases temporaires pour le poste propriétaire : extraction de messages, absence d’informations inventées, doublons et annulation des écritures partielles, complétion de dossiers, versions concurrentes, ménage et annulation, brouillons non envoyés, conflits, prix groupés atomiques, devis conservés, vue du jour toutes années, migrations répétées, routes privées et conservation des règles de forfait.
- Structure HTML du backend, correspondance des identifiants JavaScript et présence des ressources vérifiées. Syntaxes des quatre scripts JavaScript vérifiées. Le navigateur de contrôle reste indisponible ; aucun contrôle visuel ordinateur/mobile n’est annoncé pour cette version.
- Vérification que le serveur n’écrit plus `index.html`.

Le contrôle visuel ordinateur/mobile et le test HTTP sur un port réel restent à effectuer : l’accès navigateur a échoué et les permissions empêchent le serveur local d’écouter dans l’environnement de travail. Les gestionnaires HTTP ont été testés directement sans réseau. Les liens de circuits existants ont été conservés ; leur contenu externe n’a pas été revérifié.
