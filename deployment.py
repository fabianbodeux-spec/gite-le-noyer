import json
import logging
import os
from email.message import Message
from http import HTTPStatus
from pathlib import Path

from reservations import Store
from serveur import ROOT, load_admin_token, load_cleaning_token, make_handler


def create_application(root=ROOT):
    railway = bool(os.environ.get('RAILWAY_ENVIRONMENT_ID'))
    production = railway or os.environ.get('NOYER_ENV') == 'production'
    mount = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH')
    data_dir = Path(os.environ.get('NOYER_DATA_DIR') or mount or root).resolve()
    if railway and (not mount or not data_dir.is_relative_to(Path(mount).resolve())):
        raise SystemExit('Ajoutez un volume Railway monté sur /data pour conserver les réservations.')
    if production and not os.environ.get('NOYER_ADMIN_TOKEN'):
        raise SystemExit('Configurez NOYER_ADMIN_TOKEN dans les variables du service Railway.')
    data_dir.mkdir(parents=True, exist_ok=True)
    token = load_admin_token(data_dir, required=production)
    cleaner_token = load_cleaning_token(data_dir)
    store = Store(data_dir / 'demandes.sqlite3')
    store.initialize()
    handler_class = make_handler(store, token, root, cleaner_token)

    def application(environ, start_response):
        response = []

        def respond(status, body, mime='application/json; charset=utf-8'):
            if isinstance(body, dict):
                body = json.dumps(body, ensure_ascii=False).encode()
            elif isinstance(body, str):
                body = body.encode()
            headers = [('Content-Type', mime), ('Content-Length', str(len(body))),
                       ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
                       ('X-Frame-Options', 'DENY'), ('Referrer-Policy', 'same-origin')]
            start_response(f'{status} {HTTPStatus(status).phrase}', headers)
            response.append(b'' if environ['REQUEST_METHOD'] == 'HEAD' else body)

        method = environ['REQUEST_METHOD']
        if method not in ('GET', 'HEAD', 'POST'):
            respond(405, {'error': 'Méthode non autorisée.'})
            return response
        handler = object.__new__(handler_class)
        handler.command = method
        handler.path = environ.get('PATH_INFO', '/')
        if environ.get('QUERY_STRING'):
            handler.path += '?' + environ['QUERY_STRING']
        handler.headers = Message()
        for key, value in environ.items():
            if key.startswith('HTTP_'):
                handler.headers[key[5:].replace('_', '-')] = value
        for key in ('CONTENT_TYPE', 'CONTENT_LENGTH'):
            if environ.get(key):
                handler.headers[key.replace('_', '-')] = environ[key]
        handler.rfile = environ['wsgi.input']
        handler.respond = respond
        try:
            getattr(handler, 'do_' + method)()
        except Exception:
            logging.exception('Erreur de traitement du site Le Noyer')
            if not response:
                respond(500, {'error': 'Erreur du serveur. Réessayez dans un instant.'})
        return response

    return application
