"""Comptes personnels du Noyer : propriétaires et équipe ménage.

Chaque membre choisit son propre code à 6 chiffres via un lien d'invitation à usage unique.
Le code n'est jamais stocké : seule son empreinte scrypt (avec sel) est conservée.
Les sessions sont permanentes jusqu'à la déconnexion ou la désactivation du membre ;
seule l'empreinte SHA-256 du jeton de session est enregistrée.
"""
import contextvars
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta

from reservations import BookingError

ROLES = {'owner': 'Propriétaire', 'cleaner': 'Équipe ménage'}
INVITATION_HOURS = 48
MAX_FAILURES = 5
LOCK_MINUTES = 15
IP_WINDOW_SECONDS = 600
IP_MAX_FAILURES = 30

# Membre connecté pour la requête en cours (utilisé par l'historique des dossiers).
current_member = contextvars.ContextVar('current_member', default=None)


def now_text():
    return datetime.now().isoformat(timespec='seconds')


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def hash_pin(pin, salt):
    return hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def validate_pin(pin):
    pin = str(pin or '')
    if not re.fullmatch(r'\d{6}', pin):
        raise BookingError('Le code doit contenir exactement 6 chiffres.')
    if len(set(pin)) == 1 or pin in '0123456789' or pin in '9876543210':
        raise BookingError('Choisissez un code moins prévisible (pas de chiffres identiques ni de suite).')
    return pin


def clean_name(name):
    name = ' '.join(str(name or '').split())
    if not 2 <= len(name) <= 60:
        raise BookingError('Indiquez un prénom ou un nom (2 à 60 caractères).')
    return name


def initialize_accounts(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK(role IN ('owner','cleaner')),
        pin_hash BLOB, pin_salt BLOB,
        active INTEGER NOT NULL DEFAULT 1,
        failed_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
        created_at TEXT NOT NULL, last_login_at TEXT)''')
    connection.execute('''CREATE TABLE IF NOT EXISTS member_invitations (
        token_hash TEXT PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id),
        expires_at TEXT NOT NULL, used_at TEXT)''')
    connection.execute('''CREATE TABLE IF NOT EXISTS member_sessions (
        token_hash TEXT PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id),
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, device TEXT NOT NULL DEFAULT '')''')


class Throttle:
    """Frein en mémoire contre les essais répétés depuis une même adresse."""

    def __init__(self):
        self.lock = threading.Lock()
        self.failures = {}

    def check(self, address):
        with self.lock:
            recent = [moment for moment in self.failures.get(address, []) if time.time() - moment < IP_WINDOW_SECONDS]
            self.failures[address] = recent
            if len(recent) >= IP_MAX_FAILURES:
                raise BookingError('Trop d’essais depuis cet appareil. Réessayez dans quelques minutes.', 429)

    def fail(self, address):
        with self.lock:
            self.failures.setdefault(address, []).append(time.time())


class Accounts:
    def __init__(self, store):
        self.store = store
        self.throttle = Throttle()
        with store.connection(True) as connection:
            initialize_accounts(connection)

    # Sessions -------------------------------------------------------------
    def _open_session(self, connection, member_id, device):
        token = secrets.token_urlsafe(32)
        moment = now_text()
        connection.execute('INSERT INTO member_sessions(token_hash,member_id,created_at,last_seen_at,device) VALUES(?,?,?,?,?)',
                           (digest(token), member_id, moment, moment, str(device or '')[:120]))
        connection.execute('UPDATE members SET last_login_at=?,failed_count=0,locked_until=NULL WHERE id=?', (moment, member_id))
        return token

    def member_for_session(self, token):
        if not token or len(token) > 100:
            return None
        with self.store.connection() as connection:
            row = connection.execute('''SELECT members.id,members.name,members.role FROM member_sessions
                JOIN members ON members.id=member_sessions.member_id
                WHERE member_sessions.token_hash=? AND members.active=1 AND members.pin_hash IS NOT NULL''',
                (digest(token),)).fetchone()
        return dict(row) if row else None

    def touch(self, token):
        with self.store.connection(True) as connection:
            connection.execute('UPDATE member_sessions SET last_seen_at=? WHERE token_hash=?', (now_text(), digest(token)))

    def logout(self, token):
        if token:
            with self.store.connection(True) as connection:
                connection.execute('DELETE FROM member_sessions WHERE token_hash=?', (digest(token),))

    # Connexion ------------------------------------------------------------
    def login(self, name, pin, address, device):
        self.throttle.check(address)
        failure = BookingError('Nom ou code incorrect.', 401)
        name = ' '.join(str(name or '').split())
        pin = str(pin or '')
        with self.store.connection(True) as connection:
            row = connection.execute('SELECT * FROM members WHERE name=? COLLATE NOCASE AND active=1', (name,)).fetchone()
            if not row or row['pin_hash'] is None:
                hash_pin(pin or '000000', b'equalise-le-temps')  # même coût de calcul que pour un vrai compte
                self.throttle.fail(address)
                raise failure
            if row['locked_until'] and row['locked_until'] > now_text():
                raise BookingError('Compte bloqué après plusieurs codes faux. Réessayez dans 15 minutes.', 429)
            if hmac.compare_digest(hash_pin(pin, row['pin_salt']), row['pin_hash']):
                token = self._open_session(connection, row['id'], device)
                return token, {'id': row['id'], 'name': row['name'], 'role': row['role']}
            # Code faux : le compteur est enregistré (la transaction est validée) avant de signaler l'erreur.
            count = row['failed_count'] + 1
            locked = (datetime.now() + timedelta(minutes=LOCK_MINUTES)).isoformat(timespec='seconds') if count >= MAX_FAILURES else None
            connection.execute('UPDATE members SET failed_count=?,locked_until=? WHERE id=?', (0 if locked else count, locked, row['id']))
        self.throttle.fail(address)
        if locked:
            raise BookingError('Compte bloqué après plusieurs codes faux. Réessayez dans 15 minutes.', 429)
        raise failure

    def accept_invitation(self, invitation, pin, address, device):
        self.throttle.check(address)
        pin = validate_pin(pin)
        if not invitation or len(str(invitation)) > 100:
            raise BookingError('Lien d’invitation invalide.', 400)
        with self.store.connection(True) as connection:
            row = connection.execute('''SELECT member_invitations.*,members.name,members.role FROM member_invitations
                JOIN members ON members.id=member_invitations.member_id
                WHERE token_hash=?''', (digest(str(invitation)),)).fetchone()
            if not row or row['used_at'] or row['expires_at'] < now_text():
                self.throttle.fail(address)
                raise BookingError('Ce lien d’invitation n’est plus valable. Demandez-en un nouveau au propriétaire.', 410)
            salt = secrets.token_bytes(16)
            connection.execute('UPDATE members SET pin_hash=?,pin_salt=?,active=1,failed_count=0,locked_until=NULL WHERE id=?',
                               (hash_pin(pin, salt), salt, row['member_id']))
            connection.execute('UPDATE member_invitations SET used_at=? WHERE token_hash=?', (now_text(), row['token_hash']))
            token = self._open_session(connection, row['member_id'], device)
            return token, {'id': row['member_id'], 'name': row['name'], 'role': row['role']}

    def invitation_info(self, invitation):
        with self.store.connection() as connection:
            row = connection.execute('''SELECT members.name,members.role,member_invitations.expires_at,member_invitations.used_at
                FROM member_invitations JOIN members ON members.id=member_invitations.member_id WHERE token_hash=?''',
                (digest(str(invitation or '')),)).fetchone()
        if not row or row['used_at'] or row['expires_at'] < now_text():
            raise BookingError('Ce lien d’invitation n’est plus valable. Demandez-en un nouveau au propriétaire.', 410)
        return {'name': row['name'], 'role': row['role'], 'role_label': ROLES[row['role']]}

    def change_pin(self, member_id, current, new):
        new = validate_pin(new)
        with self.store.connection(True) as connection:
            row = connection.execute('SELECT pin_hash,pin_salt FROM members WHERE id=?', (member_id,)).fetchone()
            if not row or not hmac.compare_digest(hash_pin(str(current or ''), row['pin_salt']), row['pin_hash']):
                raise BookingError('Code actuel incorrect.', 403)
            salt = secrets.token_bytes(16)
            connection.execute('UPDATE members SET pin_hash=?,pin_salt=? WHERE id=?', (hash_pin(new, salt), salt, member_id))
        return {'ok': True}

    # Gestion des membres (propriétaires) -----------------------------------
    def _invite(self, connection, member_id):
        token = secrets.token_urlsafe(24)
        expires = (datetime.now() + timedelta(hours=INVITATION_HOURS)).isoformat(timespec='seconds')
        connection.execute('UPDATE member_invitations SET used_at=? WHERE member_id=? AND used_at IS NULL', (now_text(), member_id))
        connection.execute('INSERT INTO member_invitations(token_hash,member_id,expires_at) VALUES(?,?,?)', (digest(token), member_id, expires))
        return {'invitation': token, 'expires_at': expires}

    def members(self):
        with self.store.connection() as connection:
            rows = connection.execute('''SELECT members.id,members.name,members.role,members.active,members.created_at,members.last_login_at,
                members.pin_hash IS NOT NULL AS has_pin,members.locked_until,
                (SELECT COUNT(*) FROM member_sessions WHERE member_sessions.member_id=members.id) AS sessions,
                (SELECT MAX(expires_at) FROM member_invitations WHERE member_invitations.member_id=members.id AND used_at IS NULL) AS pending_invitation
                FROM members ORDER BY members.role,members.name COLLATE NOCASE''').fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item['has_pin'] = bool(item['has_pin'])
            item['active'] = bool(item['active'])
            if item['pending_invitation'] and item['pending_invitation'] < now_text():
                item['pending_invitation'] = None
            result.append(item)
        return {'members': result, 'roles': ROLES}

    def add_member(self, data):
        name = clean_name(data.get('name'))
        role = data.get('role')
        if role not in ROLES:
            raise BookingError('Choisissez un rôle.')
        with self.store.connection(True) as connection:
            if connection.execute('SELECT 1 FROM members WHERE name=? COLLATE NOCASE', (name,)).fetchone():
                raise BookingError('Un membre porte déjà ce nom. Ajoutez une initiale pour les distinguer.', 409)
            member_id = connection.execute('INSERT INTO members(name,role,created_at) VALUES(?,?,?)', (name, role, now_text())).lastrowid
            invitation = self._invite(connection, member_id)
        return {'id': member_id, 'name': name, 'role': role, **invitation}

    def reinvite(self, member_id):
        with self.store.connection(True) as connection:
            row = connection.execute('SELECT name FROM members WHERE id=?', (member_id,)).fetchone()
            if not row:
                raise BookingError('Membre introuvable.', 404)
            connection.execute('UPDATE members SET active=1 WHERE id=?', (member_id,))
            invitation = self._invite(connection, member_id)
        return {'id': member_id, 'name': row['name'], **invitation}

    def deactivate(self, member_id, acting_member_id=None):
        if acting_member_id == member_id:
            raise BookingError('Vous ne pouvez pas désactiver votre propre compte.', 409)
        with self.store.connection(True) as connection:
            if not connection.execute('UPDATE members SET active=0 WHERE id=?', (member_id,)).rowcount:
                raise BookingError('Membre introuvable.', 404)
            connection.execute('DELETE FROM member_sessions WHERE member_id=?', (member_id,))
            connection.execute('UPDATE member_invitations SET used_at=? WHERE member_id=? AND used_at IS NULL', (now_text(), member_id))
        return {'ok': True}

    def sign_out_everywhere(self, member_id):
        with self.store.connection(True) as connection:
            connection.execute('DELETE FROM member_sessions WHERE member_id=?', (member_id,))
        return {'ok': True}
