# Build React app
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Python app + Playwright (Chromium for ADA check)
FROM mcr.microsoft.com/playwright/python:v1.50.0-noble
WORKDIR /app

# Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code and built UI
COPY app.py gunicorn.conf.py config.py ./
COPY services ./services
COPY backend ./backend
COPY scripts ./scripts
COPY --from=frontend /app/dist ./dist

# Create output dir (writable at runtime)
RUN mkdir -p output

# Flask app is served by Gunicorn (production WSGI server). app:app = module app, Flask instance app
ENV PORT=8000
EXPOSE 8000
CMD gunicorn --bind 0.0.0.0:${PORT} --config gunicorn.conf.py app:app
