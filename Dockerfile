FROM node:20-alpine

# Instala ferramentas de build necessárias para compilar pacotes nativos (como better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Instala dependências primeiro (cache de layer)
COPY package*.json ./
RUN npm ci --only=production

# Copia código fonte e compila TypeScript
COPY . .
RUN npm install typescript ts-node-dev --save-dev
RUN npm run build

# Remove devDependencies após o build
RUN npm prune --production

EXPOSE 3000

CMD ["node", "dist/index.js"]
