# Guide Complet : Pipeline CI/CD avec GitHub + Jenkins + Docker

## Architecture Globale

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   GitHub    │────▶│   Jenkins   │────▶│  Docker Build    │────▶│  Registry   │
│  (webhook)  │     │  (pipeline) │     │  + Tests         │     │  (Hub/ECR)  │
└─────────────┘     └─────────────┘     └──────────────────┘     └─────────────┘
```

**Flux complet :**

```
1. git push sur GitHub
2. GitHub webhook → déclenche Jenkins
3. Jenkins lit le Jenkinsfile
4. Stage Checkout : clone le repo
5. Stage Build : docker build (multi-stage)
6. Stage Test : exécute les tests dans le conteneur
7. Stage Security : scan Trivy / Bandit
8. Stage Push : pousse l'image vers Docker Hub (seulement sur main)
9. Stage Deploy : met à jour les conteneurs en production
10. Post : notification Slack du résultat
```

---

## Structure des Projets

```
devops-learning-project/
├── docs/
│   └── GUIDE_PIPELINE_CI_CD.md          ← Ce fichier
├── infrastructure/
│   ├── jenkins/
│   │   └── docker-compose.yml           ← Jenkins en Docker
│   └── registry/
│       └── docker-compose.yml           ← Registry privé (optionnel)
├── microservices-app/                   ← Projet 4 : Fullstack
│   ├── Jenkinsfile
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── docker-compose.test.yml
│   ├── frontend/
│   ├── backend/
│   ├── nginx/
│   └── database/
└── monolithic-app/                      ← Projets 1, 2, 3
    ├── node-api/
    ├── python-api/
    └── java-api/
```

---

## Fichiers Communs à Tous les Projets

### `.dockerignore`

Exclut les fichiers inutiles de l'image Docker (comme `.gitignore` pour Docker).

```
node_modules
.git
.gitignore
.env
.env.*
*.log
__pycache__
*.pyc
target/
.idea/
.vscode/
coverage/
.nyc_output/
dist/
```

---

## Configuration Jenkins (à faire une seule fois)

### Plugins à installer

| Plugin | Pourquoi |
|--------|----------|
| Docker Pipeline | Pour `docker.build()`, `docker.withRegistry()` |
| Git | Pour `checkout scm` |
| JUnit | Pour les rapports de tests |
| JaCoCo | Pour la couverture Java |
| Cobertura | Pour la couverture Python |
| Slack Notification | Pour les notifications |
| SSH Agent | Pour le déploiement SSH |

### Credentials à configurer

| ID | Type | Usage |
|----|------|-------|
| `docker-hub-creds` | Username/Password | Push vers Docker Hub |
| `deploy-server-key` | SSH Private Key | Déploiement prod |

### Webhook GitHub

- URL : `http://jenkins.tondomaine.com/github-webhook/`
- Content type : `application/json`
- Events : Push + Pull Request

### Créer le job Jenkins

1. **New Item** > **Multibranch Pipeline**
2. **Branch Sources** > **GitHub** > URL du repo
3. **Build Configuration** > **by Jenkinsfile** (chemin: `Jenkinsfile`)
4. **Scan Multibranch Pipeline Triggers** > cocher "Periodically if not otherwise run" (1 min)

---

## Projet 1 : Node.js (Express + Jest)

### Emplacement : `monolithic-app/node-api/`

### Fichiers à créer

```
node-api/
├── Jenkinsfile
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── docker-compose.prod.yml
├── jest.config.js
├── package.json
├── src/
│   └── app.js
└── tests/
    └── app.test.js
```

### Dockerfile

```dockerfile
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
```

**Points clés :**
- **Multi-stage build** : 3 étapes séparées. L'image finale ne contient que le nécessaire
- **Cache des layers** : `package.json` copié AVANT le code → `npm ci` caché si deps inchangées
- **Utilisateur non-root** : sécurité de base
- **HEALTHCHECK** : Docker sait si le conteneur est sain

### Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = 'docker.io'
        DOCKER_REPO = 'tonuser/node-api'
        DOCKER_CREDENTIALS = 'docker-hub-creds'
        IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT[0..7]}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install & Lint') {
            steps {
                sh '''
                    docker build --target builder -t ${DOCKER_REPO}:builder .
                    docker run --rm ${DOCKER_REPO}:builder npx eslint src/
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                    docker build --target test -t ${DOCKER_REPO}:test .
                '''
                sh '''
                    docker create --name test-container ${DOCKER_REPO}:test
                    docker cp test-container:/app/coverage ./coverage
                    docker rm test-container
                '''
            }
            post {
                always {
                    junit 'coverage/junit.xml'
                    publishHTML([
                        reportDir: 'coverage/lcov-report',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report'
                    ])
                }
            }
        }

        stage('Build Production Image') {
            steps {
                script {
                    docker.build("${DOCKER_REPO}:${IMAGE_TAG}", "--target production .")
                }
            }
        }

        stage('Security Scan') {
            steps {
                sh "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image ${DOCKER_REPO}:${IMAGE_TAG}"
            }
        }

        stage('Push') {
            when { branch 'main' }
            steps {
                script {
                    docker.withRegistry("https://${DOCKER_REGISTRY}", DOCKER_CREDENTIALS) {
                        def img = docker.image("${DOCKER_REPO}:${IMAGE_TAG}")
                        img.push()
                        img.push('latest')
                    }
                }
            }
        }
    }

    post {
        always { cleanWs() }
        failure { echo 'Node.js pipeline FAILED' }
    }
}
```

### docker-compose.yml (dev)

```yaml
services:
  api:
    build:
      context: .
      target: builder
    ports:
      - "3000:3000"
    volumes:
      - ./src:/app/src
    environment:
      - NODE_ENV=development
    command: npx nodemon src/app.js
```

---

## Projet 2 : Python (Flask + pytest + Bandit)

### Emplacement : `monolithic-app/python-api/`

### Fichiers à créer

```
python-api/
├── Jenkinsfile
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── docker-compose.prod.yml
├── requirements.txt
├── requirements-dev.txt
├── pyproject.toml
├── src/
│   ├── __init__.py
│   └── app.py
└── tests/
    ├── __init__.py
    └── test_app.py
```

### Dockerfile

```dockerfile
# ===== STAGE 1 : Base =====
FROM python:3.12-slim AS base

WORKDIR /app

# Variables d'environnement Python
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Dépendances système
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# ===== STAGE 2 : Dependencies =====
FROM base AS dependencies

COPY requirements.txt requirements-dev.txt ./
RUN pip install --prefix=/install -r requirements.txt

# ===== STAGE 3 : Test =====
FROM base AS test

COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements.txt -r requirements-dev.txt

COPY src/ ./src/
COPY tests/ ./tests/
COPY pyproject.toml ./

# Lancer les tests + couverture + sécurité
RUN pytest tests/ --cov=src --cov-report=xml --junitxml=report.xml \
    && bandit -r src/ -f json -o bandit-report.json || true \
    && pylint src/ --output-format=json > pylint-report.json || true

# ===== STAGE 4 : Production =====
FROM python:3.12-slim AS production

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Copier seulement les packages installés
COPY --from=dependencies /install /usr/local

COPY src/ ./src/

# Utilisateur non-root
RUN useradd -r -s /bin/false appuser
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "src.app:create_app()"]
```

**Points clés :**
- **`PYTHONDONTWRITEBYTECODE=1`** : pas de fichiers `.pyc` (inutiles dans Docker)
- **`PYTHONUNBUFFERED=1`** : logs Python en temps réel
- **`--prefix=/install`** : installe les packages dans un dossier séparé qu'on copie ensuite
- **Gunicorn** : serveur WSGI de production (pas le serveur Flask de dev)

### Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = 'docker.io'
        DOCKER_REPO = 'tonuser/python-api'
        DOCKER_CREDENTIALS = 'docker-hub-creds'
        IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT[0..7]}"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Lint & Security') {
            parallel {
                stage('Pylint') {
                    steps {
                        sh '''
                            docker build --target test -t ${DOCKER_REPO}:test .
                            docker run --rm ${DOCKER_REPO}:test pylint src/ --exit-zero
                        '''
                    }
                }
                stage('Bandit (Security)') {
                    steps {
                        sh '''
                            docker build --target test -t ${DOCKER_REPO}:test .
                            docker run --rm ${DOCKER_REPO}:test bandit -r src/ -ll
                        '''
                    }
                }
            }
        }

        stage('Test + Coverage') {
            steps {
                sh '''
                    docker build --target test -t ${DOCKER_REPO}:test .
                    docker create --name pytest-container ${DOCKER_REPO}:test
                    docker cp pytest-container:/app/report.xml ./report.xml
                    docker cp pytest-container:/app/coverage.xml ./coverage.xml
                    docker cp pytest-container:/app/bandit-report.json ./bandit-report.json
                    docker rm pytest-container
                '''
            }
            post {
                always {
                    junit 'report.xml'
                    cobertura coberturaReportFile: 'coverage.xml'
                }
            }
        }

        stage('Build Production') {
            steps {
                script {
                    docker.build("${DOCKER_REPO}:${IMAGE_TAG}", "--target production .")
                }
            }
        }

        stage('Push') {
            when { branch 'main' }
            steps {
                script {
                    docker.withRegistry("https://${DOCKER_REGISTRY}", DOCKER_CREDENTIALS) {
                        def img = docker.image("${DOCKER_REPO}:${IMAGE_TAG}")
                        img.push()
                        img.push('latest')
                    }
                }
            }
        }
    }

    post {
        always { cleanWs() }
    }
}
```

### docker-compose.yml (dev)

```yaml
services:
  api:
    build:
      context: .
      target: test
    ports:
      - "5000:5000"
    volumes:
      - ./src:/app/src
    environment:
      - FLASK_ENV=development
      - FLASK_DEBUG=1
    command: flask run --host 0.0.0.0
```

---

## Projet 3 : Java (Spring Boot + Maven + JaCoCo)

### Emplacement : `monolithic-app/java-api/`

### Fichiers à créer

```
java-api/
├── Jenkinsfile
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── docker-compose.prod.yml
├── pom.xml
└── src/
    ├── main/
    │   └── java/com/example/app/
    │       └── Application.java
    └── test/
        └── java/com/example/app/
            └── ApplicationTest.java
```

### Dockerfile

```dockerfile
# ===== STAGE 1 : Build + Test =====
FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /app

# Cache des dépendances Maven (layer séparé)
COPY pom.xml ./
RUN mvn dependency:go-offline -B

# Copier le code et compiler
COPY src/ ./src/
RUN mvn clean package -B -DskipTests=false

# ===== STAGE 2 : Production =====
FROM eclipse-temurin:21-jre-alpine AS production

WORKDIR /app

# Copier seulement le JAR final
COPY --from=builder /app/target/*.jar app.jar

# Utilisateur non-root
RUN addgroup -S spring && adduser -S spring -G spring
USER spring

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1

# Options JVM optimisées pour conteneur
ENTRYPOINT ["java", \
    "-XX:+UseContainerSupport", \
    "-XX:MaxRAMPercentage=75.0", \
    "-jar", "app.jar"]
```

**Points clés :**
- **`dependency:go-offline`** : télécharge toutes les deps Maven dans un layer caché
- **JRE vs JDK** : l'image de production utilise seulement le JRE (plus petit)
- **`-XX:+UseContainerSupport`** : la JVM respecte les limites mémoire du conteneur
- **`-XX:MaxRAMPercentage=75.0`** : la JVM utilise max 75% de la RAM allouée

### Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = 'docker.io'
        DOCKER_REPO = 'tonuser/java-api'
        DOCKER_CREDENTIALS = 'docker-hub-creds'
        IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT[0..7]}"
    }

    tools {
        maven 'Maven-3.9'
        jdk 'JDK-21'
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Build & Test') {
            steps {
                sh 'mvn clean verify -B'
            }
            post {
                always {
                    junit 'target/surefire-reports/*.xml'
                    jacoco(
                        execPattern: 'target/jacoco.exec',
                        classPattern: 'target/classes',
                        sourcePattern: 'src/main/java',
                        minimumLineCoverage: '80',
                        maximumLineCoverage: '100'
                    )
                }
            }
        }

        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('sonarqube') {
                    sh 'mvn sonar:sonar'
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    docker.build("${DOCKER_REPO}:${IMAGE_TAG}")
                }
            }
        }

        stage('Push') {
            when { branch 'main' }
            steps {
                script {
                    docker.withRegistry("https://${DOCKER_REGISTRY}", DOCKER_CREDENTIALS) {
                        def img = docker.image("${DOCKER_REPO}:${IMAGE_TAG}")
                        img.push()
                        img.push('latest')
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
            archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
        }
    }
}
```

### docker-compose.yml (dev)

```yaml
services:
  api:
    build:
      context: .
      target: builder
    ports:
      - "8080:8080"
    volumes:
      - ./src:/app/src
    environment:
      - SPRING_PROFILES_ACTIVE=dev
    command: mvn spring-boot:run
```

---

## Projet 4 : Fullstack (Frontend + Backend + Postgres + Redis + Nginx)

### Emplacement : `microservices-app/`

### Fichiers à créer

```
microservices-app/
├── Jenkinsfile
├── docker-compose.yml              # Dev
├── docker-compose.prod.yml         # Production
├── docker-compose.test.yml         # Tests CI
│
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx.conf
│   ├── package.json
│   └── src/
│
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│
├── nginx/
│   ├── Dockerfile
│   └── nginx.conf
│
└── database/
    └── init.sql
```

### frontend/Dockerfile

```dockerfile
# ===== Build =====
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== Production : Nginx sert les fichiers statiques =====
FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
```

### frontend/nginx.conf

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA : toutes les routes renvoient vers index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache des assets statiques
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Proxy vers l'API backend
    location /api/ {
        proxy_pass http://backend:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### backend/Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ ./src/

FROM node:20-alpine AS production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/src ./src/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
```

### nginx/Dockerfile (Reverse proxy principal)

```dockerfile
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1
```

### nginx/nginx.conf

```nginx
events {
    worker_connections 1024;
}

http {
    upstream frontend {
        server frontend:80;
    }

    upstream backend {
        server backend:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    server {
        listen 80;
        server_name tondomaine.com;

        # Frontend
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
        }

        # API Backend
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health check
        location /health {
            return 200 'OK';
            add_header Content-Type text/plain;
        }
    }
}
```

### docker-compose.yml (Dev)

```yaml
services:
  frontend:
    build:
      context: ./frontend
      target: builder
    ports:
      - "5173:5173"
    volumes:
      - ./frontend/src:/app/src
    command: npm run dev -- --host 0.0.0.0

  backend:
    build:
      context: ./backend
      target: builder
    ports:
      - "3000:3000"
    volumes:
      - ./backend/src:/app/src
    environment:
      - DATABASE_URL=postgres://user:pass@postgres:5432/mydb
      - REDIS_URL=redis://redis:6379
    command: npx nodemon src/app.js
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

### docker-compose.prod.yml

```yaml
services:
  nginx:
    build: ./nginx
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      frontend:
        condition: service_healthy
      backend:
        condition: service_healthy
    restart: always

  frontend:
    build:
      context: ./frontend
      target: production
    restart: always

  backend:
    build:
      context: ./backend
      target: production
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: always

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always

volumes:
  pgdata:
  redisdata:
```

### docker-compose.test.yml (CI)

```yaml
services:
  backend-test:
    build:
      context: ./backend
      target: builder
    environment:
      - DATABASE_URL=postgres://user:pass@postgres-test:5432/testdb
      - REDIS_URL=redis://redis-test:6379
    command: npm test
    depends_on:
      postgres-test:
        condition: service_healthy
      redis-test:
        condition: service_healthy

  frontend-test:
    build:
      context: ./frontend
      target: builder
    command: npm test

  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: testdb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d testdb"]
      interval: 3s
      timeout: 2s
      retries: 10

  redis-test:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 10
```

### Jenkinsfile (Fullstack)

```groovy
pipeline {
    agent any

    environment {
        REGISTRY = 'docker.io'
        FRONTEND_IMAGE = 'tonuser/myapp-frontend'
        BACKEND_IMAGE = 'tonuser/myapp-backend'
        NGINX_IMAGE = 'tonuser/myapp-nginx'
        DOCKER_CREDENTIALS = 'docker-hub-creds'
        IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT[0..7]}"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Build All Images') {
            parallel {
                stage('Frontend') {
                    steps {
                        sh "docker build -t ${FRONTEND_IMAGE}:${IMAGE_TAG} ./frontend"
                    }
                }
                stage('Backend') {
                    steps {
                        sh "docker build -t ${BACKEND_IMAGE}:${IMAGE_TAG} ./backend"
                    }
                }
                stage('Nginx') {
                    steps {
                        sh "docker build -t ${NGINX_IMAGE}:${IMAGE_TAG} ./nginx"
                    }
                }
            }
        }

        stage('Integration Tests') {
            steps {
                sh '''
                    docker compose -f docker-compose.test.yml up \
                        --build --abort-on-container-exit --exit-code-from backend-test
                '''
            }
            post {
                always {
                    sh 'docker compose -f docker-compose.test.yml down -v'
                    junit '**/test-results/*.xml'
                }
            }
        }

        stage('E2E Tests') {
            steps {
                sh '''
                    docker compose -f docker-compose.prod.yml up -d
                    sleep 10
                    docker run --rm --network host cypress/included:latest \
                        --config baseUrl=http://localhost:80
                '''
            }
            post {
                always {
                    sh 'docker compose -f docker-compose.prod.yml down -v'
                }
            }
        }

        stage('Push All Images') {
            when { branch 'main' }
            parallel {
                stage('Push Frontend') {
                    steps {
                        script {
                            docker.withRegistry("https://${REGISTRY}", DOCKER_CREDENTIALS) {
                                docker.image("${FRONTEND_IMAGE}:${IMAGE_TAG}").push()
                                docker.image("${FRONTEND_IMAGE}:${IMAGE_TAG}").push('latest')
                            }
                        }
                    }
                }
                stage('Push Backend') {
                    steps {
                        script {
                            docker.withRegistry("https://${REGISTRY}", DOCKER_CREDENTIALS) {
                                docker.image("${BACKEND_IMAGE}:${IMAGE_TAG}").push()
                                docker.image("${BACKEND_IMAGE}:${IMAGE_TAG}").push('latest')
                            }
                        }
                    }
                }
                stage('Push Nginx') {
                    steps {
                        script {
                            docker.withRegistry("https://${REGISTRY}", DOCKER_CREDENTIALS) {
                                docker.image("${NGINX_IMAGE}:${IMAGE_TAG}").push()
                                docker.image("${NGINX_IMAGE}:${IMAGE_TAG}").push('latest')
                            }
                        }
                    }
                }
            }
        }

        stage('Deploy') {
            when { branch 'main' }
            steps {
                sshagent(['deploy-server-key']) {
                    sh '''
                        ssh user@prod-server "
                            cd /opt/myapp &&
                            docker compose -f docker-compose.prod.yml pull &&
                            docker compose -f docker-compose.prod.yml up -d --remove-orphans
                        "
                    '''
                }
            }
        }
    }

    post {
        always { cleanWs() }
        failure {
            slackSend(
                channel: '#deploys',
                color: 'danger',
                message: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
            )
        }
        success {
            slackSend(
                channel: '#deploys',
                color: 'good',
                message: "SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER} deployed"
            )
        }
    }
}
```

---

## Résumé : Rôle de chaque fichier

| Fichier | Rôle |
|---------|------|
| `Jenkinsfile` | Orchestre le pipeline (checkout → build → test → push → deploy) |
| `Dockerfile` | Recette pour construire l'image Docker |
| `.dockerignore` | Exclut les fichiers inutiles de l'image |
| `docker-compose.yml` | Environnement de développement local |
| `docker-compose.prod.yml` | Configuration de production |
| `docker-compose.test.yml` | Configuration pour les tests CI |
| `nginx.conf` | Configuration du reverse proxy / serveur web |
| `database/init.sql` | Script d'initialisation de la base |

---

## Commandes utiles

```bash
# Dev local
docker compose up -d                          # Démarrer l'environnement dev
docker compose logs -f backend                # Voir les logs
docker compose down -v                        # Tout arrêter et nettoyer

# Build manuel
docker build -t monapp:test --target test .   # Lancer les tests
docker build -t monapp:prod --target production .  # Build de prod

# Debug
docker exec -it <container> sh                # Entrer dans un conteneur
docker inspect <container>                    # Voir la config
docker stats                                  # Voir les ressources utilisées

# Registry
docker login                                  # Se connecter au registry
docker push tonuser/monapp:latest             # Pousser une image
```
