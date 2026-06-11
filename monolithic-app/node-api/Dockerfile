# ===== STAGE 1 : Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# Copier d'abord les fichiers de dépendances (cache Docker)
COPY package.json package-lock.json ./

# Installer TOUTES les dépendances (y compris devDependencies pour les tests)
RUN npm ci

# Copier le code source
COPY src/ ./src/

# ===== STAGE 2 : Test =====
FROM builder AS test

COPY tests/ ./tests/
COPY jest.config.js ./

# Les tests tournent ici
RUN npm test

# ===== STAGE 3 : Production =====
FROM node:20-alpine AS production

WORKDIR /app

# Seulement les dépendances de production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# Utilisateur non-root (sécurité)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

# Healthcheck intégré
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]