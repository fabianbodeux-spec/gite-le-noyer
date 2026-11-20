import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation


class BookingError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


PACKAGES = {
    'midweek': {'label': 'Mid-week', 'weekday': 0, 'days': 4},
    'weekend': {'label': 'Week-end', 'weekday': 4, 'days': 3},
}


def stay_package(start, end, requested=None):
    nights=(end-start).days
    requested=requested or None
    if requested not in (None,'midweek','weekend'):
        raise BookingError('Choisissez un séjour mid-week ou week-end.')
    midweek_ok=start.weekday() in (0,1,2) and nights>=2 and end<=start+timedelta(days=4-start.weekday())
    weekend_ok=start.weekday() in (4,5) and nights>=2 and end<=start+timedelta(days=7-start.weekday())
    if requested=='midweek' and midweek_ok:return 'midweek'
    if requested=='weekend' and weekend_ok:return 'weekend'
    if requested is None:
        if midweek_ok:return 'midweek'
        if weekend_ok:return 'weekend'
    raise BookingError('Mid-week : arrivée du lundi au mercredi, au moins 2 nuits, départ au plus tard vendredi à 9 h. Week-end : arrivée vendredi ou samedi, au moins 2 nuits, départ au plus tard lundi à 9 h.')


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise BookingError("Indiquez une date au format AAAA-MM-JJ.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise BookingError("Cette date n’existe pas.")


def dates(arrival, departure, future=True):
    start, end = parse_date(arrival), parse_date(departure)
    if end <= start or (end - start).days > 366:
        raise BookingError("Le séjour doit durer entre 1 et 366 nuits.")
    if future and start < date.today():
        raise BookingError("La date d’arrivée ne peut pas être passée.")
    return start, end


def integer(value, minimum, maximum, label):
    if isinstance(value, bool) or not re.fullmatch(r"\d+", str(value)):
        raise BookingError(label + " invalide.")
    result = int(value)
    if not minimum <= result <= maximum:
        raise BookingError(label + " hors limites.")
    return result


def cents(value, allow_zero=False):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount != amount.quantize(Decimal('.01')):
            raise InvalidOperation
        if amount < (0 if allow_zero else Decimal('.01')) or amount > 100000:
            raise InvalidOperation
        return int(amount * 100)
    except (InvalidOperation, ValueError, OverflowError):
        raise BookingError("Montant invalide : utilisez des euros avec au plus deux décimales.")


class Store:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def connection(self, write=False):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            if write:
                connection.execute('BEGIN IMMEDIATE')
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.connection(True) as connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS demandes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
                name TEXT NOT NULL, email TEXT NOT NULL, arrival TEXT NOT NULL,
                departure TEXT NOT NULL, guests INTEGER NOT NULL,
                occasion TEXT NOT NULL, message TEXT NOT NULL)''')
            columns = {row['name'] for row in connection.execute('PRAGMA table_info(demandes)')}
            for name, definition in {
                'status': "TEXT NOT NULL DEFAULT 'pending'",
                'quote_json': 'TEXT', 'total_cents': 'INTEGER',
            }.items():
                if name not in columns:
                    connection.execute(f'ALTER TABLE demandes ADD COLUMN {name} {definition}')
            connection.execute('''CREATE TABLE IF NOT EXISTS rates (
                id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
                start TEXT NOT NULL, end TEXT NOT NULL,
                nightly_cents INTEGER NOT NULL, weekend_cents INTEGER NOT NULL,
                cleaning_cents INTEGER NOT NULL, min_nights INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1)''')
            connection.execute('''CREATE TABLE IF NOT EXISTS blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT NOT NULL,
                end TEXT NOT NULL, reason TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)''')
            connection.execute('''CREATE TABLE IF NOT EXISTS package_rates (
                id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
                start TEXT NOT NULL, end TEXT NOT NULL,
                midweek_cents INTEGER NOT NULL, weekend_cents INTEGER NOT NULL,
                cleaning_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)''')
            rate_columns = {row['name'] for row in connection.execute('PRAGMA table_info(package_rates)')}
            if 'charges_cents' not in rate_columns:
                connection.execute('ALTER TABLE package_rates ADD COLUMN charges_cents INTEGER NOT NULL DEFAULT 0')
            connection.execute('CREATE INDEX IF NOT EXISTS booking_dates ON demandes(status,arrival,departure)')
            from operations import initialize_operations
            initialize_operations(connection)

    def unavailable(self, connection, arrival, departure, exclude=0):
        booked = connection.execute('''SELECT id FROM demandes WHERE status='confirmed'
            AND arrival < ? AND departure > ? AND id != ?''', (departure, arrival, exclude)).fetchone()
        blocked = connection.execute('''SELECT id FROM blocks WHERE active=1
            AND start < ? AND end > ?''', (departure, arrival)).fetchone()
        return bool(booked or blocked)

    def quote(self, data, connection=None):
        if connection is None:
            with self.connection() as current:
                return self.quote(data, current)
        start, end = dates(data.get('arrival'), data.get('departure'))
        package = stay_package(start, end, data.get('package'))
        guests = integer(data.get('guests', 1), 1, 30, 'Nombre de voyageurs')
        if self.unavailable(connection, start.isoformat(), end.isoformat()):
            raise BookingError("Ces dates ne sont plus disponibles. Choisissez un autre séjour.", 409)
        rate = connection.execute('SELECT * FROM package_rates WHERE active=1 AND start <= ? AND end > ?',
                                  (start.isoformat(), start.isoformat())).fetchone()
        if rate is None:
            raise BookingError('Forfait non défini pour cette arrivée. Contactez le propriétaire.', 409)
        base_amount = rate[package + '_cents']
        nights=(end-start).days
        amount = (base_amount*nights+2)//4 if package=='midweek' else base_amount
        result = {'arrival': start.isoformat(), 'departure': end.isoformat(), 'guests': guests,
                  'package': package, 'package_label': PACKAGES[package]['label'],
                  'arrival_time': '17:00', 'departure_time': '09:00',
                  'nights':nights,'base_package_cents':base_amount,
                  'package_cents': amount, 'period': rate['label'],
                  'cleaning_cents': rate['cleaning_cents'], 'charges_cents': rate['charges_cents'], 'currency': 'EUR',
                  'total_cents': amount + rate['cleaning_cents'] + rate['charges_cents']}
        result['token'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
        return result

    def request(self, data):
        name, email = str(data.get('name', '')).strip(), str(data.get('email', '')).strip()
        if not 1 <= len(name) <= 100:
            raise BookingError("Indiquez votre nom (100 caractères maximum).")
        if len(email) > 254 or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
            raise BookingError("Indiquez une adresse e-mail valide.")
        with self.connection(True) as connection:
            quote = self.quote(data, connection)
            if data.get('quote_token') != quote['token']:
                raise BookingError("Le devis a changé ou n’a pas été calculé. Recalculez le prix avant de continuer.", 409)
            cursor = connection.execute('''INSERT INTO demandes
                (created_at,name,email,arrival,departure,guests,occasion,message,status,quote_json,total_cents)
                VALUES (?,?,?,?,?,?,?,?,'pending',?,?)''',
                (datetime.now().isoformat(timespec='seconds'), name, email, quote['arrival'], quote['departure'],
                 quote['guests'], str(data.get('occasion', ''))[:100], str(data.get('message', ''))[:2000],
                 json.dumps(quote, ensure_ascii=False), quote['total_cents']))
            from operations import record_event
            record_event(connection,cursor.lastrowid,'request_received','guest',{'origin':'site','quote_total_cents':quote['total_cents']})
            return {'id': cursor.lastrowid, 'status': 'pending', 'total_cents': quote['total_cents']}

    def save_rate(self, data):
        start, end = dates(data.get('start'), data.get('end'), False)
        label = str(data.get('label', '')).strip()
        if not 1 <= len(label) <= 100:
            raise BookingError("Nommez la période tarifaire.")
        rate_id = integer(data.get('id', 0), 0, 100000000, 'Identifiant')
        values = (label, start.isoformat(), end.isoformat(), cents(data.get('midweek')),
                  cents(data.get('weekend')), cents(data.get('cleaning'), True), cents(data.get('charges', 0), True))
        with self.connection(True) as connection:
            if connection.execute('SELECT id FROM package_rates WHERE active=1 AND start < ? AND end > ? AND id != ?',
                                  (end.isoformat(), start.isoformat(), rate_id)).fetchone():
                raise BookingError("Cette période chevauche un tarif existant. Modifiez ou désactivez ce tarif.", 409)
            if rate_id:
                if not connection.execute('UPDATE package_rates SET label=?,start=?,end=?,midweek_cents=?,weekend_cents=?,cleaning_cents=?,charges_cents=?,active=1 WHERE id=?', values+(rate_id,)).rowcount:
                    raise BookingError("Tarif introuvable.", 404)
            else:
                rate_id = connection.execute('INSERT INTO package_rates(label,start,end,midweek_cents,weekend_cents,cleaning_cents,charges_cents) VALUES (?,?,?,?,?,?,?)', values).lastrowid
        return {'id': rate_id}

    def block(self, data):
        start, end = dates(data.get('start'), data.get('end'))
        reason = str(data.get('reason', '')).strip()
        if not 1 <= len(reason) <= 200:
            raise BookingError("Indiquez le motif du blocage.")
        with self.connection(True) as connection:
            if self.unavailable(connection, start.isoformat(), end.isoformat()):
                raise BookingError("Une réservation ou un blocage occupe déjà ces dates.", 409)
            identifier = connection.execute('INSERT INTO blocks(start,end,reason) VALUES (?,?,?)',
                                            (start.isoformat(), end.isoformat(), reason)).lastrowid
        return {'id': identifier}

    def status(self, identifier, status):
        if status not in ('confirmed', 'cancelled', 'rejected'):
            raise BookingError("Statut invalide.")
        with self.connection(True) as connection:
            row = connection.execute('''SELECT demandes.*,COALESCE(workflow.source,'direct') AS source
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                WHERE demandes.id=?''', (identifier,)).fetchone()
            if row is None:
                raise BookingError("Demande introuvable.", 404)
            if row['status'] == status:
                return {'status': status}
            if row['status'] not in ('pending', 'confirmed') or (row['status'] == 'confirmed' and status != 'cancelled'):
                raise BookingError("Cette transition de statut n’est pas autorisée.", 409)
            if status == 'confirmed':
                dates(row['arrival'], row['departure'])
                if row['source'] == 'direct':
                    if not row['name'] or not row['email']:
                        raise BookingError('Complétez le nom et l’e-mail du voyageur avant confirmation.', 409)
                    if row['quote_json'] is None:
                        raise BookingError("Ancienne demande sans devis : créez une nouvelle demande chiffrée avant confirmation.", 409)
                    quote = json.loads(row['quote_json'])
                    if quote.get('package') not in PACKAGES:
                        raise BookingError('Ancienne demande à la nuit : recréez un devis au forfait avant confirmation.', 409)
                    stay_package(parse_date(row['arrival']), parse_date(row['departure']), quote['package'])
                if self.unavailable(connection, row['arrival'], row['departure'], identifier):
                    raise BookingError("Ces dates sont déjà occupées : confirmation impossible.", 409)
            connection.execute('UPDATE demandes SET status=? WHERE id=?', (status, identifier))
            event_type={
                'confirmed':'reservation_confirmed' if row['source']=='direct' else 'external_dates_validated',
                'cancelled':'reservation_cancelled',
                'rejected':'request_rejected',
            }[status]
            from operations import record_event
            record_event(connection,identifier,event_type,'owner',{'source':row['source']})
        return {'status': status}

    def deactivate(self, table, identifier):
        if table not in ('rates', 'blocks'):
            raise BookingError("Ressource inconnue.", 404)
        if table == 'rates':
            table = 'package_rates'
        with self.connection(True) as connection:
            if not connection.execute(f'UPDATE {table} SET active=0 WHERE id=?', (identifier,)).rowcount:
                raise BookingError("Élément introuvable.", 404)
        return {'ok': True}

    def calendar(self, year, private=False):
        year = integer(year, 2000, 2100, 'Année')
        start, end = f'{year}-01-01', f'{year+1}-01-01'
        with self.connection() as connection:
            rates = [dict(row) for row in connection.execute('SELECT * FROM package_rates WHERE active=1 AND start < ? AND end > ? ORDER BY start', (end, start))]
            bookings = [dict(row) for row in connection.execute('''SELECT demandes.*,COALESCE(workflow.source,'direct') AS source
                FROM demandes LEFT JOIN booking_workflows workflow ON workflow.booking_id=demandes.id
                WHERE arrival < ? AND departure > ? ORDER BY arrival,id''', (end, start))]
            blocks = [dict(row) for row in connection.execute('SELECT * FROM blocks WHERE active=1 AND start < ? AND end > ?', (end, start))]
        days, revenue, occupied = [], 0, 0
        for booking in bookings:
            if booking['status'] == 'confirmed' and booking['source'] == 'direct' and booking['quote_json']:
                quote = json.loads(booking['quote_json'])
                if quote.get('package') in PACKAGES:
                    if start <= quote['arrival'] < end:
                        revenue += quote['total_cents']
                else:
                    revenue += sum(night['cents'] for night in quote.get('nights', []) if start <= night['date'] < end)
                    if start <= quote['arrival'] < end:
                        revenue += quote['cleaning_cents']
        current = date(year, 1, 1)
        while current.year == year:
            night = current.isoformat()
            rate = next((rate for rate in rates if rate['start'] <= night < rate['end']), None)
            reserved = any(row['status'] == 'confirmed' and row['arrival'] <= night < row['departure'] for row in bookings)
            blocked = any(row['start'] <= night < row['end'] for row in blocks)
            occupied += int(reserved)
            state = 'occupied' if reserved or blocked else 'unpriced' if not rate else 'available'
            package = 'midweek' if current.weekday() in (0,1,2) else 'weekend' if current.weekday() in (4,5) else None
            days.append({'date': night, 'state': state,
                         'cents': rate[package+'_cents'] if rate and package else None,
                         'package': package, 'price_basis': 'package'})
            current += timedelta(days=1)
        result = {'year': year, 'days': days}
        if private:
            for booking in bookings:
                quote = json.loads(booking['quote_json']) if booking['quote_json'] else {}
                booking['package'] = quote.get('package')
                booking['arrival_time'] = quote.get('arrival_time')
                booking['departure_time'] = quote.get('departure_time')
                if booking['source'] != 'direct':
                    booking['total_cents'] = None
                booking.pop('quote_json', None)
            result.update(rates=rates, bookings=bookings, blocks=blocks,
                          forecast_cents=revenue, confirmed_nights=occupied,
                          unpriced_nights=sum(day['state'] == 'unpriced' for day in days))
        return result
