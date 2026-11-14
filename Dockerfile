# Build the static site, then serve it with nginx.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Only what the build needs; type-checking and tests run in development.
RUN npm ci --omit=dev
COPY . .
RUN npm run build:site

FROM nginx:1.27-alpine
# The port to listen on. Railway overrides it; Sheltie uses this default.
ENV PORT=80
# As a template, so the nginx image substitutes ${PORT} at start.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
