# LetsGo team backend. Node built-ins only (node:sqlite/node:crypto/http) plus
# tsx to run the TypeScript directly — no native build, no compile step.
FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    DB_PATH=/data/letsgo.db \
    PORT=8787 \
    ALLOW_SIGNUP=false
VOLUME /data
EXPOSE 8787

# node:sqlite is behind the experimental flag on Node 22.
CMD ["npm", "start"]
