FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/app/data/reviews.sqlite
COPY --chown=node:node docs ./docs
COPY --chown=node:node server ./server
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts/backup-vps.mjs ./scripts/backup-vps.mjs
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/vps.mjs"]
