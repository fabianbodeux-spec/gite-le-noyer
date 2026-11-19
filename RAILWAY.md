# Mettre Le Noyer en ligne sur Railway

Le projet contient maintenant un `Dockerfile`, `requirements.txt`, `railway.toml` et une entrée WSGI. Railway construit l’image puis démarre Gunicorn sur `0.0.0.0` avec le port fourni par `PORT`. Une seule instance est prévue pour la base SQLite.

Le lancement local reste `python3 demarrer.py`. En ligne, conserver la commande de démarrage du Dockerfile : ne pas la remplacer par ce lancement local qui écoute uniquement sur `127.0.0.1`.

## 1. Choisir le projet et le service

Dans un onglet Terminal distinct de celui du serveur local :

```sh
cd ~/le-noyer-v6
railway whoami
railway link
railway status
```

Sélectionner le projet, l’environnement et le service destinés au Noyer. Si aucun projet n’existe encore, utiliser `railway init --name le-noyer`, puis `railway add --service le-noyer` et `railway link --service le-noyer`. Si le projet existe mais n’a pas encore de service, ajouter seulement le service puis le sélectionner. Vérifier le résultat de `railway status` avant les opérations suivantes.

## 2. Ajouter le stockage persistant

```sh
railway volume list
```

S’il n’y a pas déjà de volume monté sur `/data` pour ce service :

```sh
railway volume add --mount-path /data
```

Ne pas ajouter un second volume si le bon existe déjà. Le service stockera `demandes.sqlite3` sur ce volume. Sur Railway, le démarrage échoue si le volume manque ou si le dossier de données configuré est en dehors de ce volume. Les migrations se font au démarrage, lorsque le volume est disponible, jamais pendant la construction de l’image.

## 3. Configurer les variables et la clé propriétaire

```sh
railway variable set NOYER_ENV=production NOYER_DATA_DIR=/data --skip-deploys
python3 -c 'from serveur import load_admin_token; print(load_admin_token(), end="")' | railway variable set NOYER_ADMIN_TOKEN --stdin --skip-deploys
```

La seconde commande transmet la clé locale au service par l’entrée standard, sans l’inscrire dans la commande shell ni dans Git. Elle réutilise la clé locale ou en crée une si nécessaire. Cette clé permettra d’ouvrir `/admin` en ligne. Ne pas envoyer sa valeur dans une conversation ou une capture de logs. La configuration en ligne refuse de démarrer sans clé explicite et ne l’imprime pas dans les logs de déploiement.

Le fuseau horaire du conteneur est `Europe/Brussels`. Railway fournit `PORT` automatiquement. Ne pas ajouter de variable `PORT` arbitraire si aucun réglage de port particulier n’est nécessaire.

## 4. Envoyer les fichiers et déployer

```sh
railway up --detach
railway logs --build --lines 80 --latest
railway logs --lines 80 --latest
```

`railway up` envoie les fichiers du dossier courant, y compris les modifications non commitées. Il ne nécessite pas de push GitHub. La base locale, la clé, les sauvegardes et les fichiers d’environnement sont exclus du paquet et de l’image. Photos et traces sont incluses comme ressources du site.

Le contrôle de santé `/healthz` doit réussir avant que Railway route le trafic. Attendre la fin de la construction et du démarrage avant de poursuivre. Si les logs mentionnent un volume ou une clé manquante, corriger le réglage puis relancer `railway up --detach`.

## 5. Obtenir l’adresse du site

```sh
railway domain
```

Ouvrir l’adresse HTTPS indiquée pour voir le site. Ajouter `/admin` pour la gestion et saisir la clé propriétaire configurée à l’étape 3. Vérifier également `/healthz`, qui doit répondre `{"ok": true}`. Pour vérifier l’état du service depuis le tableau de bord, utiliser `railway open`.

## Données existantes et mise en service

La base de ce Mac n’est pas envoyée : le premier déploiement crée une base vide sur le volume. Les tarifs et blocages du Mac ne seront donc pas automatiquement présents en ligne. La copie locale reste intacte. Avant d’accepter des demandes publiques, soit saisir les forfaits et indisponibilités dans la nouvelle gestion, soit organiser une migration contrôlée de la base locale vers le volume avec sauvegarde et arrêt des écritures. Ne pas remplacer un fichier SQLite pendant que l’application l’utilise.

Le volume conserve les données entre redéploiements. Activer également les sauvegardes du volume dans Railway. Le paiement en ligne, l’envoi automatique d’e-mails et les connexions aux trois plateformes ne sont pas activés par ce déploiement.

## Déploiement via GitHub, en alternative

Il est possible de connecter le dépôt `fabianbodeux-spec/gite-le-noyer` au service Railway et de sélectionner la branche `feature/centralisation-demandes`. Cette méthode nécessite de commiter et pousser les nouveaux fichiers avant de déployer. Les réglages de volume et variables restent nécessaires. Choisir ensuite une méthode de mise à jour cohérente, par CLI ou par GitHub, afin d’identifier la version réellement déployée.

## Contrôles effectués

Neuf tests sur stockage temporaire : routes publiques et santé, protection des fichiers et routes privées, création d’un forfait et d’une demande puis confirmation, conservation après recréation de l’application, refus sans clé, refus sans volume Railway, utilisation du volume, refus d’un dossier extérieur au volume, méthodes HTTP et absence de fichier de clé en production. Les réponses passent le validateur WSGI de Python. Les syntaxes JavaScript sont vérifiées.

La construction Docker, l’installation réelle de Gunicorn et le déploiement distant n’ont pas pu être exécutés dans l’environnement de travail : Docker est absent, Gunicorn n’est pas installé et le terminal ne résout pas l’API Railway. Les commandes ci-dessus sont vérifiées avec l’aide du CLI Railway 4.45.0 installé sur le Mac.

Références : [port et adresse d’écoute](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond), [volumes persistants](https://docs.railway.com/volumes), [configuration du déploiement](https://docs.railway.com/config-as-code/reference), [contrôle de santé](https://docs.railway.com/deployments/healthchecks).
