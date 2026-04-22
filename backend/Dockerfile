# Railway Dockerfile — pins Node 18 + installs ffmpeg for segment merge.
#
# We were using nixpacks.toml for ffmpeg but the nixPkgs list wasn't
# getting picked up on every rebuild. Dockerfile is the most reliable
# way to guarantee the runtime has ffmpeg on PATH.
#
# Build is fast (~90s) because ffmpeg comes from the base image's apt
# cache; our app layer is tiny (~10 MB node_modules).

FROM node:18-bookworm-slim

# Install ffmpeg + tini (better PID 1 than node for signal handling)
# --no-install-recommends keeps the image lean (ffmpeg alone is ~40 MB)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer cache: copy lockfiles first so `npm ci` only reruns when deps
# actually change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the service
COPY . .

ENV NODE_ENV=production
# Railway's Procfile sets PORT; we fall back to 5020 for local docker run.
ENV PORT=5020

EXPOSE 5020

# tini reaps zombie children (important because we spawn ffmpeg processes)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
