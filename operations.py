import hashlib
import json
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
    connection.execute('''CREATE UNIQUE INDEX IF NOT EXISTS payment_reference
        ON booking_payments(booking_id,reference) WHERE reference IS NOT NULL''')
    connection.execute('''INSERT INTO booking_timeline(booking_id,event_type,actor,details,created_at)
        SELECT demandes.id,'history_tracking_started','system',
               json_object('existing_status',demandes.status,'record_created_at',demandes.created_at),?
        FROM demandes WHERE NOT EXISTS (
            SELECT 1 FROM booking_timeline WHERE booking_timeline.booking_id=demandes.id)''', (event_time(),))


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
        version = integer(data.get('version'), 0, 100000000, 'Version')
        with self.store.connection(True) as connection:
            booking = connection.execute('''SELECT COALESCE(workflow.source,'direct') AS source,
                COALESCE(workflow.checklist,'{}') AS checklist,COALESCE(workflow.version,0) AS version,
                COALESCE(workflow.notes,'') AS notes,COALESCE(workflow.cleaning_note,'') AS cleaning_note FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?''', (identifier,)).fetchone()
            if not booking:
                raise BookingError('Dossier introuvable.', 404)
            if booking['version'] != version:
                raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
            if booking['source'] != 'direct' and any(key not in EXTERNAL_FLAGS for key in flags):
                raise BookingError('Le suivi externe porte uniquement sur l’accueil et le ménage.')
            connection.execute('INSERT OR IGNORE INTO booking_workflows(booking_id) VALUES(?)', (identifier,))
            if not connection.execute('''UPDATE booking_workflows SET checklist=?,notes=?,cleaning_note=?,version=version+1
                                         WHERE booking_id=? AND version=?''',
                                      (json.dumps(flags), notes, cleaning_note, identifier, version)).rowcount:
                raise BookingError('Ce dossier a été modifié ailleurs. Actualisez avant de réessayer.', 409)
            previous=json.loads(booking['checklist'])
            for key,value in flags.items():
                if bool(previous.get(key)) != value:
                    record_event(connection,identifier,'checklist_step_updated','owner',{'step':key,'completed':value})
            if booking['notes'] != notes:
                record_event(connection,identifier,'private_note_updated','owner',{})
            if booking['cleaning_note'] != cleaning_note:
                record_event(connection,identifier,'cleaning_instructions_updated','owner',{})
        return {'ok': True, 'version': version+1}

    def workspace(self, year):
        year = integer(year, 2000, 2100, 'Année')
        today = date.today().isoformat()
        horizon = (date.today()+timedelta(days=14)).isoformat()
        with self.store.connection() as connection:
            rows = [dict(row) for row in connection.execute('''SELECT demandes.*,
                COALESCE(workflow.source,'direct') AS source, workflow.reference,
                COALESCE(workflow.notes,'') AS notes, COALESCE(workflow.cleaning_note,'') AS cleaning_note,
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
                if total_paid>=total and row['status']=='pending':
                    try:
                        stay_package(parse_date(row['arrival']),parse_date(row['departure']),quote.get('package'))
                        dates_valid=True
                    except BookingError:
                        dates_valid=False
                    if dates_valid and not self.store.unavailable(connection,row['arrival'],row['departure'],identifier):
                        connection.execute("UPDATE demandes SET status='confirmed' WHERE id=? AND status='pending'",(identifier,))
                        record_event(connection,identifier,'reservation_confirmed','system',
                            {'source':'direct','trigger':'full_payment_validated','payment_id':payment_id})
                        reservation_confirmed=True
        except sqlite3.IntegrityError:
            raise BookingError('Cette référence de paiement existe déjà pour ce séjour.',409)
        email_draft=self.draft(identifier,'payment',payment_id)
        return {'payment_id':payment_id,'amount_cents':amount,'paid_total_cents':total_paid,
                'balance_cents':max(0,total-total_paid),'fully_paid':total_paid>=total,
                'reservation_confirmed':reservation_confirmed,
                'email_draft':email_draft}

    def draft(self, identifier, kind, payment_id=None, record_prepared=True):
        with self.store.connection(True) as connection:
            row = connection.execute('''SELECT demandes.*,COALESCE(workflow.source,'direct') AS source FROM demandes
                LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id WHERE demandes.id=?''', (identifier,)).fetchone()
            if not row:
                raise BookingError('Dossier introuvable.', 404)
            if row['source'] != 'direct':
                raise BookingError('Les devis et messages commerciaux des plateformes se gèrent directement sur celles-ci.')
            quote = json.loads(row['quote_json']) if row['quote_json'] else None
            schedule = f"du {row['arrival']} à 17 h au {row['departure']} à 9 h"
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
                body += ('Le tarif mid-week est ajusté à la durée du séjour (référence quatre nuits).\n' if quote.get('package')=='midweek' else 'Le tarif week-end est fixe quelle que soit la durée autorisée.\n')
                body += 'Cette proposition reste soumise à confirmation. Aucun paiement n’est enregistré par ce message.'
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
                body+=f"Montant reçu à ce jour : {received} €.\n"
                body+=('Le montant du séjour est intégralement réglé. ' if balance==0 else f"Solde restant : {balance/100:.2f} €. ".replace('.',',') )
                if row['status']=='confirmed' and balance==0:
                    body+='Votre réservation est confirmée.\n'
                    body+=f"Informations d’arrivée : accueil à 17 h, départ à 9 h.\nAdresse : Rue Bierleux 69A, 4990 Lierneux, Belgique.\nMerci de nous communiquer votre heure d’arrivée prévue afin d’organiser la remise des clés."
                    subject='Réservation confirmée et paiement reçu — Le Noyer'
                    includes_confirmation=True
                    includes_arrival=True
                elif row['status']=='confirmed':
                    body+='Votre réservation reste confirmée. Nous vous transmettrons les informations d’arrivée dans le courriel de confirmation du règlement intégral.'
                    subject='Confirmation de réception de paiement — Le Noyer'
                else:
                    body+='Les dates restent en attente de confirmation du propriétaire.'
                    subject='Confirmation de réception de votre paiement — Le Noyer'
            elif kind == 'arrival':
                if row['status'] != 'confirmed' or not quote or quote.get('package') not in PACKAGES:
                    raise BookingError('Les informations d’arrivée sont réservées aux séjours confirmés au forfait.')
                body = f"Nous vous accueillerons au Noyer {schedule}.\nAdresse : Rue Bierleux 69A, 4990 Lierneux, Belgique.\nMerci de nous communiquer votre heure d’arrivée prévue pour organiser la remise des clés."
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
