import hashlib
import json
import logging
import re
import sqlite3
from datetime import date, datetime, timedelta

from reservations import BookingError, PACKAGES, cents, dates, integer, parse_date, stay_package


SOURCES = ('direct', 'ardennes-etape', 'villaforyou', 'belvilla', 'telephone', 'autre')
FLAGS = ('access_sent', 'cleaning_done', 'reception_ready')
EXTERNAL_FLAGS = ('reception_ready', 'cleaning_done')
PAYMENT_METHODS = {'transfer':'Virement bancaire','card':'Carte','cash':'Espèces','other':'Autre'}


def event_time():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def hour_text(value):
    hour, minute = value.split(':', 1)
    return f'{int(hour)} h' + (f' {minute}' if minute != '00' else '')


def date_text(value):
    current = parse_date(value)
    weekdays = ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche')
    months = ('janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre')
    return f"{weekdays[current.weekday()]} {current.day} {months[current.month-1]} {current.year}"


def arrival_access_text(arrival, departure, arrival_time, departure_time):
    return (f"Nous vous attendons au Noyer le {date_text(arrival)} à {hour_text(arrival_time)}.\n"
        f"Votre départ est prévu le {date_text(departure)} à {hour_text(departure_time)}.\n"
        "Votre correspondante sera Véronique. Si elle n’est pas présente à votre arrivée, un boîtier à clés situé à côté de la porte d’entrée vous permettra d’entrer dans la maison. Son code est 1234. Vous pourrez l’utiliser dans l’attente de l’arrivée de Véronique, qui effectuera le check-in et vous expliquera le fonctionnement de la maison.\n"
        "Adresse : Rue Bierleux 69A, 4990 Lierneux, Belgique.")


def record_event(connection, booking_id, event_type, actor='system', details=None):
    connection.execute('''INSERT INTO booking_timeline(booking_id,event_type,actor,details,created_at)
        VALUES(?,?,?,?,?)''', (booking_id,event_type,actor,json.dumps(details or {},ensure_ascii=False),event_time()))


def initialize_operations(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS booking_workflows (
        booking_id INTEGER PRIMARY KEY REFERENCES demandes(id),
        source TEXT NOT NULL DEFAULT 'direct', reference TEXT,
        fingerprint TEXT UNIQUE, notes TEXT NOT NULL DEFAULT '',
        checklist TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0)''')
    workflow_columns={row['name'] for row in connection.execute('PRAGMA table_info(booking_workflows)')}
    if 'cleaning_note' not in workflow_columns:
        connection.execute("ALTER TABLE booking_workflows ADD COLUMN cleaning_note TEXT NOT NULL DEFAULT ''")
    if 'cleaning_received_at' not in workflow_columns:
        connection.execute('ALTER TABLE booking_workflows ADD COLUMN cleaning_received_at TEXT')
    if 'arrival_time' not in workflow_columns:
        connection.execute("ALTER TABLE booking_workflows ADD COLUMN arrival_time TEXT NOT NULL DEFAULT '17:00'")
    if 'departure_time' not in workflow_columns:
        connection.execute("ALTER TABLE booking_workflows ADD COLUMN departure_time TEXT NOT NULL DEFAULT '09:00'")
    connection.execute('''CREATE UNIQUE INDEX IF NOT EXISTS workflow_reference
        ON booking_workflows(source,reference) WHERE reference IS NOT NULL''')
    connection.execute('''CREATE TABLE IF NOT EXISTS booking_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL REFERENCES demandes(id),
        event_type TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system',
        details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)''')
    connection.execute('CREATE INDEX IF NOT EXISTS timeline_booking_time ON booking_timeline(booking_id,created_at,id)')
    connection.execute('''CREATE TABLE IF NOT EXISTS booking_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL REFERENCES demandes(id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        method TEXT NOT NULL, reference TEXT, verified_at TEXT NOT NULL)''')
    connection.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    connection.execute('''CREATE UNIQUE INDEX IF NOT EXISTS payment_reference
        ON booking_payments(booking_id,reference) WHERE reference IS NOT NULL''')
    connection.execute('''INSERT INTO booking_timeline(booking_id,event_type,actor,details,created_at)
        SELECT demandes.id,'history_tracking_started','system',
               json_object('existing_status',demandes.status,'record_created_at',demandes.created_at),?
        FROM demandes WHERE NOT EXISTS (
            SELECT 1 FROM booking_timeline WHERE booking_timeline.booking_id=demandes.id)''', (event_time(),))


# Règles de paiement et de suivi, modifiables dans l'espace propriétaire.
SETTINGS_DEFAULTS = {'deposit_percent': 30, 'balance_days': 45, 'quote_hours': 24, 'access_days': 7}
SETTINGS_LIMITS = {'deposit_percent': (1, 100), 'balance_days': (0, 365), 'quote_hours': (1, 720), 'access_days': (0, 60)}


def read_settings(connection):
    values = dict(SETTINGS_DEFAULTS)
    for row in connection.execute('SELECT key,value FROM settings'):
        if row['key'] in values:
            try:
                values[row['key']] = int(row['value'])
            except ValueError:
                pass
    return values


def payment_plan(total_cents, arrival, settings):
    """Acompte non remboursable qui bloque les dates, solde dû N jours avant l'arrivée."""
    deposit = min(total_cents, (total_cents * settings['deposit_percent'] + 99) // 100)
    due = (parse_date(arrival) - timedelta(days=settings['balance_days'])).isoformat()
    return {'deposit_percent': settings['deposit_percent'], 'deposit_cents': deposit,
            'balance_due': due, 'balance_days': settings['balance_days']}


def euros(cents):
    return f"{cents/100:.2f}".replace('.', ',')


def preview_email(text):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 12000:
        raise BookingError('Collez un message de 12 000 caractères maximum.')
    normalized = text.replace('\r\n', '\n')
    fields = {'source': 'autre', 'reference': '', 'name': '', 'email': '',
              'arrival': '', 'departure': '', 'guests': '', 'message': text}
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
    }
    warnings = ['Extraction indicative : vérifiez chaque champ avec le message d’origine. Rien n’est enregistré avant la validation du formulaire.']
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
            fields[key] = value
    for key, label in [('arrival', 'Arrivée'), ('departure', 'Départ'), ('guests', 'Nombre de voyageurs')]:
        if not fields[key]:
            warnings.append(label + ' non identifié : à compléter.')
    return {'fields': fields, 'warnings': warnings}


class Operations:
    def __init__(self, store):
        self.store = store

    def add_inquiry(self, data, identifier=None):
        source = data.get('source')
        if source not in SOURCES or source == 'direct':
            raise BookingError('Choisissez une origine externe ou téléphone.')
        start, end = dates(data.get('arrival'), data.get('departure'))
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
        fingerprint = hashlib.sha256((source+'\n'+start.isoformat()+'\n'+end.isoformat()+'\n'+message).encode()).hexdigest() if message and not reference else None
        try:
            with self.store.connection(True) as connection:
                if identifier:
                    existing = connection.execute('SELECT demandes.status,demandes.arrival,demandes.departure,workflow.source,workflow.checklist,workflow.version FROM demandes JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?', (identifier,)).fetchone()
                    if not existing or existing['status'] != 'pending' or existing['source'] == 'direct':
                        raise BookingError('Seul un dossier externe en attente peut être modifié.', 409)
                    if existing['version'] != integer(data.get('version'), 0, 100000000, 'Version'):
                        raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
                    connection.execute('UPDATE demandes SET name=?,email=?,arrival=?,departure=?,guests=?,message=?,quote_json=NULL,total_cents=NULL WHERE id=?',
                                       (name,email,start.isoformat(),end.isoformat(),guests,message,identifier))
                    flags = json.loads(existing['checklist'])
                    flags['reception_ready'] = False
                    flags['cleaning_done'] = False
                    connection.execute('UPDATE booking_workflows SET source=?,reference=?,fingerprint=?,checklist=?,version=version+1 WHERE booking_id=?',
                                       (source,reference,fingerprint,json.dumps(flags),identifier))
                    record_event(connection,identifier,'external_reservation_updated','owner',{
                        'old_arrival':existing['arrival'],'old_departure':existing['departure'],
                        'arrival':start.isoformat(),'departure':end.isoformat(),'source':source,'reference':reference})
                else:
                    cursor = connection.execute('''INSERT INTO demandes
                    (created_at,name,email,arrival,departure,guests,occasion,message,status,quote_json,total_cents)
                    VALUES(datetime('now'),?,?,?,?,?,?,?,'pending',NULL,NULL)''',
                    (name, email, start.isoformat(), end.isoformat(), guests, 'Réservation externe à vérifier', message))
                    identifier = cursor.lastrowid
                    connection.execute('INSERT INTO booking_workflows(booking_id,source,reference,fingerprint) VALUES(?,?,?,?)',
                                       (identifier, source, reference, fingerprint))
                    record_event(connection,identifier,'external_reservation_received','owner',{
                        'arrival':start.isoformat(),'departure':end.isoformat(),'source':source,'reference':reference})
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
        cleaning_note = data.get('cleaning_note', '')
        if not isinstance(cleaning_note,str) or len(cleaning_note)>2000:
            raise BookingError('Les consignes de ménage sont limitées à 2 000 caractères.')
        arrival_time = data.get('arrival_time', '17:00')
        departure_time = data.get('departure_time', '09:00')
        if not isinstance(arrival_time, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', arrival_time):
            raise BookingError('Heure d’arrivée invalide.')
        if not isinstance(departure_time, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', departure_time):
            raise BookingError('Heure de départ invalide.')
        version = integer(data.get('version'), 0, 100000000, 'Version')
        with self.store.connection(True) as connection:
            booking = connection.execute('''SELECT COALESCE(workflow.source,'direct') AS source,
                COALESCE(workflow.checklist,'{}') AS checklist,COALESCE(workflow.version,0) AS version,
                COALESCE(workflow.notes,'') AS notes,COALESCE(workflow.cleaning_note,'') AS cleaning_note,
                COALESCE(workflow.arrival_time,'17:00') AS arrival_time,COALESCE(workflow.departure_time,'09:00') AS departure_time FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?''', (identifier,)).fetchone()
            if not booking:
                raise BookingError('Dossier introuvable.', 404)
            if booking['version'] != version:
                raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
            if booking['source'] != 'direct' and any(key not in EXTERNAL_FLAGS for key in flags):
                raise BookingError('Le suivi externe porte uniquement sur l’accueil et le ménage.')
            connection.execute('INSERT OR IGNORE INTO booking_workflows(booking_id) VALUES(?)', (identifier,))
            if not connection.execute('''UPDATE booking_workflows SET checklist=?,notes=?,cleaning_note=?,arrival_time=?,departure_time=?,version=version+1
                                         WHERE booking_id=? AND version=?''',
                                      (json.dumps(flags), notes, cleaning_note, arrival_time, departure_time, identifier, version)).rowcount:
                raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
            previous=json.loads(booking['checklist'])
            for key,value in flags.items():
                if bool(previous.get(key)) != value:
                    record_event(connection,identifier,'checklist_step_updated','owner',{'step':key,'completed':value})
            if booking['notes'] != notes:
                record_event(connection,identifier,'private_note_updated','owner',{})
            if booking['cleaning_note'] != cleaning_note:
                record_event(connection,identifier,'cleaning_instructions_updated','owner',{})
            if booking['arrival_time'] != arrival_time:
                record_event(connection,identifier,'arrival_time_updated','owner',{'from':booking['arrival_time'],'to':arrival_time})
            if booking['departure_time'] != departure_time:
                record_event(connection,identifier,'departure_time_updated','owner',{'from':booking['departure_time'],'to':departure_time})
        return {'ok': True, 'version': version+1}

    def workspace(self, year):
        year = integer(year, 2000, 2100, 'Année')
        today = date.today().isoformat()
        horizon = (date.today()+timedelta(days=14)).isoformat()
        with self.store.connection() as connection:
            settings = read_settings(connection)
            rows = [dict(row) for row in connection.execute('''SELECT demandes.*,
                COALESCE(workflow.source,'direct') AS source, workflow.reference,
                COALESCE(workflow.notes,'') AS notes, COALESCE(workflow.cleaning_note,'') AS cleaning_note,
                COALESCE(workflow.cleaning_received_at,'') AS cleaning_received_at,
                COALESCE(workflow.arrival_time,'17:00') AS arrival_time,COALESCE(workflow.departure_time,'09:00') AS departure_time,
                COALESCE(workflow.checklist,'{}') AS checklist,
                COALESCE(workflow.version,0) AS version
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                ORDER BY arrival,id''')]
            events_by_booking={row['id']:[] for row in rows}
            payments_by_booking={row['id']:[] for row in rows}
            if rows:
                for event in connection.execute('SELECT * FROM booking_timeline ORDER BY created_at,id'):
                    item=dict(event);item['details']=json.loads(item['details'])
                    if item['booking_id'] in events_by_booking:
                        events_by_booking[item['booking_id']].append(item)
                for payment in connection.execute('SELECT * FROM booking_payments ORDER BY verified_at,id'):
                    item=dict(payment)
                    if item['booking_id'] in payments_by_booking:
                        payments_by_booking[item['booking_id']].append(item)
            for row in rows:
                row['checklist'] = json.loads(row['checklist'])
                row['timeline'] = events_by_booking[row['id']]
                row['payments'] = payments_by_booking[row['id']]
                row['has_quote'] = row['quote_json'] is not None
                quote = json.loads(row['quote_json']) if row['quote_json'] else {}
                row['package'] = quote.get('package')
                row['external'] = row['source'] != 'direct'
                if row['external']:
                    row['total_cents'] = None
                    row['has_quote'] = False
                row['paid_cents']=sum(payment['amount_cents'] for payment in row['payments'])
                row['payment_plan']=payment_plan(row['total_cents'],row['arrival'],settings) if row['total_cents'] else None
                row['balance_cents']=max(0,row['total_cents']-row['paid_cents']) if row['total_cents'] is not None else None
                if row['external']:
                    row['payment_status']='external'
                elif row['total_cents'] is None:
                    row['payment_status']='not_quoted'
                elif row['paid_cents'] >= row['total_cents']:
                    row['payment_status']='paid'
                elif row['paid_cents']:
                    row['payment_status']='partial'
                else:
                    row['payment_status']='unpaid'
                for payment in row['payments']:
                    payment['message_sent']=any(event['event_type']=='message_sent_manually' and event['details'].get('kind')=='payment' and event['details'].get('payment_id')==payment['id'] for event in row['timeline'])
                row['confirmable'] = row['status'] == 'pending' and (row['external'] or (row['package'] in PACKAGES and bool(row['name'] and row['email'])))
                row['conflict'] = self.store.unavailable(connection, row['arrival'], row['departure'], row['id']) if row['status'] in ('pending', 'confirmed') else False
                row.pop('quote_json')
        confirmed = [row for row in rows if row['status'] == 'confirmed']
        cleaning_notifications = {}
        if confirmed:
            with self.store.connection() as connection:
                for event in connection.execute("SELECT booking_id,details FROM booking_timeline WHERE event_type='cleaning_team_notified' ORDER BY id"):
                    detail = json.loads(event['details'])
                    cleaning_notifications.setdefault(event['booking_id'], set()).add(detail.get('departure'))
        cleaning = []
        for row in confirmed:
            incoming = next((other for other in confirmed if other['arrival'] >= row['departure']), None)
            cleaning.append({'booking_id': row['id'], 'date': row['departure'], 'start': '09:00', 'deadline': '17:00',
                             'same_day_arrival': incoming['id'] if incoming and incoming['arrival']==row['departure'] else None,
                             'next_arrival': incoming['id'] if incoming else None,
                             'done': row['checklist'].get('cleaning_done', False),
                             'requested': row['departure'] in cleaning_notifications.get(row['id'], set()),
                             'received': bool(row.get('cleaning_received_at')),
                             'received_at': row.get('cleaning_received_at')})
        return {'today': today, 'settings': settings,
                'pending': [row['id'] for row in rows if row['status'] == 'pending' and row['departure'] > today],
                'arrivals': [row['id'] for row in confirmed if row['arrival'] == today],
                'departures': [row['id'] for row in confirmed if row['departure'] == today],
                'upcoming': [row['id'] for row in confirmed if today < row['arrival'] <= horizon],
                'conflicts': [row['id'] for row in rows if row['conflict'] and row['departure'] > today],
                'records': rows,
                'cleaning': cleaning}

    def cleaning_workspace(self, year=None):
        today = date.today().isoformat()
        with self.store.connection() as connection:
            bookings = [dict(row) for row in connection.execute('''SELECT demandes.id,demandes.name,demandes.arrival,demandes.departure,
                demandes.guests,COALESCE(workflow.source,'direct') AS source,
                COALESCE(workflow.cleaning_note,'') AS cleaning_note,
                COALESCE(workflow.arrival_time,'17:00') AS arrival_time,COALESCE(workflow.departure_time,'09:00') AS departure_time,
                COALESCE(workflow.checklist,'{}') AS checklist,workflow.cleaning_received_at
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                WHERE demandes.status='confirmed'
                ORDER BY demandes.departure,demandes.arrival,demandes.id''')]
            arrivals = [dict(row) for row in connection.execute('''SELECT demandes.id,demandes.name,demandes.arrival,demandes.guests,
                COALESCE(workflow.source,'direct') AS source,COALESCE(workflow.arrival_time,'17:00') AS arrival_time FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                WHERE demandes.status='confirmed' AND demandes.arrival >= ? ORDER BY demandes.arrival,demandes.id''', (today,))]
            notifications = {}
            for event in connection.execute("SELECT booking_id,details FROM booking_timeline WHERE event_type='cleaning_team_notified' ORDER BY id"):
                detail = json.loads(event['details'])
                notifications.setdefault(event['booking_id'], set()).add(detail.get('departure'))
        tasks = []
        for row in bookings:
            checklist = json.loads(row.pop('checklist'))
            task_date = row['departure']
            done = bool(checklist.get('cleaning_done', False))
            incoming = next((candidate for candidate in arrivals if candidate['arrival'] >= task_date), None)
            tasks.append({'booking_id': row['id'], 'date': task_date, 'guest_name': row['name'] or 'Voyageurs',
                'guest_count': row['guests'], 'arrival': row['arrival'], 'departure': row['departure'],
                'checkout_time': row['departure_time'], 'checkin_time': row['arrival_time'], 'cleaning_note': row['cleaning_note'],
                'incoming_arrival': ({'booking_id': incoming['id'], 'guest_name': incoming['name'] or 'Voyageurs',
                    'guest_count': incoming['guests'], 'date': incoming['arrival'], 'checkin_time': incoming['arrival_time']} if incoming else None),
                'requested': task_date in notifications.get(row['id'], set()),
                'received': bool(row['cleaning_received_at']), 'received_at': row['cleaning_received_at'],
                'done': done})
        return {'today': today, 'tasks': tasks}

    def cleaning_task_update(self, identifier, action):
        if action not in ('received', 'complete'):
            raise BookingError('Action de ménage inconnue.', 404)
        with self.store.connection(True) as connection:
            row = connection.execute('''SELECT demandes.status,demandes.departure,workflow.checklist,workflow.cleaning_received_at
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?''', (identifier,)).fetchone()
            if not row or row['status'] != 'confirmed':
                raise BookingError('Rotation de ménage introuvable ou séjour non confirmé.', 404)
            connection.execute('INSERT OR IGNORE INTO booking_workflows(booking_id) VALUES(?)', (identifier,))
            if action == 'received':
                if not any(json.loads(event['details']).get('departure') == row['departure'] for event in connection.execute(
                    "SELECT details FROM booking_timeline WHERE booking_id=? AND event_type='cleaning_team_notified'", (identifier,))):
                    raise BookingError('Le propriétaire n’a pas encore transmis cette demande de ménage.', 409)
                if not row['cleaning_received_at']:
                    timestamp = event_time()
                    connection.execute('UPDATE booking_workflows SET cleaning_received_at=?,version=version+1 WHERE booking_id=?', (timestamp, identifier))
                    record_event(connection, identifier, 'cleaning_request_received', 'cleaner', {'departure': row['departure']})
            else:
                if not row['cleaning_received_at']:
                    raise BookingError('Confirmez d’abord la réception de la demande de ménage.', 409)
                checklist = json.loads(row['checklist'] or '{}')
                if not checklist.get('cleaning_done'):
                    checklist['cleaning_done'] = True
                    connection.execute('UPDATE booking_workflows SET checklist=?,version=version+1 WHERE booking_id=?', (json.dumps(checklist), identifier))
                    record_event(connection, identifier, 'cleaning_completed_by_team', 'cleaner', {'departure': row['departure']})
        return {'ok': True, 'action': action}

    def settings(self):
        with self.store.connection() as connection:
            return read_settings(connection)

    def update_settings(self, data):
        if not isinstance(data, dict):
            raise BookingError('Paramètres invalides.')
        values = {}
        for key, (low, high) in SETTINGS_LIMITS.items():
            if key in data:
                values[key] = integer(data.get(key), low, high, {'deposit_percent': 'Acompte (%)', 'balance_days': 'Délai du solde (jours)',
                    'quote_hours': 'Délai de réponse (heures)', 'access_days': 'Envoi des informations d’accès (jours)'}[key])
        if not values:
            raise BookingError('Aucun paramètre à enregistrer.')
        with self.store.connection(True) as connection:
            for key, value in values.items():
                connection.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))
            return read_settings(connection)

    def backup(self):
        """Copie cohérente de toute la base, même pendant une écriture."""
        source = sqlite3.connect(self.store.path, timeout=15)
        target = sqlite3.connect(':memory:')
        try:
            source.backup(target)
            return target.serialize()
        finally:
            source.close()
            target.close()

    def bulk_rates(self, data):
        identifiers = data.get('ids')
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 100:
            raise BookingError('Sélectionnez de 1 à 100 périodes.')
        identifiers = sorted(set(integer(value, 1, 100000000, 'Identifiant') for value in identifiers))
        values = (cents(data.get('midweek')), cents(data.get('weekend')), cents(data.get('cleaning'), True), cents(data.get('charges', 0), True))
        with self.store.connection(True) as connection:
            for identifier in identifiers:
                if not connection.execute('UPDATE package_rates SET midweek_cents=?,weekend_cents=?,cleaning_cents=?,charges_cents=? WHERE id=? AND active=1', values+(identifier,)).rowcount:
                    raise BookingError('Une période a changé ou a été désactivée. Actualisez la grille.', 409)
        return {'updated': len(identifiers)}

    def record_payment(self, identifier, data):
        amount=cents(data.get('amount'))
        method=data.get('method')
        if not isinstance(method,str) or method not in PAYMENT_METHODS:
            raise BookingError('Choisissez un moyen de paiement.')
        reference=str(data.get('reference') or '').strip() or None
        if reference and len(reference)>150:
            raise BookingError('La référence de paiement est trop longue.')
        version=integer(data.get('version'),0,100000000,'Version')
        try:
            with self.store.connection(True) as connection:
                row=connection.execute('''SELECT demandes.*,COALESCE(workflow.source,'direct') AS source,
                    COALESCE(workflow.checklist,'{}') AS checklist,COALESCE(workflow.version,0) AS version
                    FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                    WHERE demandes.id=?''',(identifier,)).fetchone()
                if not row:
                    raise BookingError('Dossier introuvable.',404)
                if row['source']!='direct':
                    raise BookingError('Les paiements des plateformes restent suivis sur celles-ci.')
                if row['status'] not in ('pending','confirmed') or not row['quote_json'] or not row['email']:
                    raise BookingError('Une demande active, un devis et une adresse e-mail sont nécessaires pour enregistrer ce paiement.',409)
                if row['version']!=version:
                    raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.',409)
                quote=json.loads(row['quote_json'])
                total=integer(quote.get('total_cents'),1,10000000000,'Total du devis')
                paid=connection.execute('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM booking_payments WHERE booking_id=?',(identifier,)).fetchone()['amount']
                balance=max(0,total-paid)
                if amount>balance:
                    raise BookingError('Le paiement dépasse le solde restant de '+f'{balance/100:.2f}'.replace('.',',')+' €.')
                if reference and connection.execute('SELECT id FROM booking_payments WHERE booking_id=? AND reference=?',(identifier,reference)).fetchone():
                    raise BookingError('Cette référence de paiement est déjà enregistrée.',409)
                payment_id=connection.execute('''INSERT INTO booking_payments
                    (booking_id,amount_cents,method,reference,verified_at) VALUES(?,?,?,?,?)''',
                    (identifier,amount,method,reference,event_time())).lastrowid
                total_paid=paid+amount
                checklist=json.loads(row['checklist'])
                checklist['payment_verified']=total_paid>=total
                connection.execute('INSERT OR IGNORE INTO booking_workflows(booking_id) VALUES(?)',(identifier,))
                if not connection.execute('UPDATE booking_workflows SET checklist=?,version=version+1 WHERE booking_id=? AND version=?',
                    (json.dumps(checklist),identifier,version)).rowcount:
                    raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.',409)
                record_event(connection,identifier,'payment_validated','owner',{
                    'payment_id':payment_id,'amount_cents':amount,'method':method,'reference':reference,
                    'paid_total_cents':total_paid,'balance_cents':max(0,total-total_paid),'fully_paid':total_paid>=total})
                reservation_confirmed=row['status']=='confirmed'
                plan=payment_plan(total,row['arrival'],read_settings(connection))
                if total_paid>=plan['deposit_cents'] and row['status']=='pending':
                    try:
                        stay_package(parse_date(row['arrival']),parse_date(row['departure']),quote.get('package'))
                        dates_valid=True
                    except BookingError:
                        dates_valid=False
                    if dates_valid and not self.store.unavailable(connection,row['arrival'],row['departure'],identifier):
                        connection.execute("UPDATE demandes SET status='confirmed' WHERE id=? AND status='pending'",(identifier,))
                        record_event(connection,identifier,'reservation_confirmed','system',
                            {'source':'direct','trigger':'full_payment_validated' if total_paid>=total else 'deposit_validated','payment_id':payment_id})
                        reservation_confirmed=True
        except sqlite3.IntegrityError:
            raise BookingError('Cette référence de paiement existe déjà pour ce séjour.',409)
        email_draft=None
        email_draft_error=None
        try:
            email_draft=self.draft(identifier,'payment',payment_id)
        except Exception:
            logging.exception('Paiement enregistré, mais le brouillon du courriel n’a pas été préparé (dossier %s)', identifier)
            email_draft_error='Le paiement est enregistré. Le courriel devra être préparé séparément depuis le dossier.'
        return {'payment_id':payment_id,'amount_cents':amount,'paid_total_cents':total_paid,
                'balance_cents':max(0,total-total_paid),'fully_paid':total_paid>=total,
                'reservation_confirmed':reservation_confirmed,
                'email_draft':email_draft,'email_draft_error':email_draft_error}

    def draft(self, identifier, kind, payment_id=None, record_prepared=True):
        with self.store.connection(True) as connection:
            row = connection.execute('''SELECT demandes.*,COALESCE(workflow.source,'direct') AS source,
                COALESCE(workflow.arrival_time,'17:00') AS arrival_time,COALESCE(workflow.departure_time,'09:00') AS departure_time FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?''', (identifier,)).fetchone()
            if not row:
                raise BookingError('Dossier introuvable.', 404)
            if row['source'] != 'direct':
                raise BookingError('Les devis et messages commerciaux des plateformes se gèrent directement sur celles-ci.')
            quote = json.loads(row['quote_json']) if row['quote_json'] else None
            schedule = f"du {row['arrival']} à {hour_text(row['arrival_time'])} au {row['departure']} à {hour_text(row['departure_time'])}"
            greeting = 'Bonjour' + (' '+row['name'] if row['name'] else '') + ',\n\n'
            includes_confirmation=False
            includes_arrival=False
            if kind == 'quote':
                if row['status'] not in ('pending', 'confirmed') or not quote or quote.get('package') not in PACKAGES:
                    raise BookingError('Un devis au forfait est nécessaire pour préparer cette réponse.')
                payment_received=connection.execute('SELECT 1 FROM booking_payments WHERE booking_id=? LIMIT 1',(identifier,)).fetchone()
                sent_quote=any(json.loads(event['details']).get('kind')=='quote' for event in connection.execute(
                    "SELECT details FROM booking_timeline WHERE booking_id=? AND event_type='message_sent_manually'",(identifier,)))
                legacy_sent=connection.execute('''SELECT 1 FROM booking_timeline WHERE booking_id=?
                    AND event_type IN ('quote_marked_sent_manually','quote_email_sent') LIMIT 1''',(identifier,)).fetchone()
                if payment_received:
                    raise BookingError('Un paiement est déjà enregistré : le devis est clôturé.',409)
                if sent_quote or legacy_sent:
                    raise BookingError('Ce devis a déjà été envoyé. Consultez la progression du dossier.',409)
                if row['status'] == 'pending' and self.store.unavailable(connection, row['arrival'], row['departure'], identifier):
                    raise BookingError('Dates occupées : ne proposez pas ce devis.', 409)
                amount = f"{row['total_cents']/100:.2f}".replace('.', ',')
                nights=quote.get('nights',(parse_date(row['departure'])-parse_date(row['arrival'])).days)
                body = f"Votre séjour {quote['package_label']} de {nights} nuits au Noyer {schedule} représente un montant total de {amount} €.\n"
                lodging=f"{quote.get('package_cents', 0)/100:.2f}".replace('.', ',')
                cleaning=f"{quote.get('cleaning_cents', 0)/100:.2f}".replace('.', ',')
                charges=f"{quote.get('charges_cents', 0)/100:.2f}".replace('.', ',')
                body += f"Détail : hébergement {lodging} €, ménage {cleaning} €, charges fixes de saison {charges} €.\n"
                body += ('Le tarif mid-week est ajusté à la durée du séjour (référence quatre nuits).\n' if quote.get('package')=='midweek' else 'Le tarif week-end est fixe quelle que soit la durée autorisée.\n')
                plan = payment_plan(row['total_cents'], row['arrival'], read_settings(connection))
                balance_amount = euros(row['total_cents'] - plan['deposit_cents'])
                body += (f"\nPour réserver, un acompte de {plan['deposit_percent']} %, soit {euros(plan['deposit_cents'])} €, bloque vos dates dès sa réception. "
                         f"Cet acompte n’est pas remboursable.\n")
                if row['total_cents'] > plan['deposit_cents']:
                    body += f"Le solde de {balance_amount} € est à régler au plus tard le {date_text(plan['balance_due'])}, {plan['balance_days']} jours avant votre arrivée.\n"
                body += 'Aucun paiement n’est enregistré par ce message.'
                subject = 'Votre proposition de séjour au Noyer'
            elif kind == 'payment':
                payment=connection.execute('SELECT * FROM booking_payments WHERE booking_id=? AND (? IS NULL OR id=?) ORDER BY id DESC LIMIT 1',
                    (identifier,payment_id,payment_id)).fetchone()
                if not payment or not quote:
                    raise BookingError('Aucun paiement validé à confirmer par courriel.',409)
                paid=connection.execute('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM booking_payments WHERE booking_id=?',(identifier,)).fetchone()['amount']
                balance=max(0,row['total_cents']-paid)
                amount=f"{payment['amount_cents']/100:.2f}".replace('.',',')
                received=f"{paid/100:.2f}".replace('.',',')
                nights=quote.get('nights',(parse_date(row['departure'])-parse_date(row['arrival'])).days)
                body=f"Nous vous confirmons la réception de votre paiement de {amount} € pour le séjour {quote['package_label']} de {nights} nuits {schedule}.\n"
                lodging=f"{quote.get('package_cents', 0)/100:.2f}".replace('.', ',')
                cleaning=f"{quote.get('cleaning_cents', 0)/100:.2f}".replace('.', ',')
                charges=f"{quote.get('charges_cents', 0)/100:.2f}".replace('.', ',')
                body+=f"Détail du séjour : hébergement {lodging} €, ménage {cleaning} €, charges fixes de saison {charges} €.\n"
                body+=f"Montant reçu à ce jour : {received} €.\n"
                body+=('Le montant du séjour est intégralement réglé. ' if balance==0 else f"Solde restant : {euros(balance)} €.\n")
                if row['status']=='confirmed' and balance==0:
                    body+='Votre réservation est confirmée.\n'
                    body+=arrival_access_text(row['arrival'],row['departure'],row['arrival_time'],row['departure_time'])
                    subject='Réservation confirmée et paiement reçu — Le Noyer'
                    includes_confirmation=True
                    includes_arrival=True
                elif row['status']=='confirmed':
                    plan=payment_plan(row['total_cents'],row['arrival'],read_settings(connection))
                    body+=(f"Votre acompte est bien reçu : vos dates sont bloquées. Cet acompte n’est pas remboursable.\n"
                           f"Le solde est à régler au plus tard le {date_text(plan['balance_due'])}, {plan['balance_days']} jours avant votre arrivée. "
                           'Nous vous transmettrons les informations d’arrivée avec la confirmation du règlement intégral.')
                    subject='Confirmation de réception de paiement — Le Noyer'
                else:
                    body+='Les dates restent en attente de confirmation du propriétaire.'
                    subject='Confirmation de réception de votre paiement — Le Noyer'
            elif kind == 'arrival':
                if row['status'] != 'confirmed' or not quote or quote.get('package') not in PACKAGES:
                    raise BookingError('Les informations d’arrivée sont réservées aux séjours confirmés au forfait.')
                body = arrival_access_text(row['arrival'],row['departure'],row['arrival_time'],row['departure_time'])
                subject = 'Préparer votre arrivée au Noyer'
                includes_confirmation=True
                includes_arrival=True
            elif kind == 'rejection':
                if row['status']!='rejected':
                    raise BookingError('Cette réponse est réservée aux demandes refusées.',409)
                body=f"Nous ne pouvons malheureusement pas donner suite à votre demande de séjour au Noyer {schedule}. Merci de votre intérêt et bonne continuation dans vos recherches."
                subject='Réponse à votre demande de séjour au Noyer'
            elif kind == 'cancellation':
                if row['status']!='cancelled':
                    raise BookingError('Cette réponse est réservée aux séjours annulés.',409)
                body=f"Nous vous confirmons l’annulation de votre séjour au Noyer {schedule}. Si un paiement avait été effectué, contactez-nous pour convenir de la suite."
                subject='Confirmation d’annulation de votre séjour au Noyer'
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
            if record_prepared:
                record_event(connection,identifier,'message_prepared','owner',{'kind':kind,'subject':subject,
                    'recipient':row['email'],'payment_id':payment_id,
                    'includes_confirmation':includes_confirmation,'includes_arrival':includes_arrival})
        return {'subject': subject, 'body': greeting+body+'\n\nLe Noyer', 'recipient': row['email'], 'sent': False}

    def mark_message_sent(self, identifier, data):
        kind=data.get('kind')
        payment_id=data.get('payment_id')
        allowed=('quote','followup','payment','arrival','unavailable','rejection','cancellation')
        if kind not in allowed:
            raise BookingError('Type de message inconnu.')
        with self.store.connection(True) as connection:
            booking=connection.execute('''SELECT demandes.email,COALESCE(workflow.source,'direct') AS source,
                demandes.status FROM demandes LEFT JOIN booking_workflows workflow
                ON workflow.booking_id=demandes.id WHERE demandes.id=?''',(identifier,)).fetchone()
            if not booking:
                raise BookingError('Dossier introuvable.',404)
            if booking['source']!='direct':
                raise BookingError('Les communications des plateformes se gèrent directement sur celles-ci.')
            prepared=None
            for event in connection.execute("SELECT details FROM booking_timeline WHERE booking_id=? AND event_type='message_prepared' ORDER BY id DESC",(identifier,)):
                details=json.loads(event['details'])
                if details.get('kind')==kind and (kind!='payment' or details.get('payment_id')==payment_id):
                    prepared=details
                    break
            if not prepared:
                raise BookingError('Préparez d’abord ce courriel depuis la fiche du dossier.',409)
            record_event(connection,identifier,'message_sent_manually','owner',
                {'kind':kind,'payment_id':payment_id,'recipient':prepared.get('recipient') or booking['email'],
                 'subject':prepared.get('subject'),'channel':'copy'})
            if prepared.get('includes_confirmation'):
                record_event(connection,identifier,'reservation_confirmation_sent_manually','owner',
                    {'kind':kind,'payment_id':payment_id,'recipient':prepared.get('recipient') or booking['email'],'channel':'copy'})
            if prepared.get('includes_arrival'):
                record_event(connection,identifier,'arrival_information_sent_manually','owner',
                    {'kind':kind,'payment_id':payment_id,'recipient':prepared.get('recipient') or booking['email'],'channel':'copy'})
        return {'sent':True,'channel':'copy','recipient':prepared.get('recipient') or booking['email']}

    def mark_cleaning_team_notified(self, identifier, channel):
        if channel not in ('whatsapp','share','copy'):
            raise BookingError('Choisissez un canal de partage valide.')
        with self.store.connection(True) as connection:
            row=connection.execute('''SELECT demandes.status,demandes.departure,
                COALESCE(workflow.source,'direct') AS source FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                WHERE demandes.id=?''',(identifier,)).fetchone()
            if not row:
                raise BookingError('Dossier introuvable.',404)
            if row['status']!='confirmed':
                raise BookingError('Seul un séjour confirmé peut être transmis à l’équipe de nettoyage.',409)
            record_event(connection,identifier,'cleaning_team_notified','owner',
                {'channel':channel,'departure':row['departure'],'source':row['source']})
        return {'sent':True,'channel':channel}
