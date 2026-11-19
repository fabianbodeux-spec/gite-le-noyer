FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Europe/Brussels \
    NOYER_ENV=production \
    NOYER_DATA_DIR=/data

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY deployment.py wsgi.py serveur.py reservations.py operations.py ./
COPY index.html midweek.html admin.html favicon.svg ./
COPY site.css booking.css workspace.css site.js booking.js admin.js workspace.js ./
COPY photos ./photos
COPY traces ./traces

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 4 --timeout 30 --access-logfile - --error-logfile - wsgi:application"]
