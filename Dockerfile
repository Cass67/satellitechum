FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SATELLITECHUM_ENV=production

RUN useradd --system --no-create-home --shell /usr/sbin/nologin satellitechum

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py gunicorn.conf.py ./
COPY static/ static/
COPY templates/ templates/

USER satellitechum

EXPOSE 6666

CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]
