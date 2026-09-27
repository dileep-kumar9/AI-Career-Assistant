# ---- build ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:24-slim
# In a container the server must listen on all interfaces, which requires Firebase sign-in
# (single-user local mode is refused off-loopback). The automation browser needs a desktop
# Chrome, so job applying runs from a local install (npm run dev:api), not from this image.
ENV NODE_ENV=production PORT=8790 HOST=0.0.0.0 DATA_DIR=/data BROWSER_HEADLESS=true
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/server/src/index.js"]
