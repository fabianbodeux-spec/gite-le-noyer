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
from accounts import Accounts, current_member, ROLES

ROOT = Path(__file__).resolve().parent
SESSION_COOKIE = 'noyer_session'


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


def load_cleaning_token(root=ROOT, create=False):
    configured = os.environ.get('NOYER_CLEANING_TOKEN')
    if configured is not None:
        token = configured.strip()
    elif create:
        target = root / '.noyer-cleaning-key'
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            token = target.read_text().strip()
        else:
            token = secrets.token_urlsafe(32)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(token + '\n')
        target.chmod(0o600)
    else:
        return ''
    if len(token) < 24 or any(character.isspace() for character in token):
        raise SystemExit('La clé équipe ménage doit contenir au moins 24 caractères sans espace.')
    return token


mimetypes.add_type('font/woff2', '.woff2')
STATIC_ASSETS = r'photos/[0-9]+\.jpg|vendor/three\.module\.min\.js|fonts/[a-z-]+\.woff2|relief/lienne\.bin'


def make_handler(store, admin_token, root=ROOT, cleaner_token=''):
    operations = Operations(store)
    cleaning_token = cleaner_token.strip()
    if cleaning_token and (len(cleaning_token) < 24 or any(character.isspace() for character in cleaning_token)):
        raise SystemExit('NOYER_CLEANING_TOKEN doit contenir au moins 24 caractères sans espace.')
    accounts = Accounts(store)
    secure_cookie = bool(os.environ.get('RAILWAY_ENVIRONMENT_ID') or os.environ.get('NOYER_ENV') == 'production')

    def session_cookie(token, max_age=315360000):
        value = f'{SESSION_COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict'
        return value + ('; Secure' if secure_cookie else '')

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, mime='application/json; charset=utf-8', cache='no-store', headers=None):
            if isinstance(body, dict):
                body = json.dumps(body, ensure_ascii=False).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            for name, value in {'Content-Type': mime, 'Content-Length': str(len(body)),
                                'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
                                'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin'}.items():
                self.send_header(name, value)
            for name, value in headers or ():
                self.send_header(name, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def session_token(self):
            for part in self.headers.get('Cookie', '').split(';'):
                name, _, value = part.strip().partition('=')
                if name == SESSION_COOKIE:
                    return value
            return ''

        def address(self):
            forwarded = self.headers.get('X-Forwarded-For', '').split(',')[0].strip()
            return forwarded or (getattr(self, 'client_address', None) or ('',))[0]

        def same_origin(self):
            # Les cookies sont SameSite=Strict ; on refuse en plus tout envoi d'une autre origine.
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host', ''):
                raise BookingError('Origine de la requête refusée.', 403)

        def session_member(self, roles):
            member = accounts.member_for_session(self.session_token())
            if member and member['role'] in roles:
                if self.command == 'POST':
                    self.same_origin()
                current_member.set(member)
                return member
            return None

        def authorize(self):
            supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if supplied and hmac.compare_digest(supplied.encode(), admin_token.encode()):
                current_member.set({'id': None, 'name': 'Clé de secours', 'role': 'owner'})
                return current_member.get()
            member = self.session_member(('owner',))
            if member:
                return member
            raise BookingError('Connexion propriétaire requise.', 401)

        def authorize_cleaner(self):
            supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if supplied and cleaning_token and hmac.compare_digest(supplied.encode(), cleaning_token.encode()):
                current_member.set({'id': None, 'name': 'Clé d’équipe', 'role': 'cleaner'})
                return current_member.get()
            member = self.session_member(('cleaner', 'owner'))
            if member:
                return member
            raise BookingError('Connexion de l’équipe requise.', 401)

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
                current_member.set(None)
                url = urlsplit(self.path)
                params = parse_qs(url.query)
                if url.path == '/healthz':
                    with store.connection() as connection:
                        connection.execute('SELECT 1').fetchone()
                    return self.respond(200, {'ok': True})
                if url.path == '/api/admin/workspace':
                    self.authorize()
                    return self.respond(200, operations.workspace(params.get('year', [str(date.today().year)])[0]))
                if url.path == '/api/account/me':
                    member = accounts.member_for_session(self.session_token())
                    if not member:
                        raise BookingError('Non connecté.', 401)
                    accounts.touch(self.session_token())
                    return self.respond(200, {**member, 'role_label': ROLES[member['role']]})
                if url.path == '/api/account/invitation':
                    return self.respond(200, accounts.invitation_info(params.get('token', [''])[0]))
                if url.path == '/api/admin/members':
                    self.authorize()
                    return self.respond(200, accounts.members())
                if url.path == '/api/admin/settings':
                    self.authorize()
                    return self.respond(200, operations.settings())
                if url.path == '/api/admin/backup':
                    self.authorize()
                    return self.respond(200, operations.backup(), 'application/vnd.sqlite3')
                if url.path == '/api/cleaning/workspace':
                    self.authorize_cleaner()
                    return self.respond(200, operations.cleaning_workspace())
                if url.path in ('/api/availability', '/api/admin/state'):
                    private = url.path == '/api/admin/state'
                    if private:
                        self.authorize()
                    return self.respond(200, store.calendar(params.get('year', [str(date.today().year)])[0], private))
                path = unquote(url.path)
                relative = {'/': 'index.html', '/admin': 'admin.html', '/equipe-menage': 'equipe-menage.html', '/invitation': 'invitation.html'}.get(path, path.lstrip('/'))
                allowed = relative in ('index.html', 'midweek.html', 'site.css', 'site.js', 'favicon.svg', 'booking.js', 'admin.html', 'admin.js', 'booking.css', 'workspace.js', 'workspace.css', 'equipe-menage.html', 'cleaning.js', 'cleaning.css', 'relief.js', 'relief.css', 'ui.js', 'admin-glass.css', 'invitation.html', 'invitation.js')
                static_asset = bool(re.fullmatch(STATIC_ASSETS, relative))
                allowed = allowed or static_asset or bool(re.fullmatch(r'traces/promenade-12\.(gpx|geojson)', relative))
                target = (root / relative).resolve()
                if not allowed or not target.is_relative_to(root.resolve()) or not target.is_file():
                    raise BookingError('Page introuvable.', 404)
                return self.respond(200, target.read_bytes(), mimetypes.guess_type(str(target))[0] or 'application/octet-stream',
                                    'public, max-age=86400' if static_asset else 'no-store')
            except BookingError as error:
                self.respond(error.status, {'error': str(error)})
            except (sqlite3.Error, OSError):
                self.respond(500, {'error': 'Lecture impossible. Réessayez.'})

        def do_POST(self):
            try:
                current_member.set(None)
                path = urlsplit(self.path).path
                if path.startswith('/api/admin/'):
                    self.authorize()
                elif path.startswith('/api/cleaning/'):
                    self.authorize_cleaner()
                if path.startswith('/api/account/'):
                    return self.account(path)
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
                if path == '/api/admin/settings':
                    return self.respond(200, operations.update_settings(data))
                if path == '/api/admin/members':
                    return self.respond(201, accounts.add_member(data))
                match = re.fullmatch(r'/api/admin/members/(\d+)/(invite|deactivate|signout)', path)
                if match:
                    member_id = int(match[1])
                    if match[2] == 'invite':
                        return self.respond(200, accounts.reinvite(member_id))
                    if match[2] == 'deactivate':
                        return self.respond(200, accounts.deactivate(member_id, (current_member.get() or {}).get('id')))
                    return self.respond(200, accounts.sign_out_everywhere(member_id))
                if path == '/api/admin/rates/bulk':
                    return self.respond(200, operations.bulk_rates(data))
                match = re.fullmatch(r'/api/cleaning/tasks/(\d+)/(received|complete)', path)
                if match:
                    return self.respond(200, operations.cleaning_task_update(int(match[1]), match[2]))
                match = re.fullmatch(r'/api/admin/external/(\d+)', path)
                if match:
                    return self.respond(200, operations.add_inquiry(data, int(match[1])))
                match = re.fullmatch(r'/api/admin/requests/(\d+)/(workflow|draft|payment|message-sent|cleaning-notified)', path)
                if match:
                    if match[2] == 'workflow':
                        return self.respond(200, operations.update_workflow(int(match[1]), data))
                    if match[2] == 'draft':
                        return self.respond(200, operations.draft(int(match[1]), data.get('kind'), data.get('payment_id')))
                    if match[2] == 'payment':
                        return self.respond(200, operations.record_payment(int(match[1]), data))
                    if match[2] == 'cleaning-notified':
                        return self.respond(200, operations.mark_cleaning_team_notified(int(match[1]),data.get('channel')))
                    return self.respond(200, operations.mark_message_sent(int(match[1]), data))
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

        def account(self, path):
            """Connexion, invitation, déconnexion et changement de code."""
            self.same_origin()
            device = self.headers.get('User-Agent', '')
            if path == '/api/account/logout':
                accounts.logout(self.session_token())
                return self.respond(200, {'ok': True}, headers=[('Set-Cookie', session_cookie('', 0))])
            data = self.read_json()
            if path == '/api/account/login':
                token, member = accounts.login(data.get('name'), data.get('pin'), self.address(), device)
                return self.respond(200, {**member, 'role_label': ROLES[member['role']]}, headers=[('Set-Cookie', session_cookie(token))])
            if path == '/api/account/invitation':
                token, member = accounts.accept_invitation(data.get('token'), data.get('pin'), self.address(), device)
                return self.respond(200, {**member, 'role_label': ROLES[member['role']]}, headers=[('Set-Cookie', session_cookie(token))])
            if path == '/api/account/pin':
                member = accounts.member_for_session(self.session_token())
                if not member:
                    raise BookingError('Non connecté.', 401)
                return self.respond(200, accounts.change_pin(member['id'], data.get('current'), data.get('new')))
            raise BookingError('Route inconnue.', 404)

    return Handler


def main():
    store = Store(ROOT / 'demandes.sqlite3')
    store.initialize()
    token = load_admin_token()
    cleaner_token = load_cleaning_token(ROOT, create=True)
    server = None
    for port in (8040, 8041, 8042):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(store, token, cleaner_token=cleaner_token))
            break
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise SystemExit('Impossible de démarrer le serveur local : ' + str(error))
    if server is None:
        raise SystemExit('Ports 8040, 8041 et 8042 occupés.')
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'\nLE NOYER\nSite : {url}/\nGestion : {url}/admin\nEspace ménage : {url}/equipe-menage\nClé propriétaire : {token}\nClé équipe ménage : {cleaner_token}\nArrêter : Ctrl+C\n', flush=True)
    webbrowser.open(url + '/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
