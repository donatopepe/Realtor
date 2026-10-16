# Realtor — API di riferimento (immagine minima, utente non privilegiato).
#
# Build:  docker build -f server/Dockerfile -t realtor-api .
# Run:    docker run --rm -p 3000:3000 -v realtor-data:/data realtor-api
#
# L'immagine contiene solo il server e lo schema condiviso con l'app: nessuna
# dipendenza runtime da installare.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    REALTOR_DATA_DIR=/data \
    REALTOR_DATA_FILE=/data/cards.json

WORKDIR /app

# `type: module` per il server ESM + schema condiviso + codice del server.
COPY package.json ./package.json
COPY www/js/core/schema.js ./www/js/core/schema.js
COPY server/src ./server/src

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/server.js"]
