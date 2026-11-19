from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote
from datetime import date
import errno
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import webbrowser

from reservations import Store, BookingError
from operations import Operations, preview_email

ROOT = Path(__file__).resolve().parent


def load_admin_token(root=ROOT, required=False):
    configured = os.environ.get('NOYER_ADMIN_TOKEN')
    if required and configured is None:
        raise SystemExit('Configurez NOYER_ADMIN_TOKEN avant de démarrer le service en ligne.')
    if configured is not None:
        token = configured.strip()
    else:
        target = root / '.noyer-admin-key'
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            token = target.read_text().strip()
        else:
            token = secrets.token_urlsafe(32)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(token + '\n')
        target.chmod(0o600)
    if len(token) < 24 or any(character.isspace() for character in token):
        raise SystemExit('La clé propriétaire doit contenir au moins 24 caractères, sans espace. Vérifiez NOYER_ADMIN_TOKEN ou .noyer-admin-key.')
    return token


def make_handler(store, admin_token, root=ROOT):
    operations = Operations(store)
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, mime='application/json; charset=utf-8'):
            if isinstance(body, dict):
                body = json.dumps(body, ensure_ascii=False).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            for name, value in {'Content-Type': mime, 'Content-Length': str(len(body)),
                                'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin'}.items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def authorize(self):
            supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if not hmac.compare_digest(supplied.encode(), admin_token.encode()):
                raise BookingError('Clé propriétaire requise.', 401)

        def read_json(self):
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise BookingError('JSON requis.', 415)
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 1 <= length <= (64000 if urlsplit(self.path).path.startswith('/api/admin/') else 16000):
                    length = 0
                if length:
                    data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise BookingError('Requête JSON invalide.')
            if not length:
                raise BookingError('Taille de requête invalide.', 413)
            if not isinstance(data, dict):
                raise BookingError('Objet JSON requis.')
            return data

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            try:
                url = urlsplit(self.path)
                params = parse_qs(url.query)
                if url.path == '/healthz':
                    with store.connection() as connection:
                        connection.execute('SELECT 1').fetchone()
                    return self.respond(200, {'ok': True})
                if url.path == '/api/admin/workspace':
                    self.authorize()
                    return self.respond(200, operations.workspace(params.get('year', [str(date.today().year)])[0]))
                if url.path in ('/api/availability', '/api/admin/state'):
                    private = url.path == '/api/admin/state'
                    if private:
                        self.authorize()
                    return self.respond(200, store.calendar(params.get('year', [str(date.today().year)])[0], private))
                path = unquote(url.path)
                relative = {'/': 'index.html', '/admin': 'admin.html'}.get(path, path.lstrip('/'))
                allowed = relative in ('index.html', 'midweek.html', 'site.css', 'site.js', 'favicon.svg', 'booking.js', 'admin.html', 'admin.js', 'booking.css', 'workspace.js', 'workspace.css')
                allowed = allowed or bool(re.fullmatch(r'photos/[0-9]+\.jpg|traces/promenade-12\.(gpx|geojson)', relative))
                target = (root / relative).resolve()
                if not allowed or not target.is_relative_to(root.resolve()) or not target.is_file():
                    raise BookingError('Page introuvable.', 404)
                return self.respond(200, target.read_bytes(), mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
            except BookingError as error:
                self.respond(error.status, {'error': str(error)})
            except (sqlite3.Error, OSError):
                self.respond(500, {'error': 'Lecture impossible. Réessayez.'})

        def do_POST(self):
            try:
                path = urlsplit(self.path).path
                if path.startswith('/api/admin/'):
                    self.authorize()
                data = self.read_json()
                if path == '/api/quote':
                    return self.respond(200, store.quote(data))
                if path == '/api/requests':
                    return self.respond(201, store.request(data))
                if path == '/api/admin/rates':
                    return self.respond(200, store.save_rate(data))
                if path == '/api/admin/blocks':
                    return self.respond(201, store.block(data))
                if path == '/api/admin/import-preview':
                    return self.respond(200, preview_email(data.get('text')))
                if path == '/api/admin/external':
                    return self.respond(201, operations.add_inquiry(data))
                if path == '/api/admin/rates/bulk':
                    return self.respond(200, operations.bulk_rates(data))
                match = re.fullmatch(r'/api/admin/external/(\d+)', path)
                if match:
                    return self.respond(200, operations.add_inquiry(data, int(match[1])))
                match = re.fullmatch(r'/api/admin/requests/(\d+)/(workflow|draft)', path)
                if match:
                    if match[2] == 'workflow':
                        return self.respond(200, operations.update_workflow(int(match[1]), data))
                    return self.respond(200, operations.draft(int(match[1]), data.get('kind')))
                match = re.fullmatch(r'/api/admin/requests/(\d+)/status', path)
                if match:
                    return self.respond(200, store.status(int(match[1]), data.get('status')))
                match = re.fullmatch(r'/api/admin/(rates|blocks)/(\d+)/deactivate', path)
                if match:
                    return self.respond(200, store.deactivate(match[1], int(match[2])))
                raise BookingError('Route inconnue.', 404)
            except BookingError as error:
                self.respond(error.status, {'error': str(error)})
            except sqlite3.Error:
                self.respond(503, {'error': 'La base est momentanément indisponible. Réessayez.'})

    return Handler


def main():
    store = Store(ROOT / 'demandes.sqlite3')
    store.initialize()
    token = load_admin_token()
    server = None
    for port in (8040, 8041, 8042):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(store, token))
            break
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise SystemExit('Impossible de démarrer le serveur local : ' + str(error))
    if server is None:
        raise SystemExit('Ports 8040, 8041 et 8042 occupés.')
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'\nLE NOYER\nSite : {url}/\nGestion : {url}/admin\nClé propriétaire : {token}\nArrêter : Ctrl+C\n', flush=True)
    webbrowser.open(url + '/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
