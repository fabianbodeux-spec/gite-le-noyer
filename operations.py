import hashlib
import json
import re
import sqlite3
from datetime import date, timedelta

from reservations import BookingError, PACKAGES, cents, dates, integer, parse_date, stay_package


SOURCES = ('direct', 'ardennes-etape', 'villaforyou', 'belvilla', 'telephone', 'autre')
FLAGS = ('quote_sent', 'payment_verified', 'access_sent', 'cleaning_done')


def initialize_operations(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS booking_workflows (
        booking_id INTEGER PRIMARY KEY REFERENCES demandes(id),
        source TEXT NOT NULL DEFAULT 'direct', reference TEXT,
        fingerprint TEXT UNIQUE, notes TEXT NOT NULL DEFAULT '',
        checklist TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0)''')
    connection.execute('''CREATE UNIQUE INDEX IF NOT EXISTS workflow_reference
        ON booking_workflows(source,reference) WHERE reference IS NOT NULL''')


def preview_email(text):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 12000:
        raise BookingError('Collez un message de 12 000 caractères maximum.')
    normalized = text.replace('\r\n', '\n')
    fields = {'source': 'autre', 'reference': '', 'name': '', 'email': '',
              'arrival': '', 'departure': '', 'guests': '', 'total': '', 'message': text}
    lowered = text.casefold()
    for source, pattern in [('ardennes-etape', r'ardennes[ -]?[ée]tape'),
                            ('villaforyou', r'villa\s*for\s*you'), ('belvilla', r'belvilla')]:
        if re.search(pattern, lowered):
            fields['source'] = source
            break
    patterns = {
        'name': r'(?:nom(?: du (?:client|voyageur))?|guest name|client)\s*[:：]\s*([^\n]+)',
        'email': r'(?:e-?mail(?: du (?:client|voyageur))?|guest email)\s*[:：]\s*([^\s<>]+@[^\s<>]+)',
        'reference': r'(?:r[ée]f[ée]rence(?: de r[ée]servation)?|reservation id|booking (?:id|reference))\s*[:：#]\s*([^\n]+)',
        'guests': r'(?:voyageurs|personnes|guests|nombre de personnes)\s*[:：]\s*(\d+)',
        'arrival': r'(?:arriv[ée]e|check[ -]?in|arrival)\s*[:：]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/.]\d{2}[/.]\d{4})',
        'departure': r'(?:d[ée]part|check[ -]?out|departure)\s*[:：]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/.]\d{2}[/.]\d{4})',
        'total': r'(?:montant total|total(?: du s[ée]jour)?)\s*[:：]\s*([\d ,.\u00a0\u202f]+)\s*(?:€|EUR)(?![A-Za-z])',
    }
    warnings = ['Extraction indicative : vérifiez chaque champ avec le message d’origine. Aucun séjour n’est confirmé.']
    for key, pattern in patterns.items():
        match = re.search(pattern, normalized, re.I)
        if match:
            value = match[1].strip()
            if key in ('arrival', 'departure'):
                if '/' in value or '.' in value:
                    day, month, year = re.split(r'[/.]', value)
                    value = f'{year}-{month}-{day}'
                try:
                    parse_date(value)
                except BookingError:
                    value = ''
            if key == 'total':
                value = re.sub(r'[\s\u00a0\u202f]', '', value)
                if ',' in value:
                    value = value.replace('.', '').replace(',', '.')
                try:
                    cents(value)
                except BookingError:
                    value = ''
            fields[key] = value
    for key, label in [('arrival', 'Arrivée'), ('departure', 'Départ'), ('name', 'Nom'), ('email', 'E-mail du voyageur')]:
        if not fields[key]:
            warnings.append(label + ' non identifié : à compléter.')
    if fields['arrival'] and fields['departure']:
        try:
            stay_package(parse_date(fields['arrival']), parse_date(fields['departure']))
        except BookingError as error:
            warnings.append(str(error))
    return {'fields': fields, 'warnings': warnings}


class Operations:
    def __init__(self, store):
        self.store = store

    def add_inquiry(self, data, identifier=None):
        source = data.get('source')
        if source not in SOURCES or source == 'direct':
            raise BookingError('Choisissez une origine externe ou téléphone.')
        start, end = dates(data.get('arrival'), data.get('departure'))
        package = stay_package(start, end)
        name, email = str(data.get('name') or '').strip(), str(data.get('email') or '').strip()
        if len(name) > 100 or len(email) > 254 or (email and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email)):
            raise BookingError('Nom ou e-mail invalide. Laissez vide une information inconnue.')
        guests = integer(data.get('guests'), 1, 30, 'Nombre de voyageurs')
        reference = str(data.get('reference') or '').strip() or None
        if reference and len(reference) > 150:
            raise BookingError('Référence trop longue (150 caractères maximum).')
        message = str(data.get('message') or '').strip()
        if len(message) > 12000:
            raise BookingError('Message trop long.')
        total = cents(data['total']) if data.get('total') is not None and str(data.get('total', '')).strip() else None
        quote = None if total is None else {'package': package, 'package_label': PACKAGES[package]['label'],
                    'arrival': start.isoformat(), 'departure': end.isoformat(), 'arrival_time': '17:00',
                    'departure_time': '09:00', 'total_cents': total, 'currency': 'EUR',
                    'origin': 'external', 'cleaning_cents': None}
        fingerprint = hashlib.sha256((source+'\n'+start.isoformat()+'\n'+end.isoformat()+'\n'+message).encode()).hexdigest() if message and not reference else None
        try:
            with self.store.connection(True) as connection:
                if identifier:
                    existing = connection.execute('SELECT demandes.status,workflow.source,workflow.checklist,workflow.version FROM demandes JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?', (identifier,)).fetchone()
                    if not existing or existing['status'] != 'pending' or existing['source'] == 'direct':
                        raise BookingError('Seul un dossier externe en attente peut être modifié.', 409)
                    if existing['version'] != integer(data.get('version'), 0, 100000000, 'Version'):
                        raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
                    connection.execute('UPDATE demandes SET name=?,email=?,arrival=?,departure=?,guests=?,message=?,quote_json=?,total_cents=? WHERE id=?',
                                       (name,email,start.isoformat(),end.isoformat(),guests,message,json.dumps(quote,ensure_ascii=False) if quote else None,total,identifier))
                    flags = json.loads(existing['checklist'])
                    flags['quote_sent'] = False
                    flags['payment_verified'] = False
                    connection.execute('UPDATE booking_workflows SET source=?,reference=?,fingerprint=?,checklist=?,version=version+1 WHERE booking_id=?',
                                       (source,reference,fingerprint,json.dumps(flags),identifier))
                else:
                    cursor = connection.execute('''INSERT INTO demandes
                    (created_at,name,email,arrival,departure,guests,occasion,message,status,quote_json,total_cents)
                    VALUES(datetime('now'),?,?,?,?,?,?,?,'pending',?,?)''',
                    (name, email, start.isoformat(), end.isoformat(), guests, 'Demande externe à vérifier', message,
                     json.dumps(quote, ensure_ascii=False) if quote else None, total))
                    identifier = cursor.lastrowid
                    connection.execute('INSERT INTO booking_workflows(booking_id,source,reference,fingerprint) VALUES(?,?,?,?)',
                                       (identifier, source, reference, fingerprint))
                conflict = self.store.unavailable(connection, start.isoformat(), end.isoformat())
                return {'id': identifier, 'status': 'pending', 'conflict': conflict}
        except sqlite3.IntegrityError:
            raise BookingError('Cette référence ou ce message a déjà été enregistré. Consultez le dossier existant.', 409)

    def update_workflow(self, identifier, data):
        flags = data.get('checklist', {})
        if not isinstance(flags, dict) or any(key not in FLAGS or not isinstance(value, bool) for key, value in flags.items()):
            raise BookingError('Checklist invalide.')
        notes = data.get('notes', '')
        if not isinstance(notes, str) or len(notes) > 4000:
            raise BookingError('Notes limitées à 4 000 caractères.')
        version = integer(data.get('version'), 0, 100000000, 'Version')
        with self.store.connection(True) as connection:
            if not connection.execute('SELECT id FROM demandes WHERE id=?', (identifier,)).fetchone():
                raise BookingError('Dossier introuvable.', 404)
            connection.execute('INSERT OR IGNORE INTO booking_workflows(booking_id) VALUES(?)', (identifier,))
            if not connection.execute('''UPDATE booking_workflows SET checklist=?,notes=?,version=version+1
                                         WHERE booking_id=? AND version=?''',
                                      (json.dumps(flags), notes, identifier, version)).rowcount:
                raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
        return {'ok': True, 'version': version+1}

    def workspace(self, year):
        year = integer(year, 2000, 2100, 'Année')
        today = date.today().isoformat()
        horizon = (date.today()+timedelta(days=14)).isoformat()
        with self.store.connection() as connection:
            rows = [dict(row) for row in connection.execute('''SELECT demandes.*,
                COALESCE(workflow.source,'direct') AS source, workflow.reference,
                COALESCE(workflow.notes,'') AS notes, COALESCE(workflow.checklist,'{}') AS checklist,
                COALESCE(workflow.version,0) AS version
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                ORDER BY arrival,id''')]
            for row in rows:
                row['checklist'] = json.loads(row['checklist'])
                row['has_quote'] = row['quote_json'] is not None
                quote = json.loads(row['quote_json']) if row['quote_json'] else {}
                row['package'] = quote.get('package')
                row['confirmable'] = row['status'] == 'pending' and row['package'] in PACKAGES and bool(row['name'] and row['email'])
                row['conflict'] = self.store.unavailable(connection, row['arrival'], row['departure'], row['id']) if row['status'] in ('pending', 'confirmed') else False
                row.pop('quote_json')
        confirmed = [row for row in rows if row['status'] == 'confirmed']
        cleaning = []
        for row in confirmed:
            if not row['departure'].startswith(str(year)):
                continue
            incoming = next((other for other in confirmed if other['arrival'] == row['departure']), None)
            cleaning.append({'booking_id': row['id'], 'date': row['departure'], 'start': '09:00', 'deadline': '17:00',
                             'same_day_arrival': incoming['id'] if incoming else None,
                             'done': row['checklist'].get('cleaning_done', False)})
        return {'today': today,
                'pending': [row['id'] for row in rows if row['status'] == 'pending' and row['departure'] > today],
                'arrivals': [row['id'] for row in confirmed if row['arrival'] == today],
                'departures': [row['id'] for row in confirmed if row['departure'] == today],
                'upcoming': [row['id'] for row in confirmed if today < row['arrival'] <= horizon],
                'conflicts': [row['id'] for row in rows if row['conflict'] and row['departure'] > today],
                'records': [row for row in rows if row['arrival'] < f'{year+1}-01-01' and row['departure'] > f'{year}-01-01'
                            or row['status'] == 'pending' and row['departure'] > today
                            or row['status'] == 'confirmed' and today <= row['departure'] and row['arrival'] <= horizon],
                'cleaning': cleaning}

    def bulk_rates(self, data):
        identifiers = data.get('ids')
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 100:
            raise BookingError('Sélectionnez de 1 à 100 périodes.')
        identifiers = sorted(set(integer(value, 1, 100000000, 'Identifiant') for value in identifiers))
        values = (cents(data.get('midweek')), cents(data.get('weekend')), cents(data.get('cleaning'), True))
        with self.store.connection(True) as connection:
            for identifier in identifiers:
                if not connection.execute('UPDATE package_rates SET midweek_cents=?,weekend_cents=?,cleaning_cents=? WHERE id=? AND active=1', values+(identifier,)).rowcount:
                    raise BookingError('Une période a changé ou a été désactivée. Actualisez la grille.', 409)
        return {'updated': len(identifiers)}

    def draft(self, identifier, kind):
        with self.store.connection() as connection:
            row = connection.execute('SELECT * FROM demandes WHERE id=?', (identifier,)).fetchone()
            if not row:
                raise BookingError('Dossier introuvable.', 404)
            quote = json.loads(row['quote_json']) if row['quote_json'] else None
            schedule = f"du {row['arrival']} à 17 h au {row['departure']} à 9 h"
            greeting = 'Bonjour' + (' '+row['name'] if row['name'] else '') + ',\n\n'
            if kind == 'quote':
                if row['status'] not in ('pending', 'confirmed') or not quote or quote.get('package') not in PACKAGES:
                    raise BookingError('Un devis au forfait est nécessaire pour préparer cette réponse.')
                if row['status'] == 'pending' and self.store.unavailable(connection, row['arrival'], row['departure'], identifier):
                    raise BookingError('Dates occupées : ne proposez pas ce devis.', 409)
                amount = f"{row['total_cents']/100:.2f}".replace('.', ',')
                body = f"Votre séjour {quote['package_label']} au Noyer {schedule} représente un montant total de {amount} €.\n"
                body += 'Cette proposition reste soumise à confirmation. Aucun paiement n’est enregistré par ce message.'
                subject = 'Votre proposition de séjour au Noyer'
            elif kind == 'arrival':
                if row['status'] != 'confirmed' or not quote or quote.get('package') not in PACKAGES:
                    raise BookingError('Les informations d’arrivée sont réservées aux séjours confirmés au forfait.')
                body = f"Nous vous accueillerons au Noyer {schedule}.\nAdresse : Rue Bierleux 69A, 4990 Lierneux, Belgique.\nMerci de nous communiquer votre heure d’arrivée prévue pour organiser la remise des clés."
                subject = 'Préparer votre arrivée au Noyer'
            elif kind == 'followup':
                if row['status'] != 'pending':
                    raise BookingError('Ce dossier n’est plus en attente.')
                body = f"Souhaitez-vous poursuivre votre demande de séjour au Noyer {schedule} ?\nMerci de nous indiquer si votre projet est toujours d’actualité. Les disponibilités seront revérifiées avant confirmation."
                subject = 'Votre projet de séjour au Noyer'
            elif kind == 'unavailable':
                if not self.store.unavailable(connection, row['arrival'], row['departure'], identifier):
                    raise BookingError('Aucun conflit enregistré : vérifiez les dates avant de répondre indisponible.')
                body = 'Les dates de votre demande ne sont plus disponibles. Nous pouvons rechercher un autre mid-week ou week-end pour votre groupe.'
                subject = 'Les dates de votre demande au Noyer'
            else:
                raise BookingError('Modèle inconnu.')
        return {'subject': subject, 'body': greeting+body+'\n\nLe Noyer', 'recipient': row['email'], 'sent': False}
