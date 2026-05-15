FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN apk --no-cache add curl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
