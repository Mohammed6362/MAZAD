# بناء الواجهة في مرحلة مستقلة ثم تجهيز خادم الإنتاج بمتطلبات التشغيل فقط وتشغيله بمستخدم محدود.
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY shared/ /build/shared/
RUN npm run build

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production PORT=3000
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/src ./src
COPY --chown=node:node shared/ /app/shared/
COPY --chown=node:node backend/server.js ./server.js
COPY --chown=node:node backend/scripts ./scripts
COPY --chown=node:node backend/database ./database
COPY --from=frontend --chown=node:node /build/frontend/dist /app/frontend/dist
RUN mkdir -p /app/backend/uploads/cars && chown -R node:node /app/backend/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
