# build environment
FROM node:22-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# production environment
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/chiikawa.ts ./chiikawa.ts

ENV NODE_ENV=production
EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
