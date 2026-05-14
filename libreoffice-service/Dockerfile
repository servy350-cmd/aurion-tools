FROM node:20-slim

# Instalar LibreOffice + poppler-utils
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.ts ./
COPY tsconfig.json ./

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
