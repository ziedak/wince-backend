FROM oven/bun:1.0.25-slim

WORKDIR /app

# dist/index.js is a self-contained Vite SSR bundle — no bun install needed
COPY apps/admin-api/dist/index.js ./index.js

EXPOSE 3008
CMD ["bun", "index.js"]
