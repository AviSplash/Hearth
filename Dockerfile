FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ENV DATA_DIR=/data PORT=3000 HTTPS_PORT=3443 NODE_ENV=production
VOLUME /data
EXPOSE 3000 3443
CMD ["node", "server/index.js"]
