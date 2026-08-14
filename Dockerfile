# Build: compila TypeScript -> dist/, con las devDependencies necesarias para `nest build`.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Runtime: solo dependencias de producción + el dist ya compilado, sin toolchain de build.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Sin esto el proceso corre como root dentro del contenedor: una vulnerabilidad en la app
# tendría permisos de root sobre el filesystem de la imagen. `node` ya viene en la imagen
# oficial, no hace falta crearlo.
USER node

EXPOSE 3000
CMD ["node", "dist/main"]
