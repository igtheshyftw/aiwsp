# In mainland China, build with mirrors, e.g.
#   docker compose build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --registry=${NPM_REGISTRY}
COPY . .
RUN npm run typecheck && npm run build && npm test

FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --registry=${NPM_REGISTRY} && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/server.mjs"]
