FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install

COPY server ./server
COPY client ./client

RUN npm run -w client build
RUN npm run -w server build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY tsconfig.base.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install --omit=dev --workspaces --include-workspace-root

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3000
CMD ["npm", "run", "-w", "server", "start"]
