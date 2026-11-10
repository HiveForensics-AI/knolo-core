FROM node:22-bookworm-slim

WORKDIR /opt/knolo

COPY package.json package-lock.json ./
COPY packages ./packages
COPY schemas ./schemas

RUN npm ci \
  && npm run build --workspace @knolo/core \
  && npm run build --workspace @knolo/mcp \
  && npm cache clean --force \
  && groupadd --gid 10001 knolo \
  && useradd --uid 10001 --gid 10001 --home-dir /home/knolo --create-home --shell /usr/sbin/nologin knolo

USER knolo

ENTRYPOINT ["node", "packages/mcp/bin/knolo-mcp.mjs"]
