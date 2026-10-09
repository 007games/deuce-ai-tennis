FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY server ./server
COPY public ./public
ENV PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server/index.js"]
